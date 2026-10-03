import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
process.loadEnvFile(".env.local");
const origin = "http://127.0.0.1:3000";
if (process.env.DOROSNA_LOCAL_ONLY !== "1" || process.env.APP_ORIGIN !== origin)
  throw new Error("Local tests only.");
const admin = JSON.parse(readFileSync(".local/admin-account.json", "utf8")),
  student = JSON.parse(readFileSync(".local/student-account.json", "utf8"));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const results = [];
async function test(name, run) {
  await run();
  results.push({ name, passed: true });
}
async function post(path, body, cookie = "") {
  const response = await fetch(`${origin}/api/${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    response,
    data: await response.json(),
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
  };
}
let adminCookie = "",
  studentCookie = "",
  batchId,
  codes;
try {
  await db.connect();
  const signAdmin = await post("auth/login", {
    phone: admin.phone,
    password: admin.password,
  });
  assert.equal(signAdmin.response.status, 200);
  adminCookie = signAdmin.cookie;
  const signStudent = await post("auth/login", {
    phone: student.phone,
    password: student.password,
  });
  assert.equal(signStudent.response.status, 200);
  studentCookie = signStudent.cookie;
  const course = (
    await db.query(
      "select id from app_private.courses where slug='physics-electricity' and status='published'",
    )
  ).rows[0];
  assert.ok(course);
  const account = (
    await db.query("select id from app_private.accounts where phone=$1", [
      `+20${student.phone.slice(1)}`,
    ])
  ).rows[0];
  const body = {
    courseId: course.id,
    durationDays: 30,
    quantity: 4,
    requestId: randomUUID(),
    activateBefore: "",
  };
  await test("student_cannot_generate_codes", async () =>
    assert.equal(
      (await post("admin/codes-generate", body, studentCookie)).response.status,
      403,
    ));
  await test("batch_created_with_exact_quantity", async () => {
    const generated = await post("admin/codes-generate", body, adminCookie);
    assert.equal(generated.response.status, 200);
    batchId = generated.data.id;
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.activation_codes where batch_id=$1",
          [batchId],
        )
      ).rows[0].n,
      4,
    );
  });
  await test("batch_retry_is_idempotent", async () =>
    assert.equal(
      (await post("admin/codes-generate", body, adminCookie)).data.id,
      batchId,
    ));
  await test("changed_batch_retry_rejected", async () =>
    assert.equal(
      (
        await post(
          "admin/codes-generate",
          { ...body, quantity: 5 },
          adminCookie,
        )
      ).response.status,
      409,
    ));
  await test("export_requires_admin_and_roundtrips_codes", async () => {
    const denied = await fetch(`${origin}/api/admin/code-export/${batchId}`, {
      headers: { Cookie: studentCookie },
    });
    assert.equal(denied.status, 403);
    const exported = await fetch(`${origin}/api/admin/code-export/${batchId}`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(exported.status, 200);
    const csv = await exported.text();
    codes = [
      ...csv.matchAll(
        /DRS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}/g,
      ),
    ].map((x) => x[0]);
    assert.equal(codes.length, 4);
    const page = await fetch(`${origin}/admin/codes/${batchId}`, {
      headers: { Cookie: adminCookie },
    });
    const html = await page.text();
    for (const code of codes) assert.ok(!html.includes(code));
  });
  await test("preview_requires_confirmation_and_does_not_activate", async () => {
    const preview = await post(
      "codes/preview",
      { code: codes[0] },
      studentCookie,
    );
    assert.equal(preview.response.status, 200);
    assert.equal(preview.data.courseId, course.id);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.activations a join app_private.activation_codes c on c.id=a.code_id where c.batch_id=$1",
          [batchId],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await post(
          "codes/activate",
          { code: codes[0], courseId: randomUUID() },
          studentCookie,
        )
      ).response.status,
      400,
    );
  });
  // A reused test account may have prior access; withdraw it so this run also
  // tests a fresh period without resetting any activation history.
  const previous = (
    await db.query(
      "select withdrawn_at from app_private.course_access where student_id=$1 and course_id=$2",
      [account.id, course.id],
    )
  ).rows[0];
  if (previous && !previous.withdrawn_at) {
    const withdrawn = await post(
      "admin/access-withdraw",
      {
        studentId: account.id,
        courseId: course.id,
        reason: "بدء جولة تحقق محلية جديدة",
      },
      adminCookie,
    );
    assert.equal(withdrawn.response.status, 200);
  }
  await test("activation_starts_exact_thirty_day_period", async () => {
    const activated = await post(
      "codes/activate",
      { code: codes[0], courseId: course.id },
      studentCookie,
    );
    assert.equal(activated.response.status, 200);
    const period = (
      await db.query(
        "select extract(epoch from(access_until-started_at))::bigint as seconds from app_private.course_access where student_id=$1 and course_id=$2",
        [account.id, course.id],
      )
    ).rows[0];
    assert.equal(period.seconds, "2592000");
  });
  await test("own_code_replay_does_not_add_days", async () => {
    const before = (
      await db.query(
        "select access_until::text t from app_private.course_access where student_id=$1 and course_id=$2",
        [account.id, course.id],
      )
    ).rows[0].t;
    const replay = await post(
      "codes/activate",
      { code: codes[0], courseId: course.id },
      studentCookie,
    );
    assert.equal(replay.data.replay, true);
    assert.equal(
      (
        await db.query(
          "select access_until::text t from app_private.course_access where student_id=$1 and course_id=$2",
          [account.id, course.id],
        )
      ).rows[0].t,
      before,
    );
  });
  let renewedEnd;
  await test("active_renewal_adds_exact_thirty_days", async () => {
    const before = (
      await db.query(
        "select access_until::text t from app_private.course_access where student_id=$1 and course_id=$2",
        [account.id, course.id],
      )
    ).rows[0].t;
    assert.equal(
      (
        await post(
          "codes/activate",
          { code: codes[1], courseId: course.id },
          studentCookie,
        )
      ).response.status,
      200,
    );
    const delta = (
      await db.query(
        "select extract(epoch from(access_until-$3::timestamptz))::bigint seconds,access_until::text as t from app_private.course_access where student_id=$1 and course_id=$2",
        [account.id, course.id, before],
      )
    ).rows[0];
    assert.equal(delta.seconds, "2592000");
    renewedEnd = delta.t;
  });
  await test("withdrawn_old_code_does_not_restore_access", async () => {
    assert.equal(
      (
        await post(
          "admin/access-withdraw",
          {
            studentId: account.id,
            courseId: course.id,
            reason: "اختبار السحب والرجوع بكود جديد",
          },
          adminCookie,
        )
      ).response.status,
      200,
    );
    const replay = await post(
      "codes/activate",
      { code: codes[0], courseId: course.id },
      studentCookie,
    );
    assert.equal(replay.data.withdrawn, true);
    assert.equal(replay.data.replay, true);
  });
  await test("D28_new_code_after_withdrawal_starts_from_now", async () => {
    const activated = await post(
      "codes/activate",
      { code: codes[2], courseId: course.id },
      studentCookie,
    );
    assert.equal(activated.response.status, 200);
    assert.equal(activated.data.withdrawn, false);
    const period = (
      await db.query(
        "select extract(epoch from(access_until-started_at))::bigint seconds,access_until<$3::timestamptz as old_future_not_restored from app_private.course_access where student_id=$1 and course_id=$2",
        [account.id, course.id, renewedEnd],
      )
    ).rows[0];
    assert.equal(period.seconds, "2592000");
    assert.equal(period.old_future_not_restored, true);
  });
  await test("used_code_cannot_be_cancelled_unused_code_can", async () => {
    const rows = (
      await db.query(
        "select c.id,a.id is not null as used from app_private.activation_codes c left join app_private.activations a on a.code_id=c.id where c.batch_id=$1",
        [batchId],
      )
    ).rows;
    const used = rows.find((r) => r.used),
      unused = rows.find((r) => !r.used);
    assert.equal(
      (await post("admin/code-cancel", { id: used.id }, adminCookie)).response
        .status,
      409,
    );
    assert.equal(
      (await post("admin/code-cancel", { id: unused.id }, adminCookie)).response
        .status,
      200,
    );
    assert.equal(
      (await post("codes/preview", { code: codes[3] }, studentCookie)).response
        .status,
      400,
    );
  });
  await post("auth/logout", {}, adminCookie);
  await post("auth/logout", {}, studentCookie);
  writeFileSync(
    ".local/f08-codes-result.json",
    JSON.stringify(
      {
        localOnly: true,
        passed: results.length,
        results,
        secretsPrinted: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: results.length,
      checks: results.map((r) => r.name),
      secretsPrinted: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      passed: results.length,
      failedAfter: results.at(-1)?.name ?? "start",
      failure:
        error instanceof assert.AssertionError
          ? "assertion_failed"
          : "runtime_failure",
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
