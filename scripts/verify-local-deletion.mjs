import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

process.loadEnvFile(".env.local");
const origin = "http://127.0.0.1:3000";
if (process.env.DOROSNA_LOCAL_ONLY !== "1" || process.env.APP_ORIGIN !== origin)
  throw new Error("Local verification only.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const checks = [];
const ownedFixtures = [];
let ownedStudentId;
let adminCookie = "",
  studentCookie = "";
async function api(action, body, cookie = adminCookie) {
  const response = await fetch(`${origin}/api/${action}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
  };
}
async function ok(action, body, cookie = adminCookie) {
  const result = await api(action, body, cookie);
  assert.ok(
    [200, 201].includes(result.status),
    `${action}: ${result.status} ${result.data.error ?? ""}`,
  );
  const kind = {
    "admin/course-save": "course",
    "admin/teacher-save": "teacher",
    "admin/subject-create": "reference",
  }[action];
  if (kind && result.data.id)
    ownedFixtures.push({
      kind,
      id: result.data.id,
      ...(kind === "reference" ? { referenceKind: "subject" } : {}),
    });
  return result.data;
}
async function test(name, run) {
  await run();
  checks.push({ name, passed: true });
  console.log("PASS", name);
}
const questions = [
  {
    prompt: "سؤال تحقق للحذف",
    options: ["صحيح", "خطأ"],
    correct: 0,
    points: 1,
    explanation: "تفسير تجريبي",
  },
];
async function homework(courseId, lessonId) {
  return ok("admin/assessment-save", {
    courseId,
    lessonId,
    kind: "homework",
    title: "واجب حذف تجريبي",
    questions,
  });
}
async function row(table, id) {
  return (
    await db.query(`select * from app_private.${table} where id=$1`, [id])
  ).rows[0];
}
async function remove(kind, id, extra = {}) {
  return ok(`admin/${kind}-delete`, { id, confirm: true, ...extra });
}
async function restore(kind, id, extra = {}) {
  return ok(`admin/${kind}-restore`, { id, confirm: true, ...extra });
}
try {
  await db.connect();
  const admin = JSON.parse(readFileSync(".local/admin-account.json", "utf8"));
  const login = await api(
    "auth/login",
    { phone: admin.phone, password: admin.password },
    "",
  );
  assert.equal(login.status, 200);
  adminCookie = login.cookie;
  const suffix = randomUUID().slice(0, 8);
  const subjectId = (
    await ok("admin/subject-create", {
      name: "مادة اختبار الحذف " + suffix,
      slug: "delete-subject-" + suffix,
    })
  ).id;
  const gradeId = randomUUID();
  ownedFixtures.push({
    kind: "reference",
    id: gradeId,
    referenceKind: "grade",
  });
  await db.query(
    "insert into app_private.grades(id,name,slug,sort_order) select $1,$2,$3,coalesce(max(sort_order),0)+1 from app_private.grades",
    [gradeId, "صف اختبار الحذف " + suffix, "delete-grade-" + suffix],
  );
  const teacherBody = {
    name: "مدرس اختبار الحذف " + suffix,
    slug: "delete-teacher-" + suffix,
    subjectId,
    portrait: "/images/teacher-ahmed.svg",
    description: "بيانات تحقق",
    approach: "خطوة تحقق",
    enabled: true,
  };
  const teacherId = (await ok("admin/teacher-save", teacherBody)).id;
  const courseBody = {
    teacherId,
    gradeId,
    subjectId,
    title: "كورس اختبار الحذف " + suffix,
    slug: "delete-course-" + suffix,
    description: "بيانات تحقق",
    subtitle: "تجريبي",
    cover: "/images/course-physics.svg",
    outcomes: "اختبار",
  };
  const draftId = (await ok("admin/course-save", courseBody)).id;
  const student = {
    name: "طالب اختبار الحذف " + suffix,
    grade: "g3",
    phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    password: `Delete!${randomBytes(14).toString("hex")}Aa1`,
    requestId: randomUUID(),
  };
  await ok("auth/register", student, "");
  const studentLogin = await api(
    "auth/login",
    { phone: student.phone, password: student.password },
    "",
  );
  assert.equal(studentLogin.status, 200);
  studentCookie = studentLogin.cookie;
  const studentId = (
    await db.query("select id from app_private.accounts where phone=$1", [
      "+20" + student.phone.slice(1),
    ])
  ).rows[0].id;
  ownedStudentId = studentId;
  await ok("admin/student-update", { studentId, name: student.name, gradeId });

  await test("deletion_requires_admin_and_explicit_confirmation", async () => {
    assert.equal(
      (await api("admin/course-delete", { id: draftId, confirm: true }, ""))
        .status,
      401,
    );
    assert.equal(
      (
        await api(
          "admin/course-delete",
          { id: draftId, confirm: true },
          studentCookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await api("admin/course-delete", { id: draftId })).status,
      400,
    );
    assert.equal(
      (
        await api("admin/course-delete", {
          id: draftId,
          confirm: true,
          table: "accounts",
        })
      ).status,
      400,
    );
    assert.ok(await row("courses", draftId));
  });

  await test("unused_teacher_is_permanently_deleted_with_audit", async () => {
    const id = (
      await ok("admin/teacher-save", {
        ...teacherBody,
        slug: "delete-unused-" + suffix,
      })
    ).id;
    assert.equal((await remove("teacher", id)).mode, "permanent");
    assert.equal(await row("teachers", id), undefined);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.audit_events where target_id=$1 and action='teacher-delete'",
          [id],
        )
      ).rows[0].n,
      1,
    );
  });

  const draftUnit = (
    await ok("admin/unit-save", { courseId: draftId, title: "وحدة مسودة" })
  ).id;
  const draftLesson = (
    await ok("admin/lesson-save", {
      courseId: draftId,
      unitId: draftUnit,
      title: "درس مسودة",
      minutes: 20,
    })
  ).id;
  const draftHw = await homework(draftId, draftLesson);
  await ok("admin/video-fixture", { lessonId: draftLesson });
  await test("draft_course_deletes_nested_video_questions_and_content", async () => {
    assert.equal((await remove("course", draftId)).mode, "permanent");
    for (const [table, id] of [
      ["courses", draftId],
      ["course_units", draftUnit],
      ["lessons", draftLesson],
      ["assessments", draftHw.id],
      ["assessment_versions", draftHw.versionId],
    ])
      assert.equal(await row(table, id), undefined);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.questions where version_id=$1",
          [draftHw.versionId],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.video_uploads where lesson_id=$1",
          [draftLesson],
        )
      ).rows[0].n,
      0,
    );
  });

  const courseId = (
    await ok("admin/course-save", {
      ...courseBody,
      slug: courseBody.slug + "-published",
    })
  ).id;
  const unitId = (
    await ok("admin/unit-save", { courseId, title: "وحدة منشورة" })
  ).id;
  const lessonId = (
    await ok("admin/lesson-save", {
      courseId,
      unitId,
      title: "درس منشور",
      minutes: 20,
    })
  ).id;
  const hw = await homework(courseId, lessonId);
  await ok("admin/video-fixture", { lessonId });
  await ok("admin/assessment-publish", { versionId: hw.versionId });
  await ok("admin/lesson-publish", { lessonId });
  await ok("admin/course-publish", { id: courseId });
  const batchId = (
    await ok("admin/codes-generate", {
      courseId,
      quantity: 3,
      durationDays: 30,
      requestId: randomUUID(),
    })
  ).id;
  const exported = await fetch(`${origin}/api/admin/code-export/${batchId}`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(exported.status, 200);
  const codeValues = (await exported.text())
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(",")[0].replaceAll('"', ""));
  assert.equal(codeValues.length, 3);
  await ok("codes/activate", { code: codeValues[0], courseId }, studentCookie);
  const codes = (
    await db.query(
      "select c.id,a.id is not null as used from app_private.activation_codes c left join app_private.activations a on a.code_id=c.id where c.batch_id=$1 order by c.id",
      [batchId],
    )
  ).rows;
  const usedCodeId = codes.find((code) => code.used).id;
  const unusedCodeId = codes.find((code) => !code.used).id;
  const accessBefore = await row("courses", courseId);
  const entitlementBefore = (
    await db.query(
      "select * from app_private.course_access where student_id=$1 and course_id=$2",
      [studentId, courseId],
    )
  ).rows[0];

  await test("draft_lesson_removes_its_video_and_homework", async () => {
    const id = (
      await ok("admin/lesson-save", {
        courseId,
        unitId,
        title: "مسودة مؤقتة",
        minutes: 20,
      })
    ).id;
    const assessment = await homework(courseId, id);
    await ok("admin/video-fixture", { lessonId: id });
    assert.equal((await remove("lesson", id)).mode, "permanent");
    assert.equal(await row("lessons", id), undefined);
    assert.equal(await row("assessments", assessment.id), undefined);
  });
  await test("draft_unit_deletes_all_unused_children", async () => {
    const id = (
      await ok("admin/unit-save", { courseId, title: "وحدة مسودة مؤقتة" })
    ).id;
    const lesson = (
      await ok("admin/lesson-save", {
        courseId,
        unitId: id,
        title: "مسودة مؤقتة",
        minutes: 20,
      })
    ).id;
    assert.equal((await remove("unit", id)).mode, "permanent");
    assert.equal(await row("course_units", id), undefined);
    assert.equal(await row("lessons", lesson), undefined);
  });
  await test("published_assessment_goes_to_trash_and_restores_unchanged", async () => {
    const versionBefore = await row("assessment_versions", hw.versionId);
    assert.equal((await remove("assessment", hw.id)).mode, "trash");
    assert.ok((await row("assessments", hw.id)).deleted_at);
    assert.deepEqual(
      await row("assessment_versions", hw.versionId),
      versionBefore,
    );
    // A retained lesson must keep its homework reachable for existing students;
    // otherwise removing it would block the next lesson's completion gate.
    await ok("learning/complete", { lessonId }, studentCookie);
    const attempt = await ok(
      "attempts/start",
      { assessmentId: hw.id, versionId: hw.versionId },
      studentCookie,
    );
    const key = (
      await db.query(
        "select question_id,correct_option_id from app_private.answer_keys where version_id=$1",
        [hw.versionId],
      )
    ).rows[0];
    await ok(
      `attempts/${attempt.id}/answer`,
      {
        questionId: key.question_id,
        optionId: key.correct_option_id,
        revision: "1",
      },
      studentCookie,
    );
    await ok(`attempts/${attempt.id}/submit`, {}, studentCookie);
    const resultBefore = (
      await db.query(
        "select * from app_private.attempt_results where attempt_id=$1",
        [attempt.id],
      )
    ).rows[0];
    assert.ok(resultBefore.passed);
    await restore("assessment", hw.id);
    assert.equal((await row("assessments", hw.id)).deleted_at, null);
    assert.deepEqual(
      (
        await db.query(
          "select * from app_private.attempt_results where attempt_id=$1",
          [attempt.id],
        )
      ).rows[0],
      resultBefore,
    );
  });
  await test("published_lesson_and_unit_are_recoverable", async () => {
    const before = await row("lessons", lessonId);
    const progressBefore = (
      await db.query(
        "select * from app_private.lesson_progress where student_id=$1 and lesson_id=$2",
        [studentId, lessonId],
      )
    ).rows[0];
    assert.equal((await remove("lesson", lessonId)).mode, "trash");
    assert.equal(
      (await row("lessons", lessonId)).current_video_id,
      before.current_video_id,
    );
    await ok("learning/video-open", { lessonId }, studentCookie);
    const retainedLesson = await fetch(
      `${origin}/learn/${courseId}?lesson=${lessonId}`,
      { headers: { Cookie: studentCookie } },
    );
    assert.ok((await retainedLesson.text()).includes("درس منشور"));
    assert.deepEqual(
      (
        await db.query(
          "select * from app_private.lesson_progress where student_id=$1 and lesson_id=$2",
          [studentId, lessonId],
        )
      ).rows[0],
      progressBefore,
    );
    await restore("lesson", lessonId);
    assert.equal((await remove("unit", unitId)).mode, "trash");
    assert.ok(await row("lessons", lessonId));
    await restore("unit", unitId);
  });
  await test("used_code_deletion_preserves_owner_and_entitlement", async () => {
    const activation = (
      await db.query("select * from app_private.activations where code_id=$1", [
        usedCodeId,
      ])
    ).rows[0];
    await remove("code", usedCodeId);
    assert.equal(
      (await row("activation_codes", usedCodeId)).cancelled_at,
      null,
    );
    assert.deepEqual(
      (
        await db.query(
          "select * from app_private.activations where code_id=$1",
          [usedCodeId],
        )
      ).rows[0],
      activation,
    );
    assert.deepEqual(
      (
        await db.query(
          "select * from app_private.course_access where student_id=$1 and course_id=$2",
          [studentId, courseId],
        )
      ).rows[0],
      entitlementBefore,
    );
    await restore("code", usedCodeId);
  });
  await test("unused_code_deletion_cancels_permanently_even_after_restore", async () => {
    await remove("code", unusedCodeId);
    const cancelled = (await row("activation_codes", unusedCodeId))
      .cancelled_at;
    assert.ok(cancelled);
    await restore("code", unusedCodeId);
    assert.deepEqual(
      (await row("activation_codes", unusedCodeId)).cancelled_at,
      cancelled,
    );
  });
  await test("deleted_batch_cancels_unused_codes_but_freezes_batch_contents", async () => {
    await remove("code-batch", batchId);
    assert.ok((await row("code_batches", batchId)).deleted_at);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.activation_codes c where batch_id=$1 and cancelled_at is null and not exists(select 1 from app_private.activations a where a.code_id=c.id)",
          [batchId],
        )
      ).rows[0].n,
      0,
    );
    const deniedExport = await fetch(
      `${origin}/api/admin/code-export/${batchId}`,
      { headers: { Cookie: adminCookie } },
    );
    assert.equal(deniedExport.status, 404);
    await assert.rejects(
      db.query(
        "update app_private.code_batches set quantity=quantity+1 where id=$1",
        [batchId],
      ),
      /immutable_history/,
    );
    await restore("code-batch", batchId);
    assert.equal((await row("code_batches", batchId)).quantity, 3);
  });
  await test("linked_teacher_and_references_preserve_courses_and_profiles", async () => {
    for (const [kind, id, extra, table] of [
      ["teacher", teacherId, {}, "teachers"],
      ["reference", subjectId, { kind: "subject" }, "subjects"],
      ["reference", gradeId, { kind: "grade" }, "grades"],
    ]) {
      assert.equal((await remove(kind, id, extra)).mode, "trash");
      assert.equal((await row(table, id)).enabled, false);
      assert.ok(await row("courses", courseId));
      await restore(kind, id, extra);
      assert.equal((await row(table, id)).deleted_at, null);
    }
    assert.equal(
      (
        await db.query(
          "select grade_id from app_private.student_profiles where account_id=$1",
          [studentId],
        )
      ).rows[0].grade_id,
      gradeId,
    );
  });
  await test("published_course_archives_without_touching_access_and_restores", async () => {
    assert.equal((await remove("course", courseId)).mode, "trash");
    const after = await row("courses", courseId);
    assert.equal(after.status, "archived");
    assert.ok(after.deleted_at);
    assert.equal(after.title, accessBefore.title);
    assert.deepEqual(
      (
        await db.query(
          "select * from app_private.course_access where student_id=$1 and course_id=$2",
          [studentId, courseId],
        )
      ).rows[0],
      entitlementBefore,
    );
    await restore("course", courseId);
    assert.equal((await row("courses", courseId)).status, "archived");
    assert.equal((await row("courses", courseId)).deleted_at, null);
  });
  await test("unused_reference_is_permanently_deleted", async () => {
    const id = (
      await ok("admin/subject-create", {
        name: "مادة غير مستخدمة " + suffix,
        slug: "delete-unused-subject-" + suffix,
      })
    ).id;
    assert.equal(
      (await remove("reference", id, { kind: "subject" })).mode,
      "permanent",
    );
    assert.equal(await row("subjects", id), undefined);
  });
  // Keep only this suite's historical fixtures in the trash; no seeded data changes.
  await remove("course", courseId);
  await remove("teacher", teacherId);
  await remove("reference", subjectId, { kind: "subject" });
  await remove("reference", gradeId, { kind: "grade" });
  writeFileSync(
    ".local/deletion-student.json",
    JSON.stringify(student, null, 2) + "\n",
    { mode: 0o600 },
  );
  writeFileSync(
    ".local/deletion-verification.json",
    JSON.stringify(
      { at: new Date().toISOString(), passed: checks.length, checks },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: checks.length }));
} finally {
  for (const kind of ["course", "teacher", "reference"]) {
    for (const fixture of ownedFixtures.filter((item) => item.kind === kind)) {
      await api(`admin/${kind}-delete`, {
        id: fixture.id,
        confirm: true,
        ...(fixture.referenceKind ? { kind: fixture.referenceKind } : {}),
      }).catch(() => {});
    }
  }
  if (ownedStudentId)
    await api("admin/student-disable", {
      studentId: ownedStudentId,
      reason: "انتهاء اختبار الحذف المحلي",
    }).catch(() => {});
  await db.end();
}
