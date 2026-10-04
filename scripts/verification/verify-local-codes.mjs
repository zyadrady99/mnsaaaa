import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { projectPath } from "../shared/paths.mjs";
process.loadEnvFile(projectPath(".env.local"));
const origin = "http://127.0.0.1:3000";
if (process.env.DOROSNA_LOCAL_ONLY !== "1" || process.env.APP_ORIGIN !== origin)
  throw new Error("Local tests only.");
const admin = JSON.parse(
    readFileSync(projectPath(".local/admin-account.json"), "utf8"),
  ),
  student = JSON.parse(
    readFileSync(projectPath(".local/student-account.json"), "utf8"),
  );
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const results = [];
const ownedFixtures = [];
let lastOperation = "start";
async function test(name, run) {
  await run();
  results.push({ name, passed: true });
}
async function post(path, body, cookie = "") {
  lastOperation = path;
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
async function adminPost(path, body) {
  const result = await post(`admin/${path}`, body, adminCookie);
  assert.equal(result.response.status, 200);
  return result.data;
}
async function prepareCourseFixture() {
  const suffix = randomUUID();
  const grade = (
    await db.query(
      "select id from app_private.grades where slug='g3' and enabled and deleted_at is null",
    )
  ).rows[0];
  assert.ok(grade);
  const subject = await adminPost("subject-create", {
    name: "مادة تحقق الأكواد " + suffix,
    slug: "codes-subject-" + suffix,
  });
  ownedFixtures.push({
    kind: "reference",
    id: subject.id,
    referenceKind: "subject",
  });
  const teacher = await adminPost("teacher-save", {
    name: "مدرس تحقق الأكواد " + suffix,
    slug: "codes-teacher-" + suffix,
    subjectId: subject.id,
    description: "بيانات تحقق محلية مستقلة",
    portrait: "/images/teacher-ahmed.svg",
    approach: "اختبار تفعيل الاشتراكات",
    enabled: true,
  });
  ownedFixtures.push({ kind: "teacher", id: teacher.id });
  const course = await adminPost("course-save", {
    title: "كورس تحقق الأكواد " + suffix,
    slug: "codes-course-" + suffix,
    teacherId: teacher.id,
    gradeId: grade.id,
    subjectId: subject.id,
    cover: "/images/course-physics.svg",
    subtitle: "تجربة محلية مستقلة",
    description:
      "كورس خاص بهذه الجولة للتحقق من الأكواد دون تعديل كتالوج العرض",
    outcomes: "اختبار اشتراك الطالب وتجديده وسحب الوصول",
  });
  ownedFixtures.push({ kind: "course", id: course.id });
  const unit = await adminPost("unit-save", {
    courseId: course.id,
    title: "وحدة تحقق الأكواد",
  });
  const lesson = await adminPost("lesson-save", {
    courseId: course.id,
    unitId: unit.id,
    title: "درس تحقق الأكواد",
    minutes: 20,
    description: "درس تجريبي لتهيئة كورس قابل للنشر",
  });
  await adminPost("video-fixture", { lessonId: lesson.id });
  const homework = await adminPost("assessment-save", {
    courseId: course.id,
    lessonId: lesson.id,
    kind: "homework",
    title: "واجب تحقق الأكواد",
    questions: [
      {
        prompt: "١ + ١ يساوي؟",
        options: ["٢", "٣"],
        correct: 0,
        points: 1,
        explanation: "سؤال تحقق تجريبي",
      },
    ],
  });
  await adminPost("assessment-publish", { versionId: homework.versionId });
  await adminPost("lesson-publish", { lessonId: lesson.id });
  await adminPost("course-publish", { id: course.id });
  const published = (
    await db.query(
      "select id from app_private.courses where id=$1 and status='published' and deleted_at is null",
      [course.id],
    )
  ).rows[0];
  assert.ok(published);
  return published;
}
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
  const course = await prepareCourseFixture();
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
  // This run owns a new course, so its first activation always starts a fresh period.
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
  writeFileSync(
    projectPath(".local/f08-codes-result.json"),
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
      operation: lastOperation,
      failure:
        error instanceof assert.AssertionError
          ? "assertion_failed"
          : "runtime_failure",
    }),
  );
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  for (const kind of ["course", "teacher", "reference"]) {
    for (const fixture of ownedFixtures.filter((item) => item.kind === kind)) {
      try {
        const result = await post(
          `admin/${kind}-delete`,
          {
            id: fixture.id,
            confirm: true,
            ...(fixture.referenceKind ? { kind: fixture.referenceKind } : {}),
          },
          adminCookie,
        );
        if (![200, 404].includes(result.response.status)) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (cleanupFailed) {
    console.error(
      JSON.stringify({ fixtureCleanup: "failed", secretsPrinted: false }),
    );
    process.exitCode = 1;
  }
  if (adminCookie) await post("auth/logout", {}, adminCookie).catch(() => {});
  if (studentCookie)
    await post("auth/logout", {}, studentCookie).catch(() => {});
  await db.end();
}
