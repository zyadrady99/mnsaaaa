import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { transaction } from "@/server/core/db";
import { identity } from "@/server/auth/service";
import { denied } from "@/server/core/errors";
import { audit, text, uuid } from "@/server/catalog/admin";
import {
  keyedHash,
  newCode,
  normalizedCode,
  seal,
  unseal,
} from "@/server/core/crypto";

export const codeActions: Record<string, string[]> = {
  "codes-generate": [
    "courseId",
    "durationDays",
    "quantity",
    "activateBefore",
    "requestId",
  ],
  "code-cancel": ["id"],
};
export async function adminCodeCommand(
  action: string,
  body: Record<string, unknown>,
  token: string,
) {
  return transaction(async (db) => {
    const actor = await identity(db, token, "admin", true);
    if (action === "code-cancel") {
      const id = uuid(body.id),
        code = (
          await db.query(
            "select * from app_private.activation_codes where id=$1 for update",
            [id],
          )
        ).rows[0];
      if (!code) denied(404, "code_unavailable", "الكود غير موجود.");
      if (
        (
          await db.query(
            "select id from app_private.activations where code_id=$1",
            [id],
          )
        ).rowCount
      )
        denied(
          409,
          "used_code",
          "الكود المستخدم مينفعش يتلغى. تقدر تسحب وصول الطالب من صفحة الطالب.",
        );
      if (!code.cancelled_at) {
        await db.query(
          "update app_private.activation_codes set cancelled_at=clock_timestamp(),cancelled_by=$2,cancellation_reason='admin_cancelled_unused' where id=$1",
          [id, actor.id],
        );
        await audit(db, actor.id, action, "code", id);
      }
      return { message: "الكود غير المستخدم اتلغى.", id };
    }
    if (action !== "codes-generate")
      denied(404, "not_found", "العملية غير موجودة.");
    const courseId = uuid(body.courseId),
      requestId = uuid(body.requestId),
      days = Number(body.durationDays),
      quantity = Number(body.quantity);
    if (
      ![30, 60, 90].includes(days) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 500
    )
      denied(
        400,
        "invalid_batch",
        "اختار مدة ٣٠ أو ٦٠ أو ٩٠ يوم، وعددًا من ١ إلى ٥٠٠ كود.",
      );
    let activateBefore: string | null = null;
    if (body.activateBefore) {
      const raw = text(body.activateBefore, 40);
      if (!/[Z]|[+-]\d\d:\d\d$/.test(raw) || !Number.isFinite(Date.parse(raw)))
        denied(400, "invalid_time", "راجع آخر موعد للتفعيل.");
      activateBefore = new Date(raw).toISOString();
    }
    const digest = createHash("sha256")
      .update(JSON.stringify([courseId, days, quantity, activateBefore]))
      .digest();
    const existing = (
      await db.query(
        "select * from app_private.code_batches where created_by=$1 and request_id=$2",
        [actor.id, requestId],
      )
    ).rows[0];
    if (existing) {
      if (!existing.request_digest.equals(digest))
        denied(
          409,
          "request_conflict",
          "طلب إنشاء الدفعة اتغيّر. ابدأ طلبًا جديدًا.",
        );
      return {
        message: "الدفعة موجودة بالفعل، من غير إنشاء أكواد إضافية.",
        id: existing.id,
        next: `/admin/codes/${existing.id}`,
      };
    }
    const course = (
      await db.query(
        "select status from app_private.courses where id=$1 and deleted_at is null for share",
        [courseId],
      )
    ).rows[0];
    if (!course || course.status !== "published")
      denied(409, "course_unavailable", "توليد الأكواد يحتاج كورسًا منشورًا.");
    const clock = (await db.query("select clock_timestamp()::text as time"))
      .rows[0].time as string;
    if (activateBefore && Date.parse(activateBefore) <= Date.parse(clock))
      denied(400, "invalid_time", "آخر موعد للتفعيل لازم يكون في المستقبل.");
    const batchId = randomUUID();
    await db.query(
      `insert into app_private.code_batches(id,course_id,duration_days,quantity,activate_before,created_by,request_id,request_digest,created_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        batchId,
        courseId,
        days,
        quantity,
        activateBefore,
        actor.id,
        requestId,
        digest,
        clock,
      ],
    );
    for (let i = 0; i < quantity; i++) {
      const id = randomUUID(),
        raw = newCode(),
        normalized = normalizedCode(raw)!;
      await db.query(
        `insert into app_private.activation_codes(id,batch_id,course_id,duration_days,code_digest,export_ciphertext,encryption_key_id,masked_suffix)
        values($1,$2,$3,$4,$5,$6,'local-v1',$7)`,
        [
          id,
          batchId,
          courseId,
          days,
          keyedHash("activation", normalized),
          seal(raw, `code:${id}`),
          raw.slice(-4),
        ],
      );
    }
    await audit(
      db,
      actor.id,
      action,
      "code_batch",
      batchId,
      undefined,
      requestId,
    );
    return {
      message: "دفعة الأكواد اتعملت. تقدر تنزّلها CSV من صفحة الدفعة.",
      id: batchId,
      next: `/admin/codes/${batchId}`,
    };
  });
}
export async function exportCodes(batchId: string, token: string) {
  return transaction(async (db) => {
    const actor = await identity(db, token, "admin", true);
    uuid(batchId);
    const batch = (
      await db.query(
        "select b.*,c.title from app_private.code_batches b join app_private.courses c on c.id=b.course_id where b.id=$1 and b.deleted_at is null",
        [batchId],
      )
    ).rows[0];
    if (!batch) denied(404, "not_found", "الدفعة غير موجودة.");
    const rows = (
      await db.query(
        `select c.id,c.export_ciphertext,c.cancelled_at,a.activated_at from app_private.activation_codes c
      left join app_private.activations a on a.code_id=c.id where c.batch_id=$1 and c.deleted_at is null order by c.id`,
        [batchId],
      )
    ).rows;
    const safe = (value: unknown) => {
      let s = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replaceAll('"', '""')}"`;
    };
    const output = [
      ["الكود", "الكورس", "المدة بالأيام", "آخر موعد للتفعيل UTC", "الحالة"],
      ...rows.map((row) => [
        unseal(row.export_ciphertext, `code:${row.id}`),
        batch.title,
        batch.duration_days,
        batch.activate_before
          ? new Date(batch.activate_before).toISOString()
          : "بدون موعد نهائي",
        row.activated_at ? "مستخدم" : row.cancelled_at ? "ملغي" : "غير مستخدم",
      ]),
    ]
      .map((row) => row.map(safe).join(","))
      .join("\r\n");
    await audit(db, actor.id, "codes_export", "code_batch", batchId);
    return `\uFEFF${output}\r\n`;
  });
}
async function lockedCode(db: import("pg").PoolClient, raw: unknown) {
  const code = normalizedCode(raw);
  if (!code)
    denied(400, "code_unavailable", "راجع الكود المكتوب. الكود غير متاح.");
  const found = (
    await db.query(
      "select course_id from app_private.activation_codes where code_digest=$1",
      [keyedHash("activation", code)],
    )
  ).rows[0];
  if (!found)
    denied(400, "code_unavailable", "راجع الكود المكتوب. الكود غير متاح.");
  const course = (
    await db.query(
      "select id,title,slug,status,deleted_at from app_private.courses where id=$1 for share",
      [found.course_id],
    )
  ).rows[0];
  const row = (
    await db.query(
      `select c.*,b.activate_before,b.activate_before is null or clock_timestamp()<b.activate_before as unexpired from app_private.activation_codes c
    join app_private.code_batches b on b.id=c.batch_id where c.code_digest=$1 for update of c`,
      [keyedHash("activation", code)],
    )
  ).rows[0];
  return { course, row };
}
export async function studentCodeCommand(
  action: string,
  body: Record<string, unknown>,
  token: string,
) {
  return transaction(async (db) => {
    const actor = await identity(db, token, "student", true),
      { course, row } = await lockedCode(db, body.code);
    const prior = (
      await db.query("select * from app_private.activations where code_id=$1", [
        row.id,
      ])
    ).rows[0];
    const access = (
      await db.query(
        "select *,access_until>clock_timestamp() as active from app_private.course_access where student_id=$1 and course_id=$2 for update",
        [actor.id, course.id],
      )
    ).rows[0];
    if (prior && prior.student_id !== actor.id)
      denied(400, "code_unavailable", "الكود غير متاح. راجع إدارة السنتر.");
    if (
      !prior &&
      (course.status !== "published" ||
        course.deleted_at ||
        row.deleted_at ||
        row.cancelled_at ||
        !row.unexpired)
    )
      denied(400, "code_unavailable", "الكود غير متاح. راجع إدارة السنتر.");
    if (action === "preview")
      return {
        courseId: course.id,
        title: course.title,
        durationDays: row.duration_days,
        replay: Boolean(prior),
        withdrawn: Boolean(access?.withdrawn_at),
      };
    if (action !== "activate" || body.courseId !== course.id)
      denied(400, "course_mismatch", "راجع اسم الكورس ووافق على تفعيله أولًا.");
    if (prior)
      return {
        message: access?.withdrawn_at
          ? "الكود ده اتستخدم قبل كده ووصوله مسحوب. للرجوع محتاج كود جديد صالح."
          : "الكود ده متفعّل لحسابك بالفعل؛ مدته ما اتضافتش مرة تانية.",
        replay: true,
        courseId: course.id,
        accessUntil: access.access_until,
        withdrawn: Boolean(access.withdrawn_at),
      };
    const clock = (await db.query("select clock_timestamp()::text as time"))
      .rows[0].time;
    // Re-evaluate the deadline after all contention, without JS millisecond truncation.
    if (
      row.activate_before &&
      !(
        await db.query("select $1::timestamptz<$2::timestamptz as ok", [
          clock,
          row.activate_before,
        ])
      ).rows[0].ok
    )
      denied(400, "code_unavailable", "الكود غير متاح. راجع إدارة السنتر.");
    const period = (
      await db.query(
        `select
      case when $1::timestamptz is not null and $2::timestamptz is null and $1::timestamptz>$3::timestamptz then $4::timestamptz else $3::timestamptz end as starts,
      (case when $2::timestamptz is null then greatest($3::timestamptz,$1::timestamptz) else $3::timestamptz end)+($5::integer*86400)*interval '1 second' as ends,
      $1::timestamptz is not null and $2::timestamptz is null and $1::timestamptz>$3::timestamptz as continuous`,
        [
          access?.access_until ?? null,
          access?.withdrawn_at ?? null,
          clock,
          access?.started_at ?? null,
          row.duration_days,
        ],
      )
    ).rows[0];
    const epoch = access ? access.epoch + (period.continuous ? 0 : 1) : 1,
      kind = !access ? "grant" : access.withdrawn_at ? "regrant" : "renewal",
      activationId = randomUUID(),
      eventId = randomUUID(),
      operationId = randomUUID();
    await db.query(
      `insert into app_private.activations(id,code_id,student_id,course_id,duration_days,access_event_id,activated_at) values($1,$2,$3,$4,$5,$6,$7)`,
      [
        activationId,
        row.id,
        actor.id,
        course.id,
        row.duration_days,
        eventId,
        clock,
      ],
    );
    await db.query(
      `insert into app_private.access_events(id,student_id,course_id,epoch,kind,activation_id,actor_id,operation_id,added_days,occurred_at,access_started_at,access_until)
      values($1,$2,$3,$4,$5,$6,$2,$7,$8,$9,$10,$11)`,
      [
        eventId,
        actor.id,
        course.id,
        epoch,
        kind,
        activationId,
        operationId,
        row.duration_days,
        clock,
        period.starts,
        period.ends,
      ],
    );
    await db.query(
      `insert into app_private.course_access(student_id,course_id,epoch,started_at,access_until,last_event_id) values($1,$2,$3,$4,$5,$6)
      on conflict(student_id,course_id) do update set epoch=excluded.epoch,started_at=excluded.started_at,access_until=excluded.access_until,last_event_id=excluded.last_event_id,withdrawn_at=null`,
      [actor.id, course.id, epoch, period.starts, period.ends, eventId],
    );
    await audit(
      db,
      actor.id,
      "code_activate",
      "activation",
      activationId,
      undefined,
      operationId,
    );
    return {
      message: "الكورس اتفعّل. تقدّمك ونتائجك السابقة محفوظين.",
      courseId: course.id,
      replay: false,
      accessUntil: period.ends,
      withdrawn: false,
    };
  });
}
