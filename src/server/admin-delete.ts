import "server-only";
import type { PoolClient } from "pg";
import { identity } from "./auth";
import { transaction } from "./db";
import { denied } from "./errors";
import { audit, uuid } from "./admin-catalog";

export const deleteActions: Record<string, string[]> = Object.fromEntries(
  [
    "course",
    "teacher",
    "unit",
    "lesson",
    "assessment",
    "reference",
    "code",
    "code-batch",
  ].flatMap((kind) =>
    ["delete", "restore"].map((operation) => [
      `${kind}-${operation}`,
      kind === "reference" ? ["id", "kind", "confirm"] : ["id", "confirm"],
    ]),
  ),
);

async function draftAssessments(db: PoolClient, ids: string[]) {
  if (!ids.length) return true;
  await db.query(
    "select id from app_private.assessments where id=any($1::uuid[]) order by id for update",
    [ids],
  );
  await db.query(
    "select id from app_private.assessment_versions where assessment_id=any($1::uuid[]) order by id for update",
    [ids],
  );
  const { blocked } = (
    await db.query(
      `select exists(select 1 from app_private.assessment_versions where assessment_id=any($1::uuid[]) and published_at is not null)
      or exists(select 1 from app_private.attempts where assessment_id=any($1::uuid[])) as blocked`,
      [ids],
    )
  ).rows[0];
  return !blocked;
}

async function purgeDraftAssessments(db: PoolClient, ids: string[]) {
  if (!ids.length) return;
  await db.query(
    "update app_private.assessments set current_version_id=null where id=any($1::uuid[])",
    [ids],
  );
  for (const table of ["answer_keys", "question_options", "questions"])
    await db.query(
      `delete from app_private.${table} where version_id in (select id from app_private.assessment_versions where assessment_id=any($1::uuid[]))`,
      [ids],
    );
  await db.query(
    "delete from app_private.assessment_versions where assessment_id=any($1::uuid[])",
    [ids],
  );
  await db.query(
    "delete from app_private.assessments where id=any($1::uuid[])",
    [ids],
  );
}

async function unusedLessons(db: PoolClient, ids: string[]) {
  if (!ids.length) return true;
  await db.query(
    "select id from app_private.lessons where id=any($1::uuid[]) order by id for update",
    [ids],
  );
  const { blocked } = (
    await db.query(
      `select exists(select 1 from app_private.lessons where id=any($1::uuid[]) and (published_at is not null or first_used_at is not null))
      or exists(select 1 from app_private.lesson_progress where lesson_id=any($1::uuid[]))
      or exists(select 1 from app_private.gate_overrides where lesson_id=any($1::uuid[]))
      or exists(select 1 from app_private.watch_leases where lesson_id=any($1::uuid[])) as blocked`,
      [ids],
    )
  ).rows[0];
  return !blocked;
}

async function purgeLessons(db: PoolClient, ids: string[]) {
  if (!ids.length) return;
  await db.query(
    "update app_private.lessons set current_video_id=null where id=any($1::uuid[])",
    [ids],
  );
  await db.query(
    "delete from app_private.video_uploads where lesson_id=any($1::uuid[])",
    [ids],
  );
  await db.query("delete from app_private.lessons where id=any($1::uuid[])", [
    ids,
  ]);
}

export async function deleteCommand(
  action: string,
  body: Record<string, unknown>,
  token: string,
) {
  if (!Object.hasOwn(deleteActions, action))
    denied(404, "not_found", "العملية غير موجودة.");
  if (body.confirm !== true)
    denied(400, "confirmation_required", "أكد العملية قبل تنفيذها.");
  const restoring = action.endsWith("-restore"),
    kind = action.slice(0, restoring ? -8 : -7),
    id = uuid(body.id);
  const table =
    kind === "reference"
      ? body.kind === "grade"
        ? "grades"
        : body.kind === "subject"
          ? "subjects"
          : null
      : (
          {
            course: "courses",
            teacher: "teachers",
            unit: "course_units",
            lesson: "lessons",
            assessment: "assessments",
            code: "activation_codes",
            "code-batch": "code_batches",
          } as Record<string, string>
        )[kind];
  if (!table) denied(400, "invalid_reference", "اختار عنصرًا صحيحًا.");
  return transaction(async (db) => {
    const actor = await identity(db, token, "admin", true);
    // Lock parent courses before their content, matching editing and assessment writes.
    let parentId: string | undefined;
    if (["unit", "lesson", "assessment", "code", "code-batch"].includes(kind)) {
      const parent = (
        await db.query(
          `select course_id from app_private.${table} where id=$1`,
          [id],
        )
      ).rows[0];
      if (!parent) denied(404, "not_found", "العنصر غير موجود.");
      parentId = parent.course_id ?? undefined;
      if (parentId)
        await db.query(
          "select id from app_private.courses where id=$1 for update",
          [parentId],
        );
    }
    const row = (
      await db.query(
        `select * from app_private.${table} where id=$1 for update`,
        [id],
      )
    ).rows[0];
    if (!row) denied(404, "not_found", "العنصر غير موجود.");
    const next =
      kind === "course"
        ? "/admin/courses"
        : kind === "teacher"
          ? "/admin/teachers"
          : kind === "reference"
            ? "/admin/settings"
            : kind === "assessment"
              ? restoring
                ? `/admin/assessments/${id}`
                : parentId
                  ? `/admin/courses/${parentId}`
                  : "/admin/assessments"
              : kind === "code-batch"
                ? "/admin/codes"
                : kind === "code"
                  ? `/admin/codes/${row.batch_id}`
                  : `/admin/courses/${parentId}`;
    if (restoring) {
      if (!row.deleted_at) return { id, next, message: "العنصر موجود بالفعل." };
      await db.query(
        `update app_private.${table} set deleted_at=null where id=$1`,
        [id],
      );
      await audit(db, actor.id, action, kind, id);
      return {
        id,
        next,
        message:
          kind === "course"
            ? "الكورس رجع للوحة الإدارة بحالته الحالية؛ الأرشفة والوصول السابق محفوظان."
            : kind === "code" || kind === "code-batch"
              ? "العنصر رجع للعرض. الأكواد الملغية تظل ملغية."
              : "العنصر رجع للوحة الإدارة. راجع بياناته وحالة إظهاره.",
      };
    }
    if (row.deleted_at)
      return { id, next, message: "العنصر موجود بالفعل في المحذوفات." };
    let purged = false;
    if (kind === "course" || kind === "unit" || kind === "lesson") {
      const lessons = (
        await db.query(
          kind === "course"
            ? "select id from app_private.lessons where course_id=$1 order by id"
            : kind === "unit"
              ? "select id from app_private.lessons where unit_id=$1 order by id"
              : "select id from app_private.lessons where id=$1",
          [id],
        )
      ).rows.map((item) => item.id as string);
      const assessments = (
        await db.query(
          kind === "course"
            ? "select id from app_private.assessments where course_id=$1 order by id"
            : kind === "unit"
              ? "select id from app_private.assessments where unit_id=$1 or lesson_id=any($2::uuid[]) order by id"
              : "select id from app_private.assessments where lesson_id=$1 order by id",
          kind === "unit" ? [id, lessons] : [id],
        )
      ).rows.map((item) => item.id as string);
      const unused = await unusedLessons(db, lessons),
        drafts = await draftAssessments(db, assessments);
      const history =
        kind === "course" &&
        (row.status !== "draft" ||
          (
            await db.query(
              `select exists(select 1 from app_private.code_batches where course_id=$1)
        or exists(select 1 from app_private.course_access where course_id=$1)
        or exists(select 1 from app_private.access_events where course_id=$1) as blocked`,
              [id],
            )
          ).rows[0].blocked);
      if (unused && drafts && !history) {
        await purgeDraftAssessments(db, assessments);
        await purgeLessons(db, lessons);
        if (kind === "course")
          await db.query(
            "delete from app_private.course_units where course_id=$1",
            [id],
          );
        if (kind !== "lesson")
          await db.query(`delete from app_private.${table} where id=$1`, [id]);
        purged = true;
      }
    } else if (kind === "assessment") {
      if (await draftAssessments(db, [id])) {
        await purgeDraftAssessments(db, [id]);
        purged = true;
      }
    } else if (kind === "teacher" || kind === "reference") {
      const linked =
        kind === "teacher"
          ? "select exists(select 1 from app_private.courses where teacher_id=$1) as linked"
          : table === "grades"
            ? "select exists(select 1 from app_private.courses where grade_id=$1) or exists(select 1 from app_private.student_profiles where grade_id=$1) or exists(select 1 from app_private.assessments where grade_id=$1) as linked"
            : "select exists(select 1 from app_private.courses where subject_id=$1) or exists(select 1 from app_private.teachers where subject_id=$1) or exists(select 1 from app_private.assessments where subject_id=$1) as linked";
      if (!(await db.query(linked, [id])).rows[0].linked) {
        await db.query(`delete from app_private.${table} where id=$1`, [id]);
        purged = true;
      }
    } else if (kind === "code" || kind === "code-batch") {
      // Cancellation remains permanent. Used-code ownership and access history stay intact.
      await db.query(
        `update app_private.activation_codes c set cancelled_at=clock_timestamp(),cancelled_by=$2,cancellation_reason='حذف من لوحة الإدارة'
        where ${kind === "code" ? "c.id" : "c.batch_id"}=$1 and c.cancelled_at is null and not exists(select 1 from app_private.activations a where a.code_id=c.id)`,
        [id, actor.id],
      );
    }
    if (!purged) {
      const update =
        kind === "course" && row.status === "published"
          ? ",status='archived',archived_at=clock_timestamp()"
          : kind === "teacher" || kind === "reference"
            ? ",enabled=false"
            : "";
      await db.query(
        `update app_private.${table} set deleted_at=clock_timestamp()${update} where id=$1`,
        [id],
      );
    }
    await audit(
      db,
      actor.id,
      action,
      kind,
      id,
      purged
        ? "مسودة أو عنصر غير مرتبط: حذف نهائي"
        : "نقل للمحذوفات مع حفظ السجل والوصول السابق",
    );
    return {
      id,
      next,
      mode: purged ? "permanent" : "trash",
      message: purged
        ? "العنصر ومحتواه المسودّة اتحذفوا نهائيًا."
        : "العنصر اتنقل للمحذوفات. السجل ونتائج الطلاب والوصول السابق محفوظين.",
    };
  });
}
