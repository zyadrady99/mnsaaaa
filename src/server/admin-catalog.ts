import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { identity } from "./auth";
import { transaction } from "./db";
import { denied } from "./errors";
import { validUuid } from "@/lib/auth-input";

export function text(value: unknown, max = 200, min = 1) {
  if (typeof value !== "string")
    denied(400, "invalid_fields", "راجع البيانات المطلوبة.");
  const result = value.normalize("NFC").trim();
  if (
    result.length < min ||
    result.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)
  )
    denied(400, "invalid_fields", "راجع طول البيانات المطلوبة.");
  return result;
}
export function uuid(value: unknown) {
  if (!validUuid(value)) denied(400, "invalid_id", "اختار عنصرًا صحيحًا.");
  return value;
}
export function slug(value: unknown) {
  const result = text(value, 80);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(result))
    denied(
      400,
      "invalid_slug",
      "الرابط: حروف إنجليزي صغيرة وأرقام وشرطات، من ٣ حروف.",
    );
  return result;
}
export const audit = async (
  db: PoolClient,
  actorId: string,
  action: string,
  target: string,
  id: string,
  reason?: string,
  operationId: string = randomUUID(),
) => {
  await db.query(
    `insert into app_private.audit_events(actor_id,action,target_type,target_id,operation_id,reason)
    values($1,$2,$3,$4,$5,$6) on conflict do nothing`,
    [actorId, action, target, id, operationId, reason ?? null],
  );
};
const list = (value: unknown) =>
  text(value ?? "", 3000, 0)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
function image(value: unknown, fallback: string) {
  const ref = typeof value === "string" ? value : fallback;
  if (!/^\/images\/[a-z0-9-]+\.(svg|png|jpe?g|webp)$/.test(ref))
    denied(400, "invalid_image", "اختار صورة محلية متاحة.");
  return ref;
}
export const catalogActions: Record<string, string[]> = {
  "teacher-save": [
    "id",
    "name",
    "slug",
    "subjectId",
    "description",
    "portrait",
    "approach",
    "enabled",
  ],
  "course-save": [
    "id",
    "title",
    "slug",
    "teacherId",
    "gradeId",
    "subjectId",
    "description",
    "subtitle",
    "cover",
    "outcomes",
  ],
  "unit-save": ["id", "courseId", "title"],
  "lesson-save": [
    "id",
    "courseId",
    "unitId",
    "title",
    "description",
    "minutes",
  ],
  "course-publish": ["id"],
  "course-archive": ["id"],
  "subject-create": ["name", "slug"],
  "lesson-delete": ["id"],
  "unit-delete": ["id"],
  "reference-save": ["id", "kind", "name", "enabled", "slug"],
};
export async function catalogCommand(
  action: string,
  body: Record<string, unknown>,
  token: string,
) {
  if (!Object.hasOwn(catalogActions, action))
    denied(404, "not_found", "العملية غير موجودة.");
  return transaction(async (db) => {
    const actor = await identity(db, token, "admin", true);
    let id: string;
    if (action === "teacher-save") {
      const subjectId = uuid(body.subjectId);
      if (
        !(
          await db.query(
            "select id from app_private.subjects where id=$1 and enabled for share",
            [subjectId],
          )
        ).rowCount
      )
        denied(400, "subject_unavailable", "المادة غير متاحة.");
      const values = [
        text(body.name, 120),
        slug(body.slug),
        subjectId,
        text(body.description ?? "", 3000, 0),
        image(body.portrait, "/images/teacher-ahmed.svg"),
        JSON.stringify(list(body.approach)),
        body.enabled !== false,
      ];
      if (body.id) {
        id = uuid(body.id);
        const updated = await db.query(
          `update app_private.teachers set name=$2,slug=$3,subject_id=$4,biography=$5,image_ref=$6,approach=$7,enabled=$8 where id=$1`,
          [id, ...values],
        );
        if (!updated.rowCount) denied(404, "not_found", "المدرس غير موجود.");
      } else {
        id = randomUUID();
        await db.query(
          `insert into app_private.teachers(id,name,slug,subject_id,biography,image_ref,approach,enabled) values($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, ...values],
        );
      }
      await audit(db, actor.id, action, "teacher", id);
      return { message: "بيانات المدرس اتحفظت.", next: "/admin/teachers", id };
    }
    if (action === "course-save") {
      const teacherId = uuid(body.teacherId),
        gradeId = uuid(body.gradeId),
        subjectId = uuid(body.subjectId);
      const existingCourse = body.id
        ? (
            await db.query(
              "select * from app_private.courses where id=$1 for update",
              [uuid(body.id)],
            )
          ).rows[0]
        : null;
      if (body.id && !existingCourse)
        denied(404, "not_found", "الكورس غير موجود.");
      const frozen = existingCourse && existingCourse.status !== "draft";
      const sameIdentity =
        existingCourse &&
        existingCourse.teacher_id === teacherId &&
        existingCourse.grade_id === gradeId &&
        existingCourse.subject_id === subjectId;
      const refs = (
        await db.query(
          `select exists(select 1 from app_private.teachers where id=$1 and enabled) and
        exists(select 1 from app_private.grades where id=$2 and enabled) and exists(select 1 from app_private.subjects where id=$3 and enabled) as ok`,
          [teacherId, gradeId, subjectId],
        )
      ).rows[0];
      if (!refs.ok && !(frozen && sameIdentity))
        denied(
          400,
          "reference_unavailable",
          "اختار مدرسًا وصفًا ومادة متاحين.",
        );
      const values = [
        text(body.title, 180),
        slug(body.slug),
        teacherId,
        gradeId,
        subjectId,
        text(body.description ?? "", 5000, 0),
        text(body.subtitle ?? "", 300, 0),
        image(body.cover, "/images/course-physics.svg"),
        JSON.stringify(list(body.outcomes)),
      ];
      if (body.id) {
        id = uuid(body.id);
        const course = (
          await db.query(
            "select * from app_private.courses where id=$1 for update",
            [id],
          )
        ).rows[0];
        if (!course) denied(404, "not_found", "الكورس غير موجود.");
        if (
          course.status !== "draft" &&
          (course.slug !== values[1] ||
            course.teacher_id !== teacherId ||
            course.grade_id !== gradeId ||
            course.subject_id !== subjectId)
        )
          denied(
            409,
            "course_identity_frozen",
            "بعد النشر تقدر تعدّل العنوان والوصف والصورة. بيانات الكورس الأساسية ثابتة.",
          );
        await db.query(
          `update app_private.courses set title=$2,slug=$3,teacher_id=$4,grade_id=$5,subject_id=$6,description=$7,subtitle=$8,cover_ref=$9,outcomes=$10 where id=$1`,
          [id, ...values],
        );
      } else {
        id = randomUUID();
        await db.query(
          `insert into app_private.courses(id,title,slug,teacher_id,grade_id,subject_id,description,subtitle,cover_ref,outcomes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, ...values],
        );
      }
      await audit(db, actor.id, action, "course", id);
      return { message: "الكورس اتحفظ.", next: `/admin/courses/${id}`, id };
    }
    if (action === "subject-create") {
      id = randomUUID();
      await db.query(
        "insert into app_private.subjects(id,name,slug,enabled) values($1,$2,$3,true)",
        [id, text(body.name, 80), slug(body.slug)],
      );
      await audit(db, actor.id, action, "subjects", id);
      return { id, message: "المادة اتضافت.", next: "/admin/settings" };
    }
    if (action === "lesson-delete" || action === "unit-delete") {
      id = uuid(body.id);
      const table = action === "lesson-delete" ? "lessons" : "course_units";
      const found = (
        await db.query(
          `select course_id from app_private.${table} where id=$1`,
          [id],
        )
      ).rows[0];
      if (!found) denied(404, "not_found", "المسودة غير موجودة.");
      const course = (
        await db.query(
          "select status from app_private.courses where id=$1 for update",
          [found.course_id],
        )
      ).rows[0];
      const row = (
        await db.query(
          `select * from app_private.${table} where id=$1 for update`,
          [id],
        )
      ).rows[0];
      if (
        course.status === "archived" ||
        (table === "lessons" &&
          (row.published_at || row.first_used_at || row.current_video_id))
      )
        denied(
          409,
          "draft_linked",
          "الحذف متاح لمسودة غير مستخدمة وبلا فيديو أو تقييمات مرتبطة.",
        );
      const linked =
        table === "lessons"
          ? (
              await db.query(
                "select exists(select 1 from app_private.assessments where lesson_id=$1) or exists(select 1 from app_private.video_uploads where lesson_id=$1) as linked",
                [id],
              )
            ).rows[0]
          : (
              await db.query(
                "select exists(select 1 from app_private.lessons where unit_id=$1) or exists(select 1 from app_private.assessments where unit_id=$1) as linked",
                [id],
              )
            ).rows[0];
      if (linked.linked)
        denied(409, "draft_linked", "المسودة مرتبطة بمحتوى. مينفعش حذفها.");
      await db.query(`delete from app_private.${table} where id=$1`, [id]);
      await audit(
        db,
        actor.id,
        action,
        table === "lessons" ? "lesson" : "unit",
        id,
      );
      return {
        id,
        message: "المسودة اتحذفت.",
        next: `/admin/courses/${found.course_id}`,
      };
    }
    if (action === "unit-save" || action === "lesson-save") {
      const courseId = uuid(body.courseId);
      const course = (
        await db.query(
          "select * from app_private.courses where id=$1 for update",
          [courseId],
        )
      ).rows[0];
      if (!course || course.status === "archived")
        denied(409, "course_unavailable", "الكورس غير متاح للتعديل.");
      const title = text(body.title, 180);
      if (action === "unit-save") {
        if (body.id) {
          id = uuid(body.id);
          if (
            !(
              await db.query(
                "update app_private.course_units set title=$3 where id=$1 and course_id=$2",
                [id, courseId, title],
              )
            ).rowCount
          )
            denied(404, "not_found", "الوحدة غير موجودة.");
        } else {
          id = randomUUID();
          await db.query(
            `insert into app_private.course_units(id,course_id,title,position)
          select $1,$2,$3,coalesce(max(position),0)+1 from app_private.course_units where course_id=$2`,
            [id, courseId, title],
          );
        }
      } else {
        const unitId = uuid(body.unitId),
          description = text(body.description ?? "", 5000, 0),
          minutes = Number(body.minutes);
        if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 600)
          denied(400, "invalid_duration", "المدة من دقيقة إلى ٦٠٠ دقيقة.");
        if (
          !(
            await db.query(
              "select id from app_private.course_units where id=$1 and course_id=$2",
              [unitId, courseId],
            )
          ).rowCount
        )
          denied(400, "invalid_unit", "الوحدة مش تابعة للكورس ده.");
        if (body.id) {
          id = uuid(body.id);
          const lesson = (
            await db.query(
              "select * from app_private.lessons where id=$1 and course_id=$2 for update",
              [id, courseId],
            )
          ).rows[0];
          if (!lesson) denied(404, "not_found", "الدرس غير موجود.");
          if (
            lesson.unit_id !== unitId &&
            (lesson.published_at || lesson.first_used_at)
          )
            denied(
              409,
              "lesson_frozen",
              "الدرس المنشور أو المستخدم مينفعش ينتقل لوحدة مختلفة.",
            );
          await db.query(
            "update app_private.lessons set title=$2,description=$3,minutes=$4,unit_id=$5 where id=$1",
            [id, title, description, minutes, unitId],
          );
        } else {
          if (course.status !== "draft") {
            const last = (
              await db.query(
                `select u.position from app_private.lessons l join app_private.course_units u on u.id=l.unit_id
              where l.course_id=$1 and l.published_at is not null order by l.position desc limit 1`,
                [courseId],
              )
            ).rows[0];
            const unit = (
              await db.query(
                "select position from app_private.course_units where id=$1",
                [unitId],
              )
            ).rows[0];
            if (last && unit.position < last.position)
              denied(
                409,
                "append_only",
                "الدرس الجديد يضاف في آخر وحدة أو وحدة جديدة للحفاظ على ترتيب المنهج.",
              );
          }
          id = randomUUID();
          await db.query(
            `insert into app_private.lessons(id,course_id,unit_id,title,description,minutes,position)
            select $1,$2,$3,$4,$5,$6,coalesce(max(position),0)+1 from app_private.lessons where course_id=$2`,
            [id, courseId, unitId, title, description, minutes],
          );
        }
      }
      await audit(
        db,
        actor.id,
        action,
        action === "unit-save" ? "unit" : "lesson",
        id,
      );
      return {
        message: action === "unit-save" ? "الوحدة اتحفظت." : "الدرس اتحفظ.",
        next: `/admin/courses/${courseId}`,
        id,
      };
    }
    if (action === "reference-save") {
      const table =
        body.kind === "grade"
          ? "grades"
          : body.kind === "subject"
            ? "subjects"
            : null;
      if (!table) denied(400, "invalid_reference", "اختار صفًا أو مادة.");
      id = uuid(body.id);
      if (
        !(
          await db.query(
            `update app_private.${table} set name=$2,enabled=$3 where id=$1`,
            [id, text(body.name, 80), body.enabled !== false],
          )
        ).rowCount
      )
        denied(404, "not_found", "العنصر غير موجود.");
      await audit(db, actor.id, action, table, id);
      return { message: "البيانات اتحفظت.", next: "/admin/settings", id };
    }
    id = uuid(body.id);
    const course = (
      await db.query(
        "select * from app_private.courses where id=$1 for update",
        [id],
      )
    ).rows[0];
    if (!course) denied(404, "not_found", "الكورس غير موجود.");
    if (action === "course-publish") {
      if (course.status !== "draft")
        denied(409, "course_state", "النشر متاح للمسودة فقط.");
      if (
        !(
          await db.query(
            "select id from app_private.lessons where course_id=$1 and published_at is not null",
            [id],
          )
        ).rowCount
      )
        denied(
          409,
          "course_not_ready",
          "جهّز وانشر درسًا واحدًا على الأقل قبل نشر الكورس.",
        );
      await db.query(
        "update app_private.courses set status='published',published_at=clock_timestamp() where id=$1",
        [id],
      );
    } else {
      if (course.status !== "published")
        denied(409, "course_state", "الأرشفة متاحة للكورس المنشور فقط.");
      await db.query(
        "update app_private.courses set status='archived',archived_at=clock_timestamp() where id=$1",
        [id],
      );
    }
    await audit(db, actor.id, action, "course", id);
    return {
      message:
        action === "course-publish"
          ? "الكورس اتنشر في الموقع المحلي."
          : "الكورس اتأرشف؛ الوصول السابق للطلاب محفوظ.",
      next: `/admin/courses/${id}`,
      id,
    };
  });
}
