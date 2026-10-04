import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { projectPath } from "../shared/paths.mjs";
process.loadEnvFile(projectPath(".env.local"));
const origin = "http://127.0.0.1:3000";
if (process.env.DOROSNA_LOCAL_ONLY !== "1" || process.env.APP_ORIGIN !== origin)
  throw new Error("Local verification only.");
pg.types.setTypeParser(1184, (value) => value);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const checks = [];
async function test(name, run) {
  await run();
  checks.push({ name, passed: true });
  console.log("PASS", name);
}
async function api(path, body, cookie = "") {
  const res = await fetch(origin + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  return {
    status: res.status,
    data,
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
  };
}
async function ok(path, body, cookie) {
  const res = await api(path, body, cookie);
  assert.ok(
    [200, 201].includes(res.status),
    `${path}: ${res.data.error ?? res.data.message ?? res.status}`,
  );
  return res;
}
let adminCookie = "",
  studentCookie = "",
  otherCookie = "",
  secondSession = "";
try {
  await db.connect();
  const admin = JSON.parse(
    readFileSync(projectPath(".local/admin-account.json"), "utf8"),
  );
  adminCookie = (
    await ok("auth/login", { phone: admin.phone, password: admin.password })
  ).cookie;
  const student = {
    phone: "010" + String(randomInt(10000000, 99999999)),
    password: `Learn!${randomUUID()}aA9`,
    name: "طالب مراجعة الدروس",
    grade: "g3",
    requestId: randomUUID(),
  };
  await ok("auth/register", student);
  writeFileSync(
    projectPath(".local/learning-student.json"),
    JSON.stringify(student, null, 2),
    { mode: 0o600 },
  );
  studentCookie = (
    await ok("auth/login", { phone: student.phone, password: student.password })
  ).cookie;
  secondSession = (
    await ok("auth/login", { phone: student.phone, password: student.password })
  ).cookie;
  const other = JSON.parse(
    readFileSync(projectPath(".local/student-account.json"), "utf8"),
  );
  otherCookie = (
    await ok("auth/login", { phone: other.phone, password: other.password })
  ).cookie;
  const studentId = (
    await db.query("select id from app_private.accounts where phone=$1", [
      "+20" + student.phone.slice(1),
    ])
  ).rows[0].id;
  const baseCourse = (
    await db.query(
      "select * from app_private.courses where slug='physics-electricity'",
    )
  ).rows[0];
  const fixtureSuffix = randomUUID().slice(0, 8);
  const course = {
    id: (
      await ok(
        "admin/course-save",
        {
          title: "كورس مراجعة رحلة الطالب المحلي " + fixtureSuffix,
          slug: "learn-test-" + fixtureSuffix,
          teacherId: baseCourse.teacher_id,
          gradeId: baseCourse.grade_id,
          subjectId: baseCourse.subject_id,
          cover: "/images/course-physics.svg",
          subtitle: "تجربة مستقلة",
          description: "بيانات مراجعة تجريبية",
          outcomes: "اختبار رحلة الطالب",
        },
        adminCookie,
      )
    ).data.id,
  };
  const unit = (
    await ok(
      "admin/unit-save",
      { courseId: course.id, title: "وحدة مراجعة محلية" },
      adminCookie,
    )
  ).data.id;
  for (const title of ["الدرس الأول للاختبار", "الدرس الثاني للاختبار"]) {
    const lessonId = (
      await ok(
        "admin/lesson-save",
        {
          courseId: course.id,
          unitId: unit,
          title,
          minutes: 20,
          description: "",
        },
        adminCookie,
      )
    ).data.id;
    await ok("admin/video-fixture", { lessonId }, adminCookie);
    const homework = (
      await ok(
        "admin/assessment-save",
        {
          courseId: course.id,
          lessonId,
          kind: "homework",
          title: "واجب مراجعة محلي",
          questions: [
            {
              prompt: "٢ + ٣ يساوي؟",
              options: ["٥", "٦", "٧"],
              correct: 0,
              points: 7,
              explanation: "شرح تجريبي",
            },
            {
              prompt: "٤ × ٢ يساوي؟",
              options: ["٦", "٨", "١٠"],
              correct: 1,
              points: 3,
              explanation: "شرح تجريبي",
            },
          ],
        },
        adminCookie,
      )
    ).data;
    await ok(
      "admin/assessment-publish",
      { versionId: homework.versionId },
      adminCookie,
    );
    await ok("admin/lesson-publish", { lessonId }, adminCookie);
  }
  await ok("admin/course-publish", { id: course.id }, adminCookie);
  const lessons = (
    await db.query(
      "select id from app_private.lessons where course_id=$1 and published_at is not null order by position",
      [course.id],
    )
  ).rows;
  const hw = (
    await db.query(
      "select id,current_version_id from app_private.assessments where lesson_id=$1 and kind='homework'",
      [lessons[0].id],
    )
  ).rows[0];
  const generated = await ok(
    "admin/codes-generate",
    {
      courseId: course.id,
      durationDays: 30,
      quantity: 1,
      requestId: randomUUID(),
      activateBefore: "",
    },
    adminCookie,
  );
  const exported = await fetch(
    `${origin}/api/admin/code-export/${generated.data.id}`,
    { headers: { Cookie: adminCookie } },
  );
  const code = (await exported.text()).match(
    /DRS-[A-Z2-9]{8}-[A-Z2-9]{8}-[A-Z2-9]{8}/,
  )[0];
  await ok("codes/activate", { code, courseId: course.id }, studentCookie);
  await test("next_lesson_locked_initially", async () =>
    assert.equal(
      (
        await api(
          "learning/video-open",
          { lessonId: lessons[1].id },
          studentCookie,
        )
      ).status,
      403,
    ));
  let lease;
  await test("private_video_requires_session_and_watch_lease", async () => {
    assert.equal(
      (await fetch(`${origin}/api/video/${lessons[0].id}?generation=1`)).status,
      401,
    );
    lease = await ok(
      "learning/video-open",
      { lessonId: lessons[0].id, transfer: true },
      studentCookie,
    );
    assert.ok(lease.cookie.startsWith("dorosna_watch="));
    const res = await fetch(
      `${origin}/api/video/${lessons[0].id}?generation=${lease.data.generation}`,
      {
        headers: {
          Cookie: studentCookie + "; " + lease.cookie,
          Range: "bytes=0-1023",
        },
      },
    );
    assert.equal(res.status, 206);
    assert.equal((await res.arrayBuffer()).byteLength, 1024);
    assert.ok(res.headers.get("cache-control").includes("no-store"));
  });
  await test("progress_higher_revision_wins", async () => {
    const body = {
      lessonId: lessons[0].id,
      generation: lease.data.generation,
      seconds: 12,
      revision: "9",
    };
    await ok("learning/position", body, studentCookie + "; " + lease.cookie);
    const stale = await ok(
      "learning/position",
      { ...body, seconds: 2, revision: "8" },
      studentCookie + "; " + lease.cookie,
    );
    assert.equal(stale.data.saved, false);
    assert.equal(
      Number(
        (
          await db.query(
            "select position_seconds from app_private.lesson_progress where student_id=$1 and lesson_id=$2",
            [studentId, lessons[0].id],
          )
        ).rows[0].position_seconds,
      ),
      12,
    );
  });
  await test("watch_transfer_invalidates_previous_device", async () => {
    assert.equal(
      (
        await api(
          "learning/video-open",
          { lessonId: lessons[0].id },
          secondSession,
        )
      ).status,
      409,
    );
    const newer = await ok(
      "learning/video-open",
      { lessonId: lessons[0].id, transfer: true },
      secondSession,
    );
    assert.equal(newer.data.positionSeconds, 12);
    assert.equal(newer.data.revision, "9");
    assert.equal(
      (
        await api(
          "learning/heartbeat",
          { lessonId: lessons[0].id, generation: lease.data.generation },
          studentCookie + "; " + lease.cookie,
        )
      ).status,
      409,
    );
    await ok(
      "learning/heartbeat",
      { lessonId: lessons[0].id, generation: newer.data.generation },
      secondSession + "; " + newer.cookie,
    );
  });
  await test("complete_requires_homework_pass_before_next", async () => {
    await ok("learning/complete", { lessonId: lessons[0].id }, studentCookie);
    assert.equal(
      (
        await api(
          "learning/video-open",
          { lessonId: lessons[1].id },
          studentCookie,
        )
      ).status,
      403,
    );
  });
  const started = await ok(
    "attempts/start",
    { assessmentId: hw.id, versionId: hw.current_version_id },
    studentCookie,
  );
  const attemptId = started.data.id;
  const questions = (
    await ok(`attempts/${attemptId}`, undefined, studentCookie)
  ).data.questions;
  const keys = (
    await db.query(
      "select question_id,correct_option_id from app_private.answer_keys where version_id=$1",
      [hw.current_version_id],
    )
  ).rows;
  await test("active_attempt_and_ssr_never_send_answer_keys", async () => {
    const wire = JSON.stringify(questions);
    assert.ok(
      !wire.includes("correct_option") && !wire.includes("explanation"),
    );
    const html = await (
      await fetch(`${origin}/attempts/${attemptId}`, {
        headers: { Cookie: studentCookie },
      })
    ).text();
    assert.ok(
      !html.includes("correct_option_id") && !html.includes("explanation"),
    );
  });
  await test("attempt_ownership_and_question_option_membership", async () => {
    assert.equal(
      (await api(`attempts/${attemptId}`, undefined, otherCookie)).status,
      404,
    );
    assert.equal(
      (
        await api(
          `attempts/${attemptId}/answer`,
          { questionId: randomUUID(), optionId: null, revision: "1" },
          studentCookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          `attempts/${attemptId}/answer`,
          {
            questionId: questions[0].id,
            optionId: questions[1].options[0].id,
            revision: "1",
          },
          studentCookie,
        )
      ).status,
      400,
    );
  });
  await test("incomplete_homework_cannot_be_submitted", async () =>
    assert.equal(
      (await api(`attempts/${attemptId}/submit`, {}, studentCookie)).status,
      409,
    ));
  await test("out_of_order_answers_keep_newest_acknowledged_choice", async () => {
    const q = questions[0],
      right = keys.find((k) => k.question_id === q.id).correct_option_id;
    await ok(
      `attempts/${attemptId}/answer`,
      { questionId: q.id, optionId: right, revision: "2" },
      studentCookie,
    );
    const stale = await ok(
      `attempts/${attemptId}/answer`,
      {
        questionId: q.id,
        optionId: q.options.find((o) => o.id !== right).id,
        revision: "1",
      },
      studentCookie,
    );
    assert.equal(stale.data.saved, false);
    assert.equal(stale.data.optionId, right);
  });
  await test("weighted_seventy_percent_passes_and_submission_is_idempotent", async () => {
    const q = questions[1],
      right = keys.find((k) => k.question_id === q.id).correct_option_id;
    await ok(
      `attempts/${attemptId}/answer`,
      {
        questionId: q.id,
        optionId: q.options.find((o) => o.id !== right).id,
        revision: "1",
      },
      studentCookie,
    );
    await ok(`attempts/${attemptId}/submit`, {}, studentCookie);
    await ok(`attempts/${attemptId}/submit`, {}, studentCookie);
    const result = (await ok(`results/${attemptId}`, undefined, studentCookie))
      .data;
    assert.equal(result.earnedPoints, 7);
    assert.equal(result.possiblePoints, 10);
    assert.equal(result.passed, true);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.attempt_results where attempt_id=$1",
          [attemptId],
        )
      ).rows[0].n,
      1,
    );
    await ok(
      "learning/video-open",
      { lessonId: lessons[1].id, transfer: true },
      studentCookie,
    );
  });
  await test("later_failed_homework_keeps_first_pass_and_unlimited_retries", async () => {
    const retry = (
      await ok(
        "attempts/start",
        { assessmentId: hw.id, versionId: hw.current_version_id },
        studentCookie,
      )
    ).data.id;
    for (const q of questions) {
      const right = keys.find((k) => k.question_id === q.id).correct_option_id;
      await ok(
        `attempts/${retry}/answer`,
        {
          questionId: q.id,
          optionId: q.options.find((o) => o.id !== right).id,
          revision: "1",
        },
        studentCookie,
      );
    }
    await ok(`attempts/${retry}/submit`, {}, studentCookie);
    assert.equal(
      (await ok(`results/${retry}`, undefined, studentCookie)).data.passed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "select first_pass_attempt_id from app_private.homework_passes where student_id=$1 and assessment_id=$2",
          [studentId, hw.id],
        )
      ).rows[0].first_pass_attempt_id,
      attemptId,
    );
    await ok(
      "learning/video-open",
      { lessonId: lessons[1].id, transfer: true },
      studentCookie,
    );
  });
  const examBody = {
    courseId: course.id,
    kind: "exam",
    title: "امتحان مراجعة محلي",
    durationMinutes: 1,
    maxAttempts: 1,
    passPercent: 70,
    opensAt: "",
    closesAt: "",
    questions: [
      {
        prompt: "سؤال اختبار أول",
        options: ["أ", "ب"],
        correct: 0,
        points: 7,
        explanation: "شرح تجريبي",
      },
      {
        prompt: "سؤال اختبار ثان",
        options: ["أ", "ب"],
        correct: 1,
        points: 3,
        explanation: "شرح تجريبي ثان",
      },
    ],
  };
  const exam = (await ok("admin/assessment-save", examBody, adminCookie)).data;
  await ok(
    "admin/assessment-publish",
    { versionId: exam.versionId },
    adminCookie,
  );
  await test("published_version_is_immutable", async () =>
    assert.equal(
      (
        await api(
          "admin/assessment-save",
          { ...examBody, id: exam.id, versionId: exam.versionId },
          adminCookie,
        )
      ).status,
      409,
    ));
  const examAttempt = (
    await ok(
      "attempts/start",
      { assessmentId: exam.id, versionId: exam.versionId },
      studentCookie,
    )
  ).data.id;
  await test("same_active_exam_start_replays_without_extra_attempt", async () =>
    assert.equal(
      (
        await ok(
          "attempts/start",
          { assessmentId: exam.id, versionId: exam.versionId },
          studentCookie,
        )
      ).data.id,
      examAttempt,
    ));
  await ok(`attempts/${examAttempt}/submit`, {}, studentCookie);
  await test("exam_model_after_exhaustion_without_closing_date", async () => {
    const r = (await ok(`results/${examAttempt}`, undefined, studentCookie))
      .data;
    assert.equal(r.modelAvailable, true);
    assert.equal(r.model.length, 2);
    assert.equal(
      (
        await api(
          "attempts/start",
          { assessmentId: exam.id, versionId: exam.versionId },
          studentCookie,
        )
      ).status,
      409,
    );
  });
  const nextVersion = (
    await ok(
      "admin/assessment-save",
      { ...examBody, id: exam.id, maxAttempts: 2 },
      adminCookie,
    )
  ).data;
  await ok(
    "admin/assessment-publish",
    { versionId: nextVersion.versionId },
    adminCookie,
  );
  await test("logical_attempt_counter_and_old_model_survive_new_versions", async () => {
    assert.equal(
      (await ok(`results/${examAttempt}`, undefined, studentCookie)).data
        .modelAvailable,
      true,
    );
    const next = (
      await ok(
        "attempts/start",
        { assessmentId: exam.id, versionId: nextVersion.versionId },
        studentCookie,
      )
    ).data.id;
    assert.equal(
      (
        await db.query(
          "select attempt_number,version_id from app_private.attempts where id=$1",
          [next],
        )
      ).rows[0].attempt_number,
      2,
    );
    await ok(`attempts/${next}/submit`, {}, studentCookie);
    assert.equal(
      (
        await api(
          "attempts/start",
          { assessmentId: exam.id, versionId: nextVersion.versionId },
          studentCookie,
        )
      ).status,
      409,
    );
  });
  const closesAt = new Date(Date.now() + 30_000).toISOString();
  const timed = (
    await ok(
      "admin/assessment-save",
      { ...examBody, title: "امتحان إقفال تلقائي محلي", closesAt },
      adminCookie,
    )
  ).data;
  await ok(
    "admin/assessment-publish",
    { versionId: timed.versionId },
    adminCookie,
  );
  const deadlineAttempt = (
    await ok(
      "attempts/start",
      { assessmentId: timed.id, versionId: timed.versionId },
      studentCookie,
    )
  ).data.id;
  const timedQuestions = (
    await ok(`attempts/${deadlineAttempt}`, undefined, studentCookie)
  ).data.questions;
  await ok(
    `attempts/${deadlineAttempt}/answer`,
    {
      questionId: timedQuestions[0].id,
      optionId: timedQuestions[0].options[0].id,
      revision: "1",
    },
    studentCookie,
  );
  const manual = (
    await ok(
      "admin/assessment-save",
      { ...examBody, title: "امتحان نموذج مؤجل محلي", closesAt },
      adminCookie,
    )
  ).data;
  await ok(
    "admin/assessment-publish",
    { versionId: manual.versionId },
    adminCookie,
  );
  const manualId = (
    await ok(
      "attempts/start",
      { assessmentId: manual.id, versionId: manual.versionId },
      studentCookie,
    )
  ).data.id;
  await ok(`attempts/${manualId}/submit`, {}, studentCookie);
  await test("answer_model_hidden_before_global_close_even_after_exhaustion", async () => {
    const result = (await ok(`results/${manualId}`, undefined, studentCookie))
      .data;
    assert.equal(result.modelAvailable, false);
    assert.deepEqual(result.model, []);
  });
  await test("withdrawal_denies_active_exam_and_video_but_preserves_results", async () => {
    await ok(
      "admin/access-withdraw",
      { studentId, courseId: course.id, reason: "اختبار سحب الوصول" },
      adminCookie,
    );
    assert.equal(
      (await api(`attempts/${deadlineAttempt}`, undefined, studentCookie))
        .status,
      403,
    );
    assert.equal(
      (
        await api(
          "learning/video-open",
          { lessonId: lessons[0].id },
          studentCookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await api(`results/${attemptId}`, undefined, studentCookie)).status,
      200,
    );
  });
  await ok(
    "admin/student-disable",
    { studentId, reason: "اختبار الإقفال التلقائي بعد تعطيل الحساب" },
    adminCookie,
  );
  await test("disabled_account_invalidates_existing_application_session", async () =>
    assert.equal(
      (await api(`results/${attemptId}`, undefined, studentCookie)).status,
      401,
    ));
  await test("worker_grades_without_browser_or_student_requests_after_deadline", async () => {
    const until = Date.now() + 42_000;
    let state;
    while (Date.now() < until) {
      state = (
        await db.query(
          "select t.status,t.submission_kind,r.earned_points,r.possible_points from app_private.attempts t left join app_private.attempt_results r on r.attempt_id=t.id where t.id=$1",
          [deadlineAttempt],
        )
      ).rows[0];
      if (state.status === "submitted") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(state.status, "submitted");
    assert.equal(state.submission_kind, "deadline");
    assert.equal(Number(state.earned_points), 7);
    assert.equal(Number(state.possible_points), 10);
  });
  await ok("admin/student-enable", { studentId }, adminCookie);
  studentCookie = (
    await ok("auth/login", { phone: student.phone, password: student.password })
  ).cookie;
  await test("results_and_models_remain_readable_after_access_withdrawal", async () => {
    assert.equal(
      (await ok(`results/${deadlineAttempt}`, undefined, studentCookie)).data
        .modelAvailable,
      true,
    );
    assert.equal(
      (await ok(`results/${manualId}`, undefined, studentCookie)).data
        .modelAvailable,
      true,
    );
  });
  writeFileSync(
    projectPath(".local/f09-learning-result.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        studentId,
        courseId: course.id,
        attemptId,
        examAttempt,
        deadlineAttempt,
      },
      null,
      2,
    ),
  );
  await ok("admin/course-archive", { id: course.id }, adminCookie);
  console.log(
    JSON.stringify({
      passed: checks.length,
      artifact: ".local/f09-learning-result.json",
    }),
  );
} finally {
  for (const cookie of [adminCookie, studentCookie, otherCookie, secondSession])
    if (cookie) await api("auth/logout", {}, cookie).catch(() => {});
  await db.end();
}
