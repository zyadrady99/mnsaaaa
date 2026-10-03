import "server-only";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { transaction } from "./db";
import { identity } from "./auth";
import { denied } from "./errors";
import { audit, text, uuid } from "./admin-catalog";

export const assessmentActions: Record<string, string[]> = {
  "video-fixture": ["lessonId"],
  "video-submit": ["lessonId", "simulateFailure"],
  "video-retry": ["lessonId"],
  "lesson-publish": ["lessonId"],
  "assessment-save": [
    "id",
    "versionId",
    "courseId",
    "scope",
    "gradeId",
    "subjectId",
    "lessonId",
    "unitId",
    "kind",
    "title",
    "durationMinutes",
    "maxAttempts",
    "passPercent",
    "opensAt",
    "closesAt",
    "questions",
  ],
  "assessment-publish": ["versionId"],
  "assessment-archive": ["id"],
};
type QuestionInput = {
  prompt: unknown;
  options: unknown;
  correct: unknown;
  points: unknown;
  explanation: unknown;
};
function date(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    denied(400, "invalid_time", "راجع وقت بداية ونهاية الامتحان.");
  return new Date(value).toISOString();
}
export async function assessmentCommand(
  action: string,
  body: Record<string, unknown>,
  token: string,
) {
  const videoAction = ["video-fixture", "video-submit", "video-retry"].includes(
    action,
  );
  if (videoAction) {
    if (process.env.DOROSNA_LOCAL_ONLY !== "1")
      denied(
        409,
        "fixture_local_only",
        "الفيديو التجريبي متاح في النسخة المحلية فقط.",
      );
    try {
      if (
        !(await stat(path.join(process.cwd(), ".local/media/sample.mp4"))).size
      )
        throw new Error();
    } catch {
      denied(409, "fixture_missing", "ملف الفيديو التجريبي غير جاهز.");
    }
  }
  return transaction(async (db) => {
    const actor = await identity(db, token, "admin", true);
    if (videoAction || action === "lesson-publish") {
      const lessonId = uuid(body.lessonId);
      const found = (
        await db.query(
          "select course_id from app_private.lessons where id=$1",
          [lessonId],
        )
      ).rows[0];
      if (!found) denied(404, "not_found", "الدرس غير موجود.");
      const course = (
        await db.query(
          "select * from app_private.courses where id=$1 for update",
          [found.course_id],
        )
      ).rows[0];
      const lesson = (
        await db.query(
          "select * from app_private.lessons where id=$1 for update",
          [lessonId],
        )
      ).rows[0];
      if (
        course.status === "archived" ||
        course.deleted_at ||
        lesson.deleted_at ||
        lesson.published_at ||
        lesson.first_used_at
      )
        denied(
          409,
          "lesson_frozen",
          "الدرس ده منشور أو مستخدم؛ محتواه الأساسي ثابت.",
        );
      if (
        !(
          await db.query(
            "select id from app_private.course_units where id=$1 and deleted_at is null for share",
            [lesson.unit_id],
          )
        ).rowCount
      )
        denied(
          409,
          "lesson_frozen",
          "وحدة الدرس محذوفة؛ تجهيز الدرس أو نشره غير متاح.",
        );
      if (videoAction) {
        if (course.delivery_environment !== "development")
          denied(
            409,
            "fixture_local_only",
            "الكورس الفعلي يحتاج فيديو جاهز من مزود الفيديو.",
          );
        const id = randomUUID();
        if (
          action === "video-retry" &&
          !(
            await db.query(
              "select id from app_private.video_uploads where id=$1 and state='failed'",
              [lesson.current_video_id],
            )
          ).rowCount
        )
          denied(
            409,
            "retry_unavailable",
            "إعادة المعالجة متاحة للفيديو اللي فشلت معالجته.",
          );
        await db.query(
          `insert into app_private.video_uploads(id,lesson_id,generation,provider,local_fixture_ref,state,verification,duration_seconds)
          select $1,$2,coalesce(max(generation),0)+1,'local',$3,$4,'fixture',$5 from app_private.video_uploads where lesson_id=$2`,
          [
            id,
            lessonId,
            body.simulateFailure === true ? "sample-failure.mp4" : "sample.mp4",
            action === "video-fixture" ? "ready" : "processing",
            action === "video-fixture" ? 20 : null,
          ],
        );
        await db.query(
          "update app_private.lessons set current_video_id=$2 where id=$1",
          [lessonId, id],
        );
      } else {
        const ready = (
          await db.query(
            `select exists(select 1 from app_private.video_uploads where id=$1 and lesson_id=$2 and state='ready') and
          exists(select 1 from app_private.assessments a join app_private.assessment_versions v on v.id=a.current_version_id
            where a.lesson_id=$2 and a.kind='homework' and a.deleted_at is null and v.published_at is not null) as ok`,
            [lesson.current_video_id, lessonId],
          )
        ).rows[0];
        if (!ready.ok)
          denied(
            409,
            "lesson_not_ready",
            "جهّز فيديو جاهز وانشر واجب الدرس قبل نشره.",
          );
        const prior = (
          await db.query(
            "select max(position) as position from app_private.lessons where course_id=$1 and published_at is not null",
            [course.id],
          )
        ).rows[0];
        if (prior.position !== null && lesson.position <= prior.position)
          denied(
            409,
            "append_only",
            "الدروس الجديدة تتنشر في آخر المنهج. راجع ترتيب المسودات قبل نشرها.",
          );
        await db.query(
          "update app_private.lessons set published_at=clock_timestamp() where id=$1",
          [lessonId],
        );
      }
      await audit(db, actor.id, action, "lesson", lessonId);
      return {
        message: videoAction
          ? action === "video-fixture"
            ? "الفيديو التجريبي جاهز؛ مدته ٢٠ ثانية."
            : "الفيديو التجريبي قيد المعالجة. الحالة هتتحدث تلقائيًا."
          : "الدرس اتنشر.",
        id: lessonId,
        next: `/admin/courses/${course.id}`,
      };
    }
    if (action === "assessment-archive") {
      const id = uuid(body.id);
      const assessment = (
        await db.query(
          "select * from app_private.assessments where id=$1 for update",
          [id],
        )
      ).rows[0];
      if (
        !assessment ||
        assessment.scope !== "standalone" ||
        assessment.deleted_at
      )
        denied(
          404,
          "assessment_unavailable",
          "التقييم المستقل غير موجود أو محذوف.",
        );
      if (assessment.status !== "published")
        denied(
          409,
          "assessment_unavailable",
          "الأرشفة متاحة للتقييم المستقل المنشور فقط.",
        );
      await db.query(
        "update app_private.assessments set status='archived' where id=$1",
        [id],
      );
      await audit(db, actor.id, action, "assessment", id);
      return {
        id,
        next: `/admin/assessments/${id}`,
        message: "التقييم اتأرشف. المحاولات الجارية والنتائج السابقة محفوظة.",
      };
    }
    if (action === "assessment-publish") {
      const versionId = uuid(body.versionId);
      const lookup = (
        await db.query(
          "select assessment_id from app_private.assessment_versions where id=$1",
          [versionId],
        )
      ).rows[0];
      if (!lookup) denied(404, "not_found", "الإصدار غير موجود.");
      const assessment = (
        await db.query(
          "select * from app_private.assessments where id=$1 for update",
          [lookup.assessment_id],
        )
      ).rows[0];
      if (assessment.deleted_at || assessment.status === "archived")
        denied(
          409,
          "assessment_unavailable",
          "التقييم محذوف أو مؤرشف؛ نشره غير متاح.",
        );
      if (
        assessment.scope === "standalone" &&
        !(
          await db.query(
            "select g.id from app_private.grades g join app_private.subjects s on s.id=$2 where g.id=$1 and g.enabled and s.enabled and g.deleted_at is null and s.deleted_at is null for share of g,s",
            [assessment.grade_id, assessment.subject_id],
          )
        ).rowCount
      )
        denied(
          409,
          "reference_unavailable",
          "الصف أو المادة غير متاحين للنشر.",
        );
      const version = (
        await db.query(
          "select * from app_private.assessment_versions where id=$1 for update",
          [versionId],
        )
      ).rows[0];
      if (version.published_at)
        denied(409, "version_frozen", "الإصدار ده منشور بالفعل.");
      await db.query(
        "update app_private.assessment_versions set published_at=clock_timestamp() where id=$1",
        [versionId],
      );
      await db.query(
        "update app_private.assessments set current_version_id=$2,status='published' where id=$1",
        [assessment.id, versionId],
      );
      await audit(db, actor.id, action, "assessment_version", versionId);
      return {
        message: "التقييم اتنشر. المحاولات السابقة بتحتفظ بإصدارها.",
        next:
          assessment.scope === "standalone"
            ? `/admin/assessments/${assessment.id}`
            : `/admin/courses/${assessment.course_id}`,
        id: assessment.id,
      };
    }
    if (action !== "assessment-save")
      denied(404, "not_found", "العملية غير موجودة.");
    const scope = body.scope ?? "course";
    if (scope !== "course" && scope !== "standalone")
      denied(
        400,
        "invalid_scope",
        "اختار تقييمًا مستقلًا أو تقييمًا تابعًا لكورس.",
      );
    const standalone = scope === "standalone";
    if (
      standalone &&
      [body.courseId, body.lessonId, body.unitId].some(
        (value) => value !== undefined && value !== null && value !== "",
      )
    )
      denied(
        400,
        "invalid_scope",
        "التقييم المستقل لا يرتبط بكورس أو درس أو وحدة.",
      );
    if (
      !standalone &&
      [body.gradeId, body.subjectId].some(
        (value) => value !== undefined && value !== null && value !== "",
      )
    )
      denied(400, "invalid_scope", "صف ومادة تقييم الكورس يتحددان من الكورس.");
    const courseId = standalone ? null : uuid(body.courseId),
      gradeId = standalone ? uuid(body.gradeId) : null,
      subjectId = standalone ? uuid(body.subjectId) : null,
      kind = body.kind;
    if (!["homework", "exam"].includes(String(kind)))
      denied(400, "invalid_kind", "اختار واجبًا أو امتحانًا.");
    const title = text(body.title, 180),
      lessonId =
        !standalone && kind === "homework" ? uuid(body.lessonId) : null,
      unitId =
        !standalone && kind === "exam" && body.unitId
          ? uuid(body.unitId)
          : null;
    const duration = kind === "exam" ? Number(body.durationMinutes) * 60 : null,
      maxAttempts = kind === "exam" ? Number(body.maxAttempts) : null,
      passPercent = kind === "exam" ? Number(body.passPercent) : 70;
    if (
      kind === "exam" &&
      (!Number.isSafeInteger(duration) ||
        duration! < 60 ||
        duration! > 14400 ||
        !Number.isSafeInteger(maxAttempts) ||
        maxAttempts! < 1 ||
        maxAttempts! > 100 ||
        !Number.isFinite(passPercent) ||
        passPercent < 0 ||
        passPercent > 100)
    )
      denied(
        400,
        "invalid_exam_settings",
        "راجع مدة الامتحان وعدد المحاولات ونسبة النجاح.",
      );
    const opens = kind === "exam" ? date(body.opensAt) : null,
      closes = kind === "exam" ? date(body.closesAt) : null;
    if (opens && closes && Date.parse(opens) >= Date.parse(closes))
      denied(400, "invalid_time", "النهاية لازم تكون بعد البداية.");
    if (
      !Array.isArray(body.questions) ||
      body.questions.length < 1 ||
      body.questions.length > 100
    )
      denied(400, "questions_required", "ضيف من سؤال إلى ١٠٠ سؤال.");
    const questions = body.questions.map((raw) => {
      if (!raw || typeof raw !== "object")
        denied(400, "invalid_question", "راجع بيانات الأسئلة.");
      const q = raw as QuestionInput;
      if (
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.length > 6
      )
        denied(
          400,
          "invalid_options",
          "كل سؤال يحتاج من اختيارين إلى ٦ اختيارات.",
        );
      const correct = Number(q.correct),
        points = Number(q.points);
      if (
        !Number.isSafeInteger(correct) ||
        correct < 0 ||
        correct >= q.options.length ||
        !Number.isFinite(points) ||
        points <= 0 ||
        points > 1000 ||
        Math.round(points * 1000) !== points * 1000
      )
        denied(400, "invalid_question", "راجع الإجابة الصحيحة ودرجة السؤال.");
      return {
        prompt: text(q.prompt, 3000),
        options: q.options.map((option) => text(option, 1000)),
        correct,
        points,
        explanation: text(q.explanation ?? "", 3000, 0),
      };
    });
    const course = courseId
      ? (
          await db.query(
            "select * from app_private.courses where id=$1 for update",
            [courseId],
          )
        ).rows[0]
      : null;
    if (
      !standalone &&
      (!course || course.status === "archived" || course.deleted_at)
    )
      denied(409, "course_unavailable", "الكورس غير متاح للتعديل.");
    if (
      standalone &&
      !(
        await db.query(
          "select g.id from app_private.grades g join app_private.subjects s on s.id=$2 where g.id=$1 and g.enabled and s.enabled and g.deleted_at is null and s.deleted_at is null for share of g,s",
          [gradeId, subjectId],
        )
      ).rowCount
    )
      denied(409, "reference_unavailable", "اختار صفًا ومادة متاحين.");
    if (
      lessonId &&
      !(
        await db.query(
          "select id from app_private.lessons where id=$1 and course_id=$2",
          [lessonId, courseId],
        )
      ).rowCount
    )
      denied(400, "invalid_lesson", "الدرس مش تابع للكورس ده.");
    if (
      unitId &&
      !(
        await db.query(
          "select id from app_private.course_units where id=$1 and course_id=$2",
          [unitId, courseId],
        )
      ).rowCount
    )
      denied(400, "invalid_unit", "الوحدة مش تابعة للكورس ده.");
    let assessmentId: string;
    if (body.id) {
      assessmentId = uuid(body.id);
      const assessment = (
        await db.query(
          "select * from app_private.assessments where id=$1 for update",
          [assessmentId],
        )
      ).rows[0];
      if (
        !assessment ||
        assessment.scope !== scope ||
        assessment.grade_id !== gradeId ||
        assessment.subject_id !== subjectId ||
        assessment.course_id !== courseId ||
        assessment.kind !== kind ||
        assessment.lesson_id !== lessonId ||
        assessment.unit_id !== unitId
      )
        denied(
          409,
          "assessment_identity_frozen",
          "نوع التقييم والصف والمادة أو الكورس والدرس والوحدة ثابتون. أنشئ مسودة جديدة لتغييرهم.",
        );
      if (assessment.deleted_at || assessment.status === "archived")
        denied(
          409,
          "assessment_unavailable",
          "التقييم محذوف أو مؤرشف؛ تعديل إصداراته غير متاح.",
        );
      await db.query(
        "update app_private.assessments set title=$2 where id=$1",
        [assessmentId, title],
      );
    } else {
      assessmentId = randomUUID();
      if (
        !standalone &&
        kind === "homework" &&
        (
          await db.query(
            "select id from app_private.assessments where lesson_id=$1 and kind='homework'",
            [lessonId],
          )
        ).rowCount
      )
        denied(
          409,
          "homework_exists",
          "الدرس ليه واجب بالفعل. عدّل إصدار الواجب الموجود.",
        );
      await db.query(
        "insert into app_private.assessments(id,course_id,lesson_id,unit_id,kind,title,scope,grade_id,subject_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          assessmentId,
          courseId,
          lessonId,
          unitId,
          kind,
          title,
          scope,
          gradeId,
          subjectId,
        ],
      );
    }
    let versionId: string;
    if (body.versionId) {
      versionId = uuid(body.versionId);
      const version = (
        await db.query(
          "select * from app_private.assessment_versions where id=$1 and assessment_id=$2 for update",
          [versionId, assessmentId],
        )
      ).rows[0];
      if (!version || version.published_at)
        denied(
          409,
          "version_frozen",
          "الإصدار المنشور ثابت. اعمل إصدارًا جديدًا للتعديلات.",
        );
      await db.query(
        "delete from app_private.answer_keys where version_id=$1",
        [versionId],
      );
      await db.query(
        "delete from app_private.question_options where version_id=$1",
        [versionId],
      );
      await db.query("delete from app_private.questions where version_id=$1", [
        versionId,
      ]);
      await db.query(
        "update app_private.assessment_versions set duration_seconds=$2,max_attempts=$3,pass_percent=$4,opens_at=$5,closes_at=$6 where id=$1",
        [versionId, duration, maxAttempts, passPercent, opens, closes],
      );
    } else {
      versionId = randomUUID();
      await db.query(
        `insert into app_private.assessment_versions(id,assessment_id,course_id,kind,version_number,duration_seconds,max_attempts,pass_percent,opens_at,closes_at)
        select $1,$2,$3,$4,coalesce(max(version_number),0)+1,$5,$6,$7,$8,$9 from app_private.assessment_versions where assessment_id=$2`,
        [
          versionId,
          assessmentId,
          courseId,
          kind,
          duration,
          maxAttempts,
          passPercent,
          opens,
          closes,
        ],
      );
    }
    for (const [index, q] of questions.entries()) {
      const questionId = randomUUID();
      await db.query(
        "insert into app_private.questions(id,version_id,position,prompt,points) values($1,$2,$3,$4,$5)",
        [questionId, versionId, index + 1, q.prompt, q.points],
      );
      const options = q.options.map(() => randomUUID());
      for (const [i, label] of q.options.entries())
        await db.query(
          "insert into app_private.question_options(id,version_id,question_id,position,label) values($1,$2,$3,$4,$5)",
          [options[i], versionId, questionId, i + 1, label],
        );
      await db.query(
        "insert into app_private.answer_keys(version_id,question_id,correct_option_id,explanation) values($1,$2,$3,$4)",
        [versionId, questionId, options[q.correct], q.explanation],
      );
    }
    await audit(db, actor.id, action, "assessment_version", versionId);
    return {
      message: "مسودة التقييم اتحفظت. راجعها قبل النشر.",
      id: assessmentId,
      versionId,
      next: `/admin/assessments/${assessmentId}`,
    };
  });
}
