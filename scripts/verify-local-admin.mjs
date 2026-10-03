import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
process.loadEnvFile(".env.local");
const origin = "http://127.0.0.1:3000";
if (process.env.DOROSNA_LOCAL_ONLY !== "1" || process.env.APP_ORIGIN !== origin)
  throw new Error("Local verification only.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }),
  checks = [];
async function api(path, body, cookie = "") {
  const res = await fetch(origin + "/api/" + path, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    data: await res.json(),
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
  };
}
async function ok(path, body, cookie) {
  const res = await api(path, body, cookie);
  assert.ok(
    [200, 201].includes(res.status),
    `${path}: ${res.data.error ?? res.status}`,
  );
  return res;
}
async function test(name, run) {
  await run();
  checks.push({ name, passed: true });
  console.log("PASS", name);
}
let adminCookie = "",
  studentCookie = "";
async function waitVideo(id, state) {
  const stop = Date.now() + 16000;
  while (Date.now() < stop) {
    const row = (
      await db.query(
        "select v.id,v.state from app_private.lessons l join app_private.video_uploads v on v.id=l.current_video_id where l.id=$1",
        [id],
      )
    ).rows[0];
    if (row?.state === state) return row;
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`Fixture processing did not reach ${state}.`);
}
try {
  await db.connect();
  const admin = JSON.parse(readFileSync(".local/admin-account.json", "utf8")),
    student = JSON.parse(readFileSync(".local/student-account.json", "utf8"));
  adminCookie = (
    await ok("auth/login", { phone: admin.phone, password: admin.password })
  ).cookie;
  studentCookie = (
    await ok("auth/login", { phone: student.phone, password: student.password })
  ).cookie;
  const suffix = randomUUID().slice(0, 8),
    name = "مادة تجربة " + suffix;
  let subjectId, teacherId, courseId, unitId, lessonId;
  await test("admin_can_create_subject_and_teacher", async () => {
    subjectId = (
      await ok(
        "admin/subject-create",
        { name, slug: "test-" + suffix },
        adminCookie,
      )
    ).data.id;
    teacherId = (
      await ok(
        "admin/teacher-save",
        {
          name: "مدرس مراجعة محلي " + suffix,
          slug: "teacher-" + suffix,
          subjectId,
          description: "بيانات تحقق تجريبية",
          portrait: "/images/teacher-ahmed.svg",
          approach: "خطوة تجريبية",
          enabled: true,
        },
        adminCookie,
      )
    ).data.id;
  });
  const gradeId = (
    await db.query("select id from app_private.grades where slug='g3'")
  ).rows[0].id;
  const courseBody = {
    title: "كورس مراجعة محلي " + suffix,
    slug: "course-test-" + suffix,
    teacherId,
    subjectId,
    gradeId,
    description: "كورس للتحقق المحلي",
    subtitle: "محتوى تجريبي",
    cover: "/images/course-physics.svg",
    outcomes: "تجربة رحلة النشر",
  };
  await test("student_cannot_create_or_edit_catalog", async () =>
    assert.equal(
      (await api("admin/course-save", courseBody, studentCookie)).status,
      403,
    ));
  courseId = (await ok("admin/course-save", courseBody, adminCookie)).data.id;
  await test("draft_course_hidden_and_publish_requires_ready_lesson", async () => {
    const html = await (
      await fetch(origin + "/courses/" + courseBody.slug)
    ).text();
    assert.ok(!html.includes(courseBody.title));
    assert.equal(
      (await api("admin/course-publish", { id: courseId }, adminCookie)).status,
      409,
    );
  });
  unitId = (
    await ok("admin/unit-save", { courseId, title: "وحدة تجربة" }, adminCookie)
  ).data.id;
  await test("only_unlinked_draft_lesson_and_empty_unit_can_be_deleted", async () => {
    const temporaryUnit = (
      await ok(
        "admin/unit-save",
        { courseId, title: "وحدة فارغة مؤقتة" },
        adminCookie,
      )
    ).data.id;
    const temporary = (
      await ok(
        "admin/lesson-save",
        {
          courseId,
          unitId: temporaryUnit,
          title: "مسودة مؤقتة",
          minutes: 20,
          description: "",
        },
        adminCookie,
      )
    ).data.id;
    assert.equal(
      (await api("admin/unit-delete", { id: temporaryUnit }, adminCookie))
        .status,
      409,
    );
    await ok("admin/lesson-delete", { id: temporary }, adminCookie);
    await ok("admin/unit-delete", { id: temporaryUnit }, adminCookie);
  });
  lessonId = (
    await ok(
      "admin/lesson-save",
      {
        courseId,
        unitId,
        title: "درس اختبار جاهزية",
        minutes: 20,
        description: "",
      },
      adminCookie,
    )
  ).data.id;
  await test("lesson_publish_denies_missing_video_and_homework", async () =>
    assert.equal(
      (await api("admin/lesson-publish", { lessonId }, adminCookie)).status,
      409,
    ));
  let oldVideo;
  await test("local_video_processing_failures_and_retry_are_versioned", async () => {
    await ok("admin/video-submit", { lessonId }, adminCookie);
    oldVideo = (
      await db.query(
        "select current_video_id from app_private.lessons where id=$1",
        [lessonId],
      )
    ).rows[0].current_video_id;
    await ok(
      "admin/video-submit",
      { lessonId, simulateFailure: true },
      adminCookie,
    );
    await waitVideo(lessonId, "failed");
    assert.equal(
      (
        await db.query(
          "select state from app_private.video_uploads where id=$1",
          [oldVideo],
        )
      ).rows[0].state,
      "processing",
    );
    assert.equal(
      (await api("admin/lesson-publish", { lessonId }, adminCookie)).status,
      409,
    );
    await ok("admin/video-retry", { lessonId }, adminCookie);
    await waitVideo(lessonId, "ready");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.video_uploads where lesson_id=$1",
          [lessonId],
        )
      ).rows[0].n,
      3,
    );
  });
  await test("ready_video_alone_cannot_publish_without_published_homework", async () =>
    assert.equal(
      (await api("admin/lesson-publish", { lessonId }, adminCookie)).status,
      409,
    ));
  const hwBody = {
    courseId,
    lessonId,
    kind: "homework",
    title: "واجب تجربة",
    questions: [
      {
        prompt: "سؤال تجريبي",
        options: ["صحيح", "خطأ"],
        correct: 0,
        points: 1,
        explanation: "شرح للتجربة",
      },
    ],
  };
  const hw = (await ok("admin/assessment-save", hwBody, adminCookie)).data;
  await test("draft_homework_does_not_make_lesson_ready", async () =>
    assert.equal(
      (await api("admin/lesson-publish", { lessonId }, adminCookie)).status,
      409,
    ));
  await ok(
    "admin/assessment-publish",
    { versionId: hw.versionId },
    adminCookie,
  );
  await ok("admin/lesson-publish", { lessonId }, adminCookie);
  const future = (
    await ok(
      "admin/lesson-save",
      {
        courseId,
        unitId,
        title: "درس مستقبلي مخفي " + suffix,
        minutes: 20,
        description: "",
      },
      adminCookie,
    )
  ).data.id;
  await ok("admin/course-publish", { id: courseId }, adminCookie);
  await test("public_catalog_reads_database_and_hides_future_drafts", async () => {
    const html = await (
      await fetch(origin + "/courses/" + courseBody.slug)
    ).text();
    assert.ok(html.includes(courseBody.title));
    assert.ok(!html.includes("درس مستقبلي مخفي " + suffix));
  });
  await test("published_course_identity_and_lesson_deletion_are_frozen", async () => {
    assert.equal(
      (
        await api(
          "admin/course-save",
          { ...courseBody, id: courseId, slug: courseBody.slug + "-changed" },
          adminCookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (await api("admin/lesson-delete", { id: lessonId }, adminCookie)).status,
      409,
    );
    assert.equal(
      (await api("admin/video-submit", { lessonId }, adminCookie)).status,
      409,
    );
  });
  await test("disabling_reference_hides_catalog_but_allows_cosmetic_corrections", async () => {
    await ok(
      "admin/reference-save",
      { kind: "subject", id: subjectId, name, enabled: false },
      adminCookie,
    );
    const html = await (
      await fetch(origin + "/courses/" + courseBody.slug)
    ).text();
    assert.ok(!html.includes(courseBody.title));
    await ok(
      "admin/course-save",
      { ...courseBody, id: courseId, title: courseBody.title + " مصحح" },
      adminCookie,
    );
    await ok(
      "admin/reference-save",
      { kind: "subject", id: subjectId, name, enabled: true },
      adminCookie,
    );
  });
  const batch = (
    await ok(
      "admin/codes-generate",
      {
        courseId,
        durationDays: 30,
        quantity: 2,
        requestId: randomUUID(),
        activateBefore: "",
      },
      adminCookie,
    )
  ).data.id;
  const csv = await (
    await fetch(origin + "/api/admin/code-export/" + batch, {
      headers: { Cookie: adminCookie },
    })
  ).text();
  const codes = [
    ...csv.matchAll(/DRS-[A-Z2-9]{8}-[A-Z2-9]{8}-[A-Z2-9]{8}/g),
  ].map((m) => m[0]);
  await ok("codes/activate", { courseId, code: codes[0] }, studentCookie);
  await test("archive_stops_catalog_and_new_activation_but_keeps_existing_access", async () => {
    await ok("admin/course-archive", { id: courseId }, adminCookie);
    assert.ok(
      !(
        await (await fetch(origin + "/courses/" + courseBody.slug)).text()
      ).includes(courseBody.title),
    );
    assert.equal(
      (await api("codes/preview", { code: codes[1] }, studentCookie)).status,
      400,
    );
    await ok("codes/activate", { courseId, code: codes[0] }, studentCookie);
    await ok(
      "learning/video-open",
      { lessonId, transfer: true },
      studentCookie,
    );
  });
  await test("archived_content_cannot_be_appended_and_audit_is_admin_only", async () => {
    assert.equal(
      (
        await api(
          "admin/lesson-save",
          {
            courseId,
            unitId,
            title: "إضافة مرفوضة",
            minutes: 20,
            description: "",
          },
          adminCookie,
        )
      ).status,
      409,
    );
    const html = await (
      await fetch(origin + "/admin/audit", {
        headers: { Cookie: studentCookie },
      })
    ).text();
    assert.ok(!html.includes("آخر ١٠٠ إجراء"));
    const page = await fetch(origin + "/admin/audit", {
      headers: { Cookie: adminCookie },
    });
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes("سجل الإجراءات"));
  });
  writeFileSync(
    ".local/f11-admin-result.json",
    JSON.stringify(
      { at: new Date().toISOString(), checks, courseId, lessonId, future },
      null,
      2,
    ),
  );
  await ok(
    "admin/teacher-save",
    {
      id: teacherId,
      name: "مدرس مراجعة محلي " + suffix,
      slug: "teacher-" + suffix,
      subjectId,
      description: "بيانات تحقق تجريبية",
      portrait: "/images/teacher-ahmed.svg",
      approach: "خطوة تجريبية",
      enabled: false,
    },
    adminCookie,
  );
  await ok(
    "admin/reference-save",
    { kind: "subject", id: subjectId, name, enabled: false },
    adminCookie,
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      artifact: ".local/f11-admin-result.json",
    }),
  );
} finally {
  for (const cookie of [adminCookie, studentCookie])
    if (cookie) await api("auth/logout", {}, cookie).catch(() => {});
  await db.end();
}
