import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { transaction } from "@/server/core/db";
import { identity } from "@/server/auth/service";
import { denied } from "@/server/core/errors";
import { uuid } from "@/server/catalog/admin";
import { learningContext } from "@/server/learning/service";

async function context(
  db: PoolClient,
  studentId: string,
  assessmentId: string,
  allowExpired = false,
  continueExisting = false,
  start = false,
) {
  let assessment = (
    await db.query(
      `select a.*,coalesce(a.lesson_id,(select l.id from app_private.lessons l where l.course_id=a.course_id and l.published_at is not null and (a.unit_id is null or l.unit_id=a.unit_id) order by l.position limit 1)) as anchor_lesson_id
    from app_private.assessments a where a.id=$1`,
      [assessmentId],
    )
  ).rows[0];
  if (!assessment)
    denied(404, "assessment_unavailable", "التقييم غير موجود أو غير جاهز.");
  if (assessment.scope === "standalone") {
    assessment = (
      await db.query(
        `select a.*,g.deleted_at as grade_deleted_at,s.deleted_at as subject_deleted_at
        from app_private.assessments a join app_private.grades g on g.id=a.grade_id
        join app_private.subjects s on s.id=a.subject_id where a.id=$1
        ${start ? "for update of a for share of g,s" : "for share of a,g,s"}`,
        [assessmentId],
      )
    ).rows[0];
    const profile = (
      await db.query(
        "select grade_id from app_private.student_profiles where account_id=$1 for share",
        [studentId],
      )
    ).rows[0];
    if (!assessment || !profile || profile.grade_id !== assessment.grade_id)
      denied(
        403,
        "grade_required",
        "التقييم ده متاح لطلاب صفه الدراسي فقط. راجع الصف المسجّل في حسابك.",
      );
    if (
      !continueExisting &&
      (assessment.status !== "published" ||
        assessment.deleted_at ||
        assessment.grade_deleted_at ||
        assessment.subject_deleted_at)
    )
      denied(
        404,
        "assessment_unavailable",
        "التقييم غير منشور أو اتوقف عن استقبال محاولات جديدة.",
      );
    if (
      continueExisting &&
      !["published", "archived"].includes(assessment.status)
    )
      denied(
        403,
        "assessment_unavailable",
        "المحاولة غير متاحة للحالة الحالية.",
      );
    return { assessment, lesson: null };
  }
  if (!assessment.anchor_lesson_id)
    denied(404, "assessment_unavailable", "التقييم غير موجود أو غير جاهز.");
  if (
    !continueExisting &&
    assessment.deleted_at &&
    assessment.kind !== "homework"
  )
    denied(
      404,
      "assessment_unavailable",
      "التقييم اتوقف عن استقبال محاولات جديدة.",
    );
  const learning = await learningContext(
    db,
    studentId,
    assessment.anchor_lesson_id,
    allowExpired,
  );
  return { assessment, ...learning };
}
export async function finalizeAttempt(
  db: PoolClient,
  attempt: Record<string, unknown>,
  kind: "manual" | "deadline",
) {
  if (attempt.status === "submitted") return;
  const scores = (
    await db.query(
      `select coalesce(sum(q.points) filter(where ans.selected_option_id=k.correct_option_id),0) as earned,
    sum(q.points) as possible,count(*)::int as questions,count(ans.selected_option_id)::int as answered,
    coalesce(sum(q.points) filter(where ans.selected_option_id=k.correct_option_id),0)*100>=sum(q.points)*v.pass_percent as passed
    from app_private.questions q join app_private.answer_keys k on k.version_id=q.version_id and k.question_id=q.id
    join app_private.assessment_versions v on v.id=q.version_id
    left join app_private.attempt_answers ans on ans.attempt_id=$1 and ans.question_id=q.id where q.version_id=$2 group by v.pass_percent`,
      [attempt.id, attempt.version_id],
    )
  ).rows[0];
  if (!scores || Number(scores.possible) <= 0)
    throw new Error("Published assessment invariant failed.");
  if (attempt.kind === "homework" && scores.answered !== scores.questions)
    denied(
      409,
      "answers_incomplete",
      "جاوب كل أسئلة الواجب واحفظها قبل التسليم.",
    );
  await db.query(
    `insert into app_private.attempt_results(attempt_id,earned_points,possible_points,passed,graded_at) values($1,$2,$3,$4,clock_timestamp())`,
    [attempt.id, scores.earned, scores.possible, scores.passed],
  );
  await db.query(
    "update app_private.attempts set status='submitted',submitted_at=clock_timestamp(),submission_kind=$2,result_id=id where id=$1",
    [attempt.id, kind],
  );
  if (attempt.kind === "homework" && scores.passed && attempt.course_id)
    await db.query(
      `insert into app_private.homework_passes(student_id,assessment_id,course_id,first_pass_attempt_id,passed_at)
    values($1,$2,$3,$4,clock_timestamp()) on conflict do nothing`,
      [
        attempt.student_id,
        attempt.assessment_id,
        attempt.course_id,
        attempt.id,
      ],
    );
}
export async function assessmentPreview(assessmentId: string, token: string) {
  return transaction(async (db) => {
    const actor = await identity(db, token, "student", true);
    uuid(assessmentId);
    const { assessment } = await context(db, actor.id, assessmentId);
    const version = (
      await db.query(
        "select * from app_private.assessment_versions where id=$1 and published_at is not null",
        [assessment.current_version_id],
      )
    ).rows[0];
    if (!version)
      denied(404, "assessment_unavailable", "التقييم لسه مش منشور.");
    const attempts = (
      await db.query(
        "select id,status,deadline_at,attempt_number from app_private.attempts where student_id=$1 and assessment_id=$2 order by attempt_number desc",
        [actor.id, assessmentId],
      )
    ).rows;
    const window = (
      await db.query(
        "select ($1::timestamptz is null or clock_timestamp()>=$1) and ($2::timestamptz is null or clock_timestamp()<$2) as open",
        [version.opens_at, version.closes_at],
      )
    ).rows[0];
    return {
      id: assessment.id,
      title: assessment.title,
      courseId: assessment.course_id,
      scope: assessment.scope as "course" | "standalone",
      versionId: version.id,
      kind: assessment.kind as "homework" | "exam",
      durationSeconds: version.duration_seconds as number | null,
      maxAttempts: version.max_attempts as number | null,
      passPercent: Number(version.pass_percent),
      opensAt: version.opens_at as string | null,
      closesAt: version.closes_at as string | null,
      attemptsUsed: attempts.length,
      windowOpen: Boolean(window.open),
      activeAttemptId: attempts.find((a) => a.status === "in_progress")?.id as
        string | undefined,
      questionCount: (
        await db.query(
          "select count(*)::int n from app_private.questions where version_id=$1",
          [version.id],
        )
      ).rows[0].n as number,
    };
  });
}
export async function startAttempt(
  body: Record<string, unknown>,
  token: string,
) {
  return transaction(async (db) => {
    const actor = await identity(db, token, "student", true),
      assessmentId = uuid(body.assessmentId),
      versionId = uuid(body.versionId);
    const { assessment, lesson } = await context(
      db,
      actor.id,
      assessmentId,
      false,
      false,
      true,
    );
    await db.query(
      "select id from app_private.assessments where id=$1 for update",
      [assessmentId],
    );
    const existing = (
      await db.query(
        "select *,deadline_at is not null and clock_timestamp()>=deadline_at as due from app_private.attempts where student_id=$1 and assessment_id=$2 and status='in_progress' for update",
        [actor.id, assessmentId],
      )
    ).rows[0];
    if (existing) {
      if (existing.due) {
        await finalizeAttempt(db, existing, "deadline");
        return { id: existing.id, next: `/results/${existing.id}` };
      }
      return { id: existing.id, next: `/attempts/${existing.id}` };
    }
    const current = (
      await db.query(
        "select current_version_id from app_private.assessments where id=$1",
        [assessmentId],
      )
    ).rows[0];
    if (current.current_version_id !== versionId)
      denied(
        409,
        "version_changed",
        "إعدادات التقييم اتحدّثت. ارجع للتعليمات وراجعها قبل البدء.",
      );
    const version = (
      await db.query(
        "select * from app_private.assessment_versions where id=$1 and published_at is not null",
        [versionId],
      )
    ).rows[0];
    if (!version) denied(409, "assessment_unavailable", "التقييم غير جاهز.");
    const used = (
      await db.query(
        "select count(*)::int n from app_private.attempts where student_id=$1 and assessment_id=$2",
        [actor.id, assessmentId],
      )
    ).rows[0].n;
    const timing = (
      await db.query(
        `with moment as materialized(select clock_timestamp() as t) select t::text as starts,
      ($1::timestamptz is null or t>=$1) and ($2::timestamptz is null or t<$2) as open,
      case when $3::integer is null then null else least(t+$3*interval '1 second',$2::timestamptz) end as deadline from moment`,
        [version.opens_at, version.closes_at, version.duration_seconds],
      )
    ).rows[0];
    if (
      assessment.kind === "exam" &&
      (!timing.open || used >= version.max_attempts)
    )
      denied(
        409,
        "attempt_unavailable",
        "الامتحان خارج موعده أو محاولاتك خلصت.",
      );
    // The account/course/gate locks are still held; check access at the final clock.
    const live =
      assessment.scope === "course"
        ? (
            await db.query(
              "select access_until>$3::timestamptz and withdrawn_at is null as active from app_private.course_access where student_id=$1 and course_id=$2",
              [actor.id, assessment.course_id, timing.starts],
            )
          ).rows[0]
        : null;
    if (assessment.scope === "course" && !live?.active)
      denied(
        403,
        "access_required",
        "الوصول للكورس انتهى. جدّد الوصول قبل بدء محاولة جديدة.",
      );
    const id = randomUUID();
    await db.query(
      `insert into app_private.attempts(id,student_id,assessment_id,version_id,course_id,kind,attempt_number,started_at,deadline_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        actor.id,
        assessmentId,
        versionId,
        assessment.course_id,
        assessment.kind,
        used + 1,
        timing.starts,
        timing.deadline,
      ],
    );
    if (lesson)
      await db.query(
        "update app_private.lessons set first_used_at=coalesce(first_used_at,clock_timestamp()) where id=$1",
        [lesson.id],
      );
    return { id, next: `/attempts/${id}` };
  });
}
async function owned(db: PoolClient, studentId: string, id: string) {
  const attempt = (
    await db.query(
      "select *,deadline_at is not null and clock_timestamp()>=deadline_at as due from app_private.attempts where id=$1 and student_id=$2 for update",
      [id, studentId],
    )
  ).rows[0];
  if (!attempt) denied(404, "attempt_unavailable", "المحاولة غير موجودة.");
  if (attempt.status === "in_progress" && attempt.due) {
    await finalizeAttempt(db, attempt, "deadline");
    attempt.status = "submitted";
  }
  return attempt;
}
async function questionsForAttempt(
  db: PoolClient,
  attemptId: string,
  versionId: string,
) {
  return (
    await db.query(
      `select q.id,q.position,q.prompt,q.points,ans.selected_option_id,coalesce(ans.revision,0)::text as revision,
    (select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label) order by o.position) from app_private.question_options o where o.version_id=q.version_id and o.question_id=q.id) as options
    from app_private.questions q left join app_private.attempt_answers ans on ans.attempt_id=$1 and ans.question_id=q.id where q.version_id=$2 order by q.position`,
      [attemptId, versionId],
    )
  ).rows;
}
export async function readAttempt(id: string, token: string) {
  return transaction(async (db) => {
    const actor = await identity(db, token, "student", true);
    uuid(id);
    const lookup = (
      await db.query(
        "select assessment_id,kind from app_private.attempts where id=$1 and student_id=$2",
        [id, actor.id],
      )
    ).rows[0];
    if (!lookup) denied(404, "attempt_unavailable", "المحاولة غير موجودة.");
    // Resource locks precede the attempt row for every human operation.
    const status = (
      await db.query(
        "select status,deadline_at is not null and clock_timestamp()>=deadline_at as due from app_private.attempts where id=$1",
        [id],
      )
    ).rows[0];
    if (status.status === "in_progress" && !status.due)
      await context(
        db,
        actor.id,
        lookup.assessment_id,
        lookup.kind === "exam",
        true,
      );
    const attempt = await owned(db, actor.id, id);
    if (attempt.status === "submitted")
      return { submitted: true as const, next: `/results/${id}` };
    const assessment = (
      await db.query("select title from app_private.assessments where id=$1", [
        attempt.assessment_id,
      ])
    ).rows[0];
    const remaining = (
      await db.query(
        "select greatest(0,extract(epoch from($1::timestamptz-clock_timestamp()))*1000) as ms",
        [attempt.deadline_at],
      )
    ).rows[0];
    return {
      submitted: false as const,
      id,
      title: assessment.title as string,
      studentId: actor.id,
      kind: attempt.kind as "homework" | "exam",
      courseId: attempt.course_id as string | null,
      assessmentId: attempt.assessment_id as string,
      attemptNumber: attempt.attempt_number as number,
      deadlineAt: attempt.deadline_at as string | null,
      remainingMs: attempt.deadline_at ? Number(remaining.ms) : null,
      questions: await questionsForAttempt(db, id, attempt.version_id),
    };
  });
}
export async function attemptCommand(
  action: string,
  id: string,
  body: Record<string, unknown>,
  token: string,
) {
  return transaction(async (db) => {
    const actor = await identity(db, token, "student", true);
    uuid(id);
    const lookup = (
      await db.query(
        "select assessment_id,kind,status,deadline_at is not null and clock_timestamp()>=deadline_at as due from app_private.attempts where id=$1 and student_id=$2",
        [id, actor.id],
      )
    ).rows[0];
    if (!lookup) denied(404, "attempt_unavailable", "المحاولة غير موجودة.");
    if (lookup.status === "in_progress" && !lookup.due)
      await context(
        db,
        actor.id,
        lookup.assessment_id,
        lookup.kind === "exam",
        true,
      );
    const attempt = await owned(db, actor.id, id);
    if (attempt.status === "submitted") {
      if (action === "submit")
        return { submitted: true, next: `/results/${id}` };
      denied(
        409,
        "attempt_closed",
        "المحاولة اتسلّمت. آخر إجابات وصلت للسيرفر هي اللي اتحسبت.",
      );
    }
    // Re-evaluate the exact deadline after any lock wait.
    if (
      attempt.deadline_at &&
      (
        await db.query("select clock_timestamp()>=$1::timestamptz as due", [
          attempt.deadline_at,
        ])
      ).rows[0].due
    ) {
      await finalizeAttempt(db, attempt, "deadline");
      return { submitted: true, next: `/results/${id}` };
    }
    if (action === "submit") {
      await finalizeAttempt(db, attempt, "manual");
      return { submitted: true, next: `/results/${id}` };
    }
    if (action !== "answer") denied(404, "not_found", "العملية غير موجودة.");
    const questionId = uuid(body.questionId),
      optionId = body.optionId === null ? null : uuid(body.optionId),
      revision = String(body.revision);
    if (!/^\d{1,15}$/.test(revision) || BigInt(revision) < BigInt(1))
      denied(400, "invalid_revision", "إصدار الإجابة غير صحيح.");
    if (
      !(
        await db.query(
          "select id from app_private.questions where id=$1 and version_id=$2",
          [questionId, attempt.version_id],
        )
      ).rowCount
    )
      denied(400, "invalid_question", "السؤال مش تابع للمحاولة دي.");
    if (
      optionId &&
      !(
        await db.query(
          "select id from app_private.question_options where id=$1 and question_id=$2 and version_id=$3",
          [optionId, questionId, attempt.version_id],
        )
      ).rowCount
    )
      denied(400, "invalid_option", "الاختيار مش تابع للسؤال ده.");
    const saved = (
      await db.query(
        `insert into app_private.attempt_answers(attempt_id,version_id,question_id,selected_option_id,revision,received_at) values($1,$2,$3,$4,$5,clock_timestamp())
      on conflict(attempt_id,question_id) do update set selected_option_id=excluded.selected_option_id,revision=excluded.revision,received_at=excluded.received_at
      where app_private.attempt_answers.revision<excluded.revision returning selected_option_id,revision::text`,
        [id, attempt.version_id, questionId, optionId, revision],
      )
    ).rows[0];
    const current =
      saved ??
      (
        await db.query(
          "select selected_option_id,revision::text from app_private.attempt_answers where attempt_id=$1 and question_id=$2",
          [id, questionId],
        )
      ).rows[0];
    return {
      saved: Boolean(saved),
      questionId,
      optionId: current.selected_option_id,
      revision: current.revision,
    };
  });
}
export async function readResult(id: string, token: string) {
  return transaction(async (db) => {
    const actor = await identity(db, token, "student", true);
    uuid(id);
    const attempt = await owned(db, actor.id, id);
    if (attempt.status !== "submitted")
      denied(409, "result_unavailable", "المحاولة لسه ما اتسلّمتش.");
    const result = (
      await db.query(
        `select r.earned_points,r.possible_points,r.passed,r.graded_at,a.title,v.closes_at,v.max_attempts,
      case when t.kind='exam' then case when v.closes_at is not null then clock_timestamp()>=v.closes_at
        else (select count(*) from app_private.attempts x where x.student_id=t.student_id and x.assessment_id=t.assessment_id)>=v.max_attempts end else false end as model_available
      from app_private.attempt_results r join app_private.attempts t on t.id=r.attempt_id join app_private.assessments a on a.id=t.assessment_id join app_private.assessment_versions v on v.id=t.version_id where r.attempt_id=$1`,
        [id],
      )
    ).rows[0];
    let model: unknown[] = [];
    if (result.model_available) {
      const questions = await questionsForAttempt(db, id, attempt.version_id);
      const keys = (
        await db.query(
          "select question_id,correct_option_id,explanation from app_private.answer_keys where version_id=$1",
          [attempt.version_id],
        )
      ).rows;
      model = questions.map((q) => ({
        ...q,
        ...keys.find((k) => k.question_id === q.id),
      }));
    }
    return {
      id,
      title: result.title as string,
      courseId: attempt.course_id as string | null,
      assessmentId: attempt.assessment_id as string,
      kind: attempt.kind as "homework" | "exam",
      attemptNumber: attempt.attempt_number as number,
      earnedPoints: Number(result.earned_points),
      possiblePoints: Number(result.possible_points),
      passed: result.passed as boolean,
      gradedAt: result.graded_at as string,
      modelAvailable: result.model_available as boolean,
      closesAt: result.closes_at as string | null,
      model,
    };
  });
}
export async function runDueAttempts(limit = 20, statementTimeoutMs?: number) {
  if (
    statementTimeoutMs !== undefined &&
    (!Number.isSafeInteger(statementTimeoutMs) ||
      statementTimeoutMs < 1 ||
      statementTimeoutMs > 15_000)
  )
    throw new Error("Invalid deadline statement timeout.");
  let finalized = 0;
  for (let i = 0; i < limit; i++) {
    const done = await transaction(async (db) => {
      if (statementTimeoutMs !== undefined)
        await db.query("select set_config('statement_timeout',$1,true)", [
          `${statementTimeoutMs}ms`,
        ]);
      const attempt = (
        await db.query(
          "select * from app_private.attempts where status='in_progress' and kind='exam' and deadline_at<=clock_timestamp() order by deadline_at,id limit 1 for update skip locked",
        )
      ).rows[0];
      if (!attempt) return false;
      await finalizeAttempt(db, attempt, "deadline");
      return true;
    });
    if (!done) break;
    finalized++;
  }
  return finalized;
}

export async function standaloneHistory(token: string) {
  return transaction(async (db) => {
    const actor = await identity(db, token, "student", true);
    return (
      await db.query(
        `select t.id,t.assessment_id,t.kind,t.attempt_number,t.status,t.started_at,t.deadline_at,t.submitted_at,
      a.title,g.name as grade_name,s.name as subject_name,r.earned_points,r.possible_points,r.passed
      from app_private.attempts t join app_private.assessments a on a.id=t.assessment_id
      join app_private.grades g on g.id=a.grade_id join app_private.subjects s on s.id=a.subject_id
      left join app_private.attempt_results r on r.attempt_id=t.id
      where t.student_id=$1 and a.scope='standalone'
      order by t.started_at desc,t.id limit 50`,
        [actor.id],
      )
    ).rows;
  });
}
