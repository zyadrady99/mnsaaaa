import "server-only";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { transaction } from "@/server/core/db";
import { identity, tokenHash } from "@/server/auth/service";
import { keyedHash } from "@/server/core/crypto";
import { denied } from "@/server/core/errors";
import { uuid } from "@/server/catalog/admin";

export const watchCookie = "dorosna_watch";
export const watchSeconds = 120;
export async function courseAccess(
  db: PoolClient,
  studentId: string,
  courseId: string,
  allowExpired = false,
) {
  const course = (
    await db.query(
      "select id,title,status from app_private.courses where id=$1 for share",
      [courseId],
    )
  ).rows[0];
  const access = (
    await db.query(
      "select *,access_until>clock_timestamp() and started_at<=clock_timestamp() as active from app_private.course_access where student_id=$1 and course_id=$2 for share",
      [studentId, courseId],
    )
  ).rows[0];
  if (
    !course ||
    !access ||
    !["published", "archived"].includes(course.status) ||
    access.withdrawn_at ||
    (!allowExpired && !access.active)
  )
    denied(
      403,
      "access_required",
      "الوصول للكورس انتهى أو اتسحب. فعّل كودًا صالحًا علشان تكمل.",
    );
  return { course, access };
}
export async function lessonGate(
  db: PoolClient,
  studentId: string,
  lessonId: string,
) {
  const lesson = (
    await db.query(
      `select l.*,v.state as video_state,v.duration_seconds,v.local_fixture_ref from app_private.lessons l
    left join app_private.video_uploads v on v.id=l.current_video_id where l.id=$1 and l.published_at is not null for share of l`,
      [lessonId],
    )
  ).rows[0];
  if (!lesson)
    denied(404, "lesson_unavailable", "الدرس غير موجود أو لسه مش منشور.");
  const gate = (
    await db.query(
      `select
    exists(select 1 from app_private.gate_overrides where student_id=$1 and lesson_id=$2) or
    not exists(select 1 from app_private.lessons where course_id=$3 and published_at is not null and position<$4) or
    exists(select 1 from app_private.lessons p join app_private.lesson_progress lp on lp.lesson_id=p.id and lp.student_id=$1 and lp.completed_at is not null
      join app_private.assessments a on a.lesson_id=p.id and a.kind='homework'
      join app_private.homework_passes hp on hp.assessment_id=a.id and hp.student_id=$1
      where p.id=(select id from app_private.lessons where course_id=$3 and published_at is not null and position<$4 order by position desc limit 1)) as open`,
      [studentId, lessonId, lesson.course_id, lesson.position],
    )
  ).rows[0];
  if (!gate.open)
    denied(
      403,
      "lesson_locked",
      "كمّل الدرس السابق ونجّح في واجبه بنسبة ٧٠٪ علشان تفتح الدرس ده.",
    );
  return lesson;
}
export async function learningContext(
  db: PoolClient,
  studentId: string,
  lessonId: string,
  allowExpired = false,
) {
  const row = (
    await db.query("select course_id from app_private.lessons where id=$1", [
      lessonId,
    ])
  ).rows[0];
  if (!row) denied(404, "lesson_unavailable", "الدرس غير موجود.");
  const access = await courseAccess(db, studentId, row.course_id, allowExpired);
  const lesson = await lessonGate(db, studentId, lessonId);
  // Recheck time after all potentially contended locks.
  if (
    !allowExpired &&
    !(
      await db.query("select clock_timestamp()<$1::timestamptz as active", [
        access.access.access_until,
      ])
    ).rows[0].active
  )
    denied(403, "access_required", "مدة الوصول انتهت. جدّد الكورس بكود صالح.");
  return { ...access, lesson };
}
export async function validateWatch(
  db: PoolClient,
  studentId: string,
  sessionToken: string,
  watchToken: string,
  lessonId: string,
  generation: unknown,
) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(watchToken) ||
    typeof generation !== "string" ||
    !/^\d{1,16}$/.test(generation)
  )
    denied(
      409,
      "watch_transferred",
      "جلسة المشاهدة انتهت أو اتنقلت. شغّل الفيديو من جديد.",
    );
  const lease = (
    await db.query(
      `select * from app_private.watch_leases where student_id=$1 and lesson_id=$2 and generation=$3
    and token_digest=$4 and device_digest=$5 and expires_at>clock_timestamp() for update`,
      [
        studentId,
        lessonId,
        generation,
        Buffer.from(tokenHash(watchToken), "hex"),
        keyedHash("device", sessionToken),
      ],
    )
  ).rows[0];
  if (!lease)
    denied(
      409,
      "watch_transferred",
      "جلسة المشاهدة انتهت أو اتنقلت. شغّل الفيديو من جديد.",
    );
  return lease;
}
export async function learningCommand(
  action: string,
  body: Record<string, unknown>,
  sessionToken: string,
  watchToken: string,
) {
  return transaction(async (db) => {
    const actor = await identity(db, sessionToken, "student", true),
      lessonId = uuid(body.lessonId);
    const { lesson } = await learningContext(db, actor.id, lessonId);
    if (action === "complete") {
      await db.query(
        `insert into app_private.lesson_progress(student_id,lesson_id,completed_at) values($1,$2,clock_timestamp())
        on conflict(student_id,lesson_id) do update set completed_at=coalesce(app_private.lesson_progress.completed_at,excluded.completed_at),revision=app_private.lesson_progress.revision+1`,
        [actor.id, lessonId],
      );
      await db.query(
        "update app_private.lessons set first_used_at=coalesce(first_used_at,clock_timestamp()) where id=$1",
        [lessonId],
      );
      return {
        message: "الدرس مكتمل. النجاح في الواجب يفتح الدرس اللي بعده.",
        completed: true,
      };
    }
    if (action === "video-open") {
      if (lesson.video_state !== "ready" || !lesson.local_fixture_ref)
        denied(409, "video_unavailable", "الفيديو لسه مش جاهز.");
      const existing = (
        await db.query(
          "select *,expires_at>clock_timestamp() as active from app_private.watch_leases where student_id=$1 for update",
          [actor.id],
        )
      ).rows[0];
      const device = keyedHash("device", sessionToken);
      if (
        existing?.active &&
        (existing.lesson_id !== lessonId ||
          !existing.device_digest.equals(device)) &&
        body.transfer !== true
      )
        denied(
          409,
          "watch_in_use",
          "في مشاهدة شغّالة على جهاز أو درس تاني. انقل المشاهدة هنا علشان تكمل.",
        );
      const token = randomBytes(32).toString("base64url");
      const lease = (
        await db.query(
          `insert into app_private.watch_leases(student_id,lesson_id,generation,device_digest,token_digest,acquired_at,heartbeat_at,expires_at)
        values($1,$2,1,$3,$4,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '120 seconds')
        on conflict(student_id) do update set lesson_id=excluded.lesson_id,generation=app_private.watch_leases.generation+1,device_digest=excluded.device_digest,
          token_digest=excluded.token_digest,acquired_at=excluded.acquired_at,heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at returning generation`,
          [actor.id, lessonId, device, Buffer.from(tokenHash(token), "hex")],
        )
      ).rows[0];
      await db.query(
        "update app_private.lessons set first_used_at=coalesce(first_used_at,clock_timestamp()) where id=$1",
        [lessonId],
      );
      const progress = (
        await db.query(
          "select position_seconds,revision from app_private.lesson_progress where student_id=$1 and lesson_id=$2",
          [actor.id, lessonId],
        )
      ).rows[0];
      return {
        watchToken: token,
        generation: String(lease.generation),
        durationSeconds: Number(lesson.duration_seconds),
        positionSeconds: Number(progress?.position_seconds ?? 0),
        revision: String(progress?.revision ?? "0"),
      };
    }
    await validateWatch(
      db,
      actor.id,
      sessionToken,
      watchToken,
      lessonId,
      body.generation,
    );
    if (action === "heartbeat") {
      await db.query(
        "update app_private.watch_leases set heartbeat_at=clock_timestamp(),expires_at=clock_timestamp()+interval '120 seconds' where student_id=$1",
        [actor.id],
      );
      return { renewed: true };
    }
    if (action !== "position") denied(404, "not_found", "العملية غير موجودة.");
    const seconds = Number(body.seconds),
      revision = String(body.revision);
    if (
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      seconds > Number(lesson.duration_seconds) + 1 ||
      !/^\d{1,15}$/.test(revision) ||
      BigInt(revision) < BigInt(1)
    )
      denied(400, "invalid_position", "موضع المشاهدة غير صحيح.");
    const saved = (
      await db.query(
        `insert into app_private.lesson_progress(student_id,lesson_id,position_seconds,revision) values($1,$2,$3,$4)
      on conflict(student_id,lesson_id) do update set position_seconds=excluded.position_seconds,revision=excluded.revision
      where app_private.lesson_progress.revision<excluded.revision returning revision`,
        [
          actor.id,
          lessonId,
          Math.min(seconds, Number(lesson.duration_seconds)),
          revision,
        ],
      )
    ).rows[0];
    if (saved) return { saved: true, revision: String(saved.revision) };
    const current = (
      await db.query(
        "select revision from app_private.lesson_progress where student_id=$1 and lesson_id=$2",
        [actor.id, lessonId],
      )
    ).rows[0];
    return { saved: false, revision: String(current.revision) };
  });
}
