import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import pg from "pg";

process.loadEnvFile(".env.local");
const origin = "http://127.0.0.1:3000";
const connection = new URL(process.env.DATABASE_URL);
if (
  process.env.DOROSNA_LOCAL_ONLY !== "1" ||
  process.env.APP_ORIGIN !== origin ||
  connection.hostname !== "127.0.0.1" ||
  connection.port !== "54322" ||
  connection.username !== "dorosna_server"
)
  throw new Error("Standalone verification is local only.");
pg.types.setTypeParser(1184, (value) => value);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const checks = [],
  fixtures = [],
  accounts = [];
const suffix = randomUUID().slice(0, 8);
const marker = `تحقق مستقل ${suffix}`;
let adminCookie = "",
  studentCookie = "",
  otherCookie = "";
let student, other, grade, subject, homework, exam;

async function api(path, body, cookie = "", headers = {}) {
  const response = await fetch(`${origin}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
  };
}
async function ok(path, body, cookie) {
  const result = await api(path, body, cookie);
  assert.ok(
    result.status === 200 || result.status === 201,
    `${path}: ${result.data.error ?? result.status}`,
  );
  return result;
}
async function test(name, run) {
  await run();
  checks.push({ name, passed: true });
  console.log("PASS", name);
}
const questions = (title = "السؤال الأول") => [
  {
    prompt: `${title} ${suffix}: ٢ + ٣؟`,
    options: ["٥", "٦"],
    correct: 0,
    points: 7,
    explanation: `شرح خاص ${suffix} للسؤال الأول`,
  },
  {
    prompt: `السؤال الثاني ${suffix}: ٤ × ٢؟`,
    options: ["٦", "٨"],
    correct: 1,
    points: 3,
    explanation: `شرح خاص ${suffix} للسؤال الثاني`,
  },
];
function body(kind, title, overrides = {}) {
  return {
    scope: "standalone",
    gradeId: grade.id,
    subjectId: subject.id,
    kind,
    title,
    ...(kind === "exam"
      ? {
          durationMinutes: 1,
          maxAttempts: 1,
          passPercent: 70,
          opensAt: "",
          closesAt: "",
        }
      : {}),
    questions: questions(),
    ...overrides,
  };
}
async function create(kind, title, overrides = {}, publish = true) {
  const saved = (
    await ok("admin/assessment-save", body(kind, title, overrides), adminCookie)
  ).data;
  fixtures.push(saved.id);
  if (publish)
    await ok(
      "admin/assessment-publish",
      { versionId: saved.versionId },
      adminCookie,
    );
  return saved;
}
async function start(assessment, cookie = studentCookie) {
  return (
    await ok(
      "attempts/start",
      { assessmentId: assessment.id, versionId: assessment.versionId },
      cookie,
    )
  ).data.id;
}
async function answerAll(attemptId, correct = true, cookie = studentCookie) {
  const data = (await ok(`attempts/${attemptId}`, undefined, cookie)).data;
  for (const [index, question] of data.questions.entries())
    await ok(
      `attempts/${attemptId}/answer`,
      {
        questionId: question.id,
        optionId: question.options[correct ? index % 2 : 0].id,
        revision: String(Number(question.revision) + 1),
      },
      cookie,
    );
}
async function deniedSql(sql, params) {
  await db.query("begin");
  let code;
  try {
    await db.query(sql, params);
  } catch (error) {
    code = error.code;
  } finally {
    await db.query("rollback");
  }
  assert.ok(
    ["23514", "23503"].includes(code),
    "Database must reject scope/history mutation.",
  );
}
async function publicHtml(cookie = "") {
  const response = await fetch(`${origin}/assessments`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  assert.equal(response.status, 200);
  return response.text();
}

try {
  await db.connect();
  mkdirSync(".local", { recursive: true });
  const admin = JSON.parse(readFileSync(".local/admin-account.json", "utf8"));
  adminCookie = (
    await ok("auth/login", { phone: admin.phone, password: admin.password })
  ).cookie;
  const grades = (
    await db.query(
      "select id,slug from app_private.grades where enabled and deleted_at is null order by sort_order limit 2",
    )
  ).rows;
  assert.equal(
    grades.length,
    2,
    "Two available grades are required for cross-grade verification.",
  );
  grade = grades[0];
  subject = (
    await db.query(
      "select id from app_private.subjects where enabled and deleted_at is null order by name limit 1",
    )
  ).rows[0];
  assert.ok(subject, "An available subject is required.");
  for (const [index, selectedGrade] of grades.entries()) {
    const account = {
      phone: "010" + String(randomInt(10000000, 99999999)),
      password: `Standalone!${randomUUID()}aA9`,
      name: `طالب ${marker} ${index + 1}`,
      grade: selectedGrade.slug,
      requestId: randomUUID(),
    };
    await ok("auth/register", account);
    account.id = (
      await db.query("select id from app_private.accounts where phone=$1", [
        "+20" + account.phone.slice(1),
      ])
    ).rows[0].id;
    accounts.push(account);
  }
  [student, other] = accounts;
  studentCookie = (
    await ok("auth/login", { phone: student.phone, password: student.password })
  ).cookie;
  otherCookie = (
    await ok("auth/login", { phone: other.phone, password: other.password })
  ).cookie;
  writeFileSync(
    ".local/standalone-browser-account.json",
    JSON.stringify(student, null, 2),
    { mode: 0o600 },
  );
  homework = await create("homework", `${marker} واجب`, {}, false);

  await test("draft_standalone_is_private_and_cannot_start", async () => {
    assert.ok(!(await publicHtml()).includes(`${marker} واجب`));
    assert.equal(
      (
        await api(
          "attempts/start",
          { assessmentId: homework.id, versionId: homework.versionId },
          studentCookie,
        )
      ).status,
      404,
    );
  });
  await test("scope_mixing_and_student_admin_mutations_are_denied", async () => {
    assert.equal(
      (
        await api(
          "admin/assessment-save",
          body("homework", `${marker} مرفوض`, { courseId: randomUUID() }),
          adminCookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          "admin/assessment-save",
          body("homework", `${marker} مرفوض`),
          studentCookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await api(
          "admin/assessment-publish",
          { versionId: homework.versionId },
          adminCookie,
          { Origin: "https://invalid.example" },
        )
      ).status,
      403,
    );
    const image = await fetch(`${origin}/api/admin/images`, {
      method: "POST",
      headers: { Origin: origin, Cookie: studentCookie },
      body: new FormData(),
    });
    assert.equal(image.status, 403);
  });
  await ok(
    "admin/assessment-publish",
    { versionId: homework.versionId },
    adminCookie,
  );
  exam = await create("exam", `${marker} امتحان`);
  await test("published_catalog_is_public_without_questions_or_keys", async () => {
    const html = await publicHtml();
    assert.ok(html.includes(`${marker} واجب`));
    assert.ok(html.includes(`${marker} امتحان`));
    assert.ok(!html.includes(`شرح خاص ${suffix}`));
    assert.ok(!html.includes(`السؤال الثاني ${suffix}`));
  });
  await test("anonymous_wrong_grade_and_admin_cannot_start_student_attempt", async () => {
    const input = { assessmentId: homework.id, versionId: homework.versionId };
    assert.equal((await api("attempts/start", input)).status, 401);
    assert.equal((await api("attempts/start", input, otherCookie)).status, 403);
    assert.equal((await api("attempts/start", input, adminCookie)).status, 403);
  });
  let homeworkAttempt;
  await test("same_grade_without_any_course_access_can_start_idempotently", async () => {
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.course_access where student_id=$1",
          [student.id],
        )
      ).rows[0].n,
      0,
    );
    const input = { assessmentId: homework.id, versionId: homework.versionId };
    const responses = await Promise.all([
      ok("attempts/start", input, studentCookie),
      ok("attempts/start", input, studentCookie),
    ]);
    homeworkAttempt = responses[0].data.id;
    assert.equal(responses[1].data.id, homeworkAttempt);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.attempts where student_id=$1 and assessment_id=$2",
          [student.id, homework.id],
        )
      ).rows[0].n,
      1,
    );
  });
  const running = (
    await ok(`attempts/${homeworkAttempt}`, undefined, studentCookie)
  ).data;
  await test("active_attempt_has_no_answer_keys_and_is_owner_only", async () => {
    assert.equal(running.courseId, null);
    for (const question of running.questions) {
      assert.ok(!Object.hasOwn(question, "correct_option_id"));
      assert.ok(!Object.hasOwn(question, "explanation"));
    }
    assert.equal(
      (await api(`attempts/${homeworkAttempt}`, undefined, otherCookie)).status,
      404,
    );
    assert.equal(
      (await api(`attempts/${homeworkAttempt}/submit`, {}, otherCookie)).status,
      404,
    );
  });
  await test("answers_validate_question_option_and_revision_and_homework_completeness", async () => {
    const question = running.questions[0],
      otherQuestion = running.questions[1];
    assert.equal(
      (
        await api(
          `attempts/${homeworkAttempt}/answer`,
          {
            questionId: randomUUID(),
            optionId: question.options[0].id,
            revision: "1",
          },
          studentCookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          `attempts/${homeworkAttempt}/answer`,
          {
            questionId: question.id,
            optionId: otherQuestion.options[0].id,
            revision: "1",
          },
          studentCookie,
        )
      ).status,
      400,
    );
    await ok(
      `attempts/${homeworkAttempt}/answer`,
      {
        questionId: question.id,
        optionId: question.options[0].id,
        revision: "2",
      },
      studentCookie,
    );
    const stale = await ok(
      `attempts/${homeworkAttempt}/answer`,
      {
        questionId: question.id,
        optionId: question.options[1].id,
        revision: "1",
      },
      studentCookie,
    );
    assert.equal(stale.data.revision, "2");
    assert.equal(stale.data.optionId, question.options[0].id);
    assert.equal(
      (await api(`attempts/${homeworkAttempt}/submit`, {}, studentCookie))
        .status,
      409,
    );
    await ok(
      `attempts/${homeworkAttempt}/answer`,
      {
        questionId: otherQuestion.id,
        optionId: otherQuestion.options[0].id,
        revision: "1",
      },
      studentCookie,
    );
  });
  await test("weighted_homework_pass_is_idempotent_and_never_unlocks_course_lessons", async () => {
    const first = await ok(
      `attempts/${homeworkAttempt}/submit`,
      {},
      studentCookie,
    );
    assert.equal(
      (await ok(`attempts/${homeworkAttempt}/submit`, {}, studentCookie)).data
        .next,
      first.data.next,
    );
    const result = (
      await ok(`results/${homeworkAttempt}`, undefined, studentCookie)
    ).data;
    assert.equal(result.earnedPoints, 7);
    assert.equal(result.possiblePoints, 10);
    assert.equal(result.passed, true);
    assert.equal(result.courseId, null);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.homework_passes where student_id=$1",
          [student.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.lesson_progress where student_id=$1",
          [student.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await api(`results/${homeworkAttempt}`, undefined, otherCookie)).status,
      404,
    );
  });
  await test("homework_retries_are_unlimited", async () => {
    const next = await start(homework);
    await answerAll(next);
    await ok(`attempts/${next}/submit`, {}, studentCookie);
    assert.equal(
      (await ok(`results/${next}`, undefined, studentCookie)).data
        .attemptNumber,
      2,
    );
  });
  let oldExamAttempt, newVersion;
  await test("published_new_version_does_not_change_in_progress_exam", async () => {
    oldExamAttempt = await start(exam);
    newVersion = (
      await ok(
        "admin/assessment-save",
        body("exam", `${marker} امتحان`, {
          id: exam.id,
          durationMinutes: 2,
          maxAttempts: 2,
          passPercent: 100,
          questions: questions("سؤال إصدار جديد"),
        }),
        adminCookie,
      )
    ).data;
    await ok(
      "admin/assessment-publish",
      { versionId: newVersion.versionId },
      adminCookie,
    );
    const active = (
      await ok(`attempts/${oldExamAttempt}`, undefined, studentCookie)
    ).data;
    assert.ok(active.questions[0].prompt.startsWith("السؤال الأول"));
    assert.equal(await start(newVersion), oldExamAttempt);
    await answerAll(oldExamAttempt, false);
    await ok(`attempts/${oldExamAttempt}/submit`, {}, studentCookie);
    const result = (
      await ok(`results/${oldExamAttempt}`, undefined, studentCookie)
    ).data;
    assert.equal(result.passed, true);
    assert.equal(result.modelAvailable, true);
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
  await test("soft_delete_stops_new_attempts_but_keeps_running_attempt_and_old_results", async () => {
    const active = await start(newVersion);
    await ok(
      "admin/assessment-delete",
      { id: exam.id, confirm: true },
      adminCookie,
    );
    assert.ok(!(await publicHtml()).includes(`${marker} امتحان`));
    assert.equal(
      (
        await api(
          "attempts/start",
          { assessmentId: exam.id, versionId: newVersion.versionId },
          studentCookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (await ok(`attempts/${active}`, undefined, studentCookie)).data.submitted,
      false,
    );
    await answerAll(active);
    await ok(`attempts/${active}/submit`, {}, studentCookie);
    assert.equal(
      (await ok(`results/${oldExamAttempt}`, undefined, studentCookie)).data
        .modelAvailable,
      true,
    );
    await ok(
      "admin/assessment-restore",
      { id: exam.id, confirm: true },
      adminCookie,
    );
    assert.equal(
      (
        await api(
          "attempts/start",
          { assessmentId: exam.id, versionId: newVersion.versionId },
          studentCookie,
        )
      ).status,
      409,
    );
  });
  await test("archive_preserves_current_attempt_while_disallowing_new_attempts", async () => {
    const archived = await create("homework", `${marker} أرشفة`);
    const active = await start(archived);
    await ok("admin/assessment-archive", { id: archived.id }, adminCookie);
    assert.equal(
      (
        await api(
          "attempts/start",
          { assessmentId: archived.id, versionId: archived.versionId },
          studentCookie,
        )
      ).status,
      404,
    );
    await answerAll(active);
    await ok(`attempts/${active}/submit`, {}, studentCookie);
    assert.equal(
      (await ok(`results/${active}`, undefined, studentCookie)).data.passed,
      true,
    );
  });
  await test("database_rejects_nullable_scope_bypass_and_frozen_history_changes", async () => {
    await deniedSql(
      "insert into app_private.assessment_versions(id,assessment_id,course_id,kind,version_number,pass_percent) values($1,$2,null,'homework',1,70)",
      [randomUUID(), randomUUID()],
    );
    await deniedSql(
      "insert into app_private.assessment_versions(id,assessment_id,course_id,kind,version_number,pass_percent) values($1,$2,$3,'homework',99,70)",
      [randomUUID(), homework.id, randomUUID()],
    );
    await deniedSql(
      "insert into app_private.attempts(id,student_id,assessment_id,version_id,course_id,kind,attempt_number,started_at,deadline_at) values($1,$2,$3,$4,null,'exam',99,clock_timestamp(),clock_timestamp()+interval '60 seconds')",
      [randomUUID(), student.id, homework.id, exam.versionId],
    );
    await deniedSql(
      "update app_private.assessments set grade_id=$2 where id=$1",
      [homework.id, grades[1].id],
    );
    await deniedSql(
      "update app_private.assessment_versions set pass_percent=100 where id=$1",
      [exam.versionId],
    );
    await deniedSql(
      "update app_private.attempts set version_id=$2 where id=$1",
      [oldExamAttempt, newVersion.versionId],
    );
  });
  await test("student_history_and_admin_results_show_real_standalone_attempts", async () => {
    const html = await publicHtml(studentCookie);
    assert.ok(html.includes(`/results/${homeworkAttempt}`));
    assert.ok(html.includes(`/results/${oldExamAttempt}`));
    const admin = await fetch(`${origin}/admin/assessments/${homework.id}`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(admin.status, 200);
    assert.ok((await admin.text()).includes(student.name));
  });
  let deadlineAttempt;
  await test("deadline_worker_grades_standalone_exam_with_disabled_account_and_no_browser", async () => {
    const deadline = await create("exam", `${marker} تسليم تلقائي`, {
      closesAt: new Date(Date.now() + 11_000).toISOString(),
    });
    deadlineAttempt = await start(deadline);
    const active = (
      await ok(`attempts/${deadlineAttempt}`, undefined, studentCookie)
    ).data;
    await ok(
      `attempts/${deadlineAttempt}/answer`,
      {
        questionId: active.questions[0].id,
        optionId: active.questions[0].options[0].id,
        revision: "1",
      },
      studentCookie,
    );
    await ok(
      "admin/student-disable",
      { studentId: student.id, reason: `اختبار تسليم تلقائي ${suffix}` },
      adminCookie,
    );
    assert.equal(
      (await api(`attempts/${deadlineAttempt}`, undefined, studentCookie))
        .status,
      401,
    );
    const until = Date.now() + 26_000;
    let state;
    while (Date.now() < until) {
      state = (
        await db.query(
          "select t.status,t.submission_kind,r.earned_points,r.possible_points from app_private.attempts t left join app_private.attempt_results r on r.attempt_id=t.id where t.id=$1",
          [deadlineAttempt],
        )
      ).rows[0];
      if (state.status === "submitted") break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    assert.equal(state.status, "submitted");
    assert.equal(state.submission_kind, "deadline");
    assert.equal(Number(state.earned_points), 7);
    assert.equal(Number(state.possible_points), 10);
    await ok("admin/student-enable", { studentId: student.id }, adminCookie);
    studentCookie = (
      await ok("auth/login", {
        phone: student.phone,
        password: student.password,
      })
    ).cookie;
    assert.equal(
      (await ok(`results/${deadlineAttempt}`, undefined, studentCookie)).data
        .modelAvailable,
      true,
    );
  });
  writeFileSync(
    ".local/standalone-browser-account.json",
    JSON.stringify(
      { ...student, assessmentIds: { homework: homework.id, exam: exam.id } },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  writeFileSync(
    ".local/standalone-verification.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        fixtureIds: fixtures,
        studentId: student.id,
        homeworkId: homework.id,
        examId: exam.id,
        deadlineAttempt,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      artifact: ".local/standalone-verification.json",
    }),
  );
} finally {
  for (const id of fixtures) {
    try {
      const row = (
        await db.query(
          "select title,deleted_at from app_private.assessments where id=$1",
          [id],
        )
      ).rows[0];
      if (row && row.title.startsWith(marker) && !row.deleted_at)
        await ok("admin/assessment-delete", { id, confirm: true }, adminCookie);
    } catch {
      console.error("Standalone fixture assessment cleanup failed.");
    }
  }
  for (const account of accounts) {
    try {
      const row = (
        await db.query(
          "select full_name,status from app_private.accounts where id=$1",
          [account.id],
        )
      ).rows[0];
      if (row?.full_name === account.name && row.status === "active")
        await ok(
          "admin/student-disable",
          { studentId: account.id, reason: `نهاية تحقق مستقل ${suffix}` },
          adminCookie,
        );
    } catch {
      console.error("Standalone fixture account cleanup failed.");
    }
  }
  for (const cookie of [adminCookie, studentCookie, otherCookie])
    if (cookie) await api("auth/logout", {}, cookie).catch(() => {});
  await db.end();
}
