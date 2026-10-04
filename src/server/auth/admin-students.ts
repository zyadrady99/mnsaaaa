import "server-only";
import { randomUUID } from "node:crypto";
import { transaction } from "@/server/core/db";
import { accountOperation, identity } from "@/server/auth/service";
import { provider } from "@/server/auth/provider";
import { normalizePhone } from "@/lib/auth-input";
import { denied } from "@/server/core/errors";
import { audit, text, uuid } from "@/server/catalog/admin";
export const studentActions: Record<string, string[]> = {
  "student-disable": ["studentId", "reason"],
  "student-enable": ["studentId"],
  "student-update": ["studentId", "name", "gradeId"],
  "access-withdraw": ["studentId", "courseId", "reason"],
  "access-extend": ["studentId", "courseId", "days", "reason"],
  "lesson-override": ["studentId", "lessonId", "reason"],
};
export async function studentAdminCommand(
  action: string,
  body: Record<string, unknown>,
  token: string,
) {
  if (action === "student-enable") {
    const studentId = uuid(body.studentId);
    const inspect = () =>
      transaction(async (db) => {
        const observed = await identity(db, token, "admin");
        await db.query(
          "select id from app_private.accounts where id=any($1::uuid[]) order by id for update",
          [[observed.id, studentId]],
        );
        const actor = await identity(db, token, "admin");
        const account = (
          await db.query(
            "select a.*,i.external_subject from app_private.accounts a join app_private.identity_links i on i.account_id=a.id and i.provider='supabase' where a.id=$1 and a.role='student'",
            [studentId],
          )
        ).rows[0];
        if (!account) denied(404, "student_not_found", "الطالب غير موجود.");
        if (account.provisioning_locked || account.recovery_locked)
          denied(
            409,
            "account_locked",
            "أكمل مراجعة التسجيل أو الاستعادة أولًا.",
          );
        return { account, actor };
      });
    const observed = await inspect();
    return accountOperation(`phone:${observed.account.phone}`, async () => {
      const live = await inspect();
      const changed = await provider(
        "PUT",
        `/admin/users/${live.account.external_subject}`,
        { ban_duration: "none" },
      );
      if (
        !changed.ok ||
        changed.data?.id !== live.account.external_subject ||
        normalizePhone(changed.data?.phone) !== live.account.phone
      )
        denied(
          503,
          "enable_unconfirmed",
          "تعذر تأكيد تنشيط الدخول. جرّب تنشيط الحساب تاني.",
        );
      await transaction(async (db) => {
        await db.query(
          "select id from app_private.accounts where id=any($1::uuid[]) order by id for update",
          [[live.actor.id, studentId]],
        );
        const actor = await identity(db, token, "admin");
        const account = (
          await db.query("select * from app_private.accounts where id=$1", [
            studentId,
          ])
        ).rows[0];
        if (
          account.provisioning_locked ||
          account.recovery_locked ||
          account.auth_epoch !== live.account.auth_epoch
        )
          denied(
            409,
            "account_changed",
            "حالة الحساب اتغيّرت. راجعها وأعد المحاولة.",
          );
        await db.query(
          "update app_private.accounts set status='active' where id=$1",
          [studentId],
        );
        await audit(db, actor.id, action, "account", studentId);
      });
      return {
        message: "الحساب بقى نشط. التفعيل والسحب ومدد الوصول زي ما هي.",
        id: studentId,
      };
    });
  }
  return transaction(async (db) => {
    const observed = await identity(db, token, "admin"),
      studentId = uuid(body.studentId);
    await db.query(
      "select id from app_private.accounts where id=any($1::uuid[]) order by id for update",
      [[observed.id, studentId]],
    );
    const actor = await identity(db, token, "admin");
    const student = (
      await db.query(
        "select * from app_private.accounts where id=$1 and role='student'",
        [studentId],
      )
    ).rows[0];
    if (!student) denied(404, "student_not_found", "الطالب غير موجود.");
    if (student.provisioning_locked || student.recovery_locked)
      denied(
        409,
        "account_locked",
        "الحساب قيد التجهيز أو الاستعادة. أكمل مراجعة العملية أولًا.",
      );
    if (action === "student-update") {
      const name = text(body.name, 120),
        gradeId = uuid(body.gradeId);
      if (name.split(/\s+/).length < 2)
        denied(400, "invalid_name", "اكتب الاسم الكامل للطالب.");
      if (
        !(
          await db.query(
            "select id from app_private.grades where id=$1 and enabled",
            [gradeId],
          )
        ).rowCount
      )
        denied(400, "grade_unavailable", "الصف غير متاح.");
      await db.query(
        "update app_private.accounts set full_name=$2 where id=$1",
        [studentId, name],
      );
      await db.query(
        "update app_private.student_profiles set grade_id=$2 where account_id=$1",
        [studentId, gradeId],
      );
      await audit(db, actor.id, action, "account", studentId);
      return { message: "بيانات الطالب اتحفظت.", id: studentId };
    }
    if (action === "student-disable" || action === "student-enable") {
      const reason =
        action === "student-disable" ? text(body.reason, 500) : undefined;
      if (action === "student-disable") {
        await db.query(
          "update app_private.accounts set status='disabled',auth_epoch=auth_epoch+1 where id=$1 and status<>'disabled'",
          [studentId],
        );
        await db.query(
          "update app_private.sessions set revoked_at=clock_timestamp() where account_id=$1 and revoked_at is null",
          [studentId],
        );
      } else
        await db.query(
          "update app_private.accounts set status='active' where id=$1",
          [studentId],
        );
      await audit(db, actor.id, action, "account", studentId, reason);
      return {
        message:
          action === "student-disable"
            ? "الحساب اتعطّل وجلساته اتقفلت. مواعيد اشتراكاته محفوظة."
            : "الحساب بقى نشط. التفعيل والسحب ومدد الوصول زي ما هي.",
        id: studentId,
      };
    }
    if (action === "lesson-override") {
      const lessonId = uuid(body.lessonId),
        reason = text(body.reason, 500);
      if (
        !(
          await db.query(
            "select id from app_private.lessons where id=$1 and published_at is not null",
            [lessonId],
          )
        ).rowCount
      )
        denied(400, "lesson_unavailable", "اختار درسًا منشورًا.");
      const inserted = await db.query(
        `insert into app_private.gate_overrides(student_id,lesson_id,granted_by,reason,granted_at,operation_id)
        values($1,$2,$3,$4,clock_timestamp(),$5) on conflict do nothing`,
        [studentId, lessonId, actor.id, reason, randomUUID()],
      );
      if (inserted.rowCount)
        await audit(db, actor.id, action, "lesson", lessonId, reason);
      return {
        message:
          "الدرس اتفتح للطالب. المشاهدة ما زالت تحتاج حسابًا نشطًا ووصولًا ساريًا للكورس.",
        id: lessonId,
      };
    }
    if (action !== "access-withdraw" && action !== "access-extend")
      denied(404, "not_found", "العملية غير موجودة.");
    const courseId = uuid(body.courseId),
      reason = text(body.reason, 500),
      days = action === "access-extend" ? Number(body.days) : 0;
    if (
      action === "access-extend" &&
      (!Number.isSafeInteger(days) || days < 1 || days > 365)
    )
      denied(400, "invalid_days", "التمديد من يوم إلى ٣٦٥ يوم.");
    await db.query("select id from app_private.courses where id=$1 for share", [
      courseId,
    ]);
    const access = (
      await db.query(
        "select * from app_private.course_access where student_id=$1 and course_id=$2 for update",
        [studentId, courseId],
      )
    ).rows[0];
    if (!access || (action === "access-extend" && access.withdrawn_at))
      denied(
        409,
        "access_unavailable",
        "التمديد يحتاج وصولًا سابقًا غير مسحوب.",
      );
    if (action === "access-withdraw" && access.withdrawn_at)
      return { message: "الوصول مسحوب بالفعل.", id: courseId };
    const clock = (await db.query("select clock_timestamp()::text as time"))
        .rows[0].time,
      eventId = randomUUID(),
      operationId = randomUUID();
    const end =
      action === "access-withdraw"
        ? access.access_until
        : (
            await db.query(
              "select greatest($1::timestamptz,$2::timestamptz)+($3::integer*86400)*interval '1 second' as time",
              [access.access_until, clock, days],
            )
          ).rows[0].time;
    await db.query(
      `insert into app_private.access_events(id,student_id,course_id,epoch,kind,actor_id,operation_id,reason,added_days,occurred_at,access_started_at,access_until)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        eventId,
        studentId,
        courseId,
        access.epoch,
        action === "access-withdraw" ? "withdrawal" : "extension",
        actor.id,
        operationId,
        reason,
        days,
        clock,
        access.started_at,
        end,
      ],
    );
    await db.query(
      "update app_private.course_access set access_until=$3,last_event_id=$4,withdrawn_at=$5 where student_id=$1 and course_id=$2",
      [
        studentId,
        courseId,
        end,
        eventId,
        action === "access-withdraw" ? clock : null,
      ],
    );
    await audit(db, actor.id, action, "course", courseId, reason, operationId);
    return {
      message:
        action === "access-withdraw"
          ? "وصول الكورس اتسحب. الطالب يقدر يرجع بكود جديد صالح لو حسابه نشط والكورس منشور."
          : "مدة الوصول اتزادت، مع حفظ التقدم والنتائج.",
      id: courseId,
    };
  });
}
