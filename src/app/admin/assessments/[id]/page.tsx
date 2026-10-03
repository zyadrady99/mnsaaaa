import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import {
  AssessmentEditor,
  type AssessmentDraft,
} from "@/components/assessment-editor";
import { MutationForm } from "@/components/mutation-form";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { validUuid } from "@/lib/auth-input";
import { cairoInput, cairoDate } from "@/lib/time";
import { referenceData } from "@/server/catalog";
import { arabicNumber } from "@/lib/catalog";
export const metadata = { title: "إدارة التقييم" };
export default async function AssessmentAdmin({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccount("admin");
  const { id } = await params;
  if (!validUuid(id)) notFound();
  const query = await searchParams;
  const assessment = (
    await database().query(
      "select a.*,g.name as grade_name,s.name as subject_name from app_private.assessments a left join app_private.grades g on g.id=a.grade_id left join app_private.subjects s on s.id=a.subject_id where a.id=$1",
      [id],
    )
  ).rows[0];
  if (!assessment) notFound();
  const standalone = assessment.scope === "standalone";
  const refs = standalone ? await referenceData() : null;
  const references = refs
    ? {
        grades: refs.grades
          .filter((g) => g.enabled || g.id === assessment.grade_id)
          .map((g) => ({ id: g.id, name: g.name })),
        subjects: refs.subjects
          .filter((s) => s.enabled || s.id === assessment.subject_id)
          .map((s) => ({ id: s.id, name: s.name })),
      }
    : undefined;
  if (
    references &&
    !references.grades.some((g) => g.id === assessment.grade_id)
  )
    references.grades.push({
      id: assessment.grade_id,
      name: assessment.grade_name,
    });
  if (
    references &&
    !references.subjects.some((s) => s.id === assessment.subject_id)
  )
    references.subjects.push({
      id: assessment.subject_id,
      name: assessment.subject_name,
    });
  const editable = !assessment.deleted_at && assessment.status !== "archived";
  const attempts = (
    await database().query(
      `select t.id,t.student_id,t.attempt_number,t.status,t.started_at,t.submitted_at,
      a.full_name,r.earned_points,r.possible_points,r.passed
      from app_private.attempts t join app_private.accounts a on a.id=t.student_id
      left join app_private.attempt_results r on r.attempt_id=t.id
      where t.assessment_id=$1 order by t.started_at desc,t.id limit 100`,
      [id],
    )
  ).rows;
  const versions = (
    await database().query(
      "select * from app_private.assessment_versions where assessment_id=$1 order by version_number desc",
      [id],
    )
  ).rows;
  const selected =
    typeof query.version === "string"
      ? versions.find((v) => v.id === query.version)
      : versions[0];
  if (!selected) notFound();
  const rows = (
    await database().query(
      `select q.*,k.correct_option_id,k.explanation,
    (select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label) order by o.position) from app_private.question_options o where o.version_id=q.version_id and o.question_id=q.id) as options
    from app_private.questions q join app_private.answer_keys k on k.version_id=q.version_id and k.question_id=q.id where q.version_id=$1 order by q.position`,
      [selected.id],
    )
  ).rows;
  const questions = rows.map((q) => ({
    uid: q.id,
    prompt: q.prompt,
    points: Number(q.points),
    explanation: q.explanation,
    options: q.options.map((o: { label: string }) => o.label),
    correct: q.options.findIndex(
      (o: { id: string }) => o.id === q.correct_option_id,
    ),
  }));
  const initial: AssessmentDraft = {
    id,
    versionId: selected.published_at ? undefined : selected.id,
    courseId: assessment.course_id,
    scope: assessment.scope,
    gradeId: assessment.grade_id ?? undefined,
    subjectId: assessment.subject_id ?? undefined,
    kind: assessment.kind,
    lessonId: assessment.lesson_id ?? undefined,
    unitId: assessment.unit_id ?? undefined,
    title: assessment.title,
    durationMinutes: Math.floor((selected.duration_seconds ?? 1800) / 60),
    maxAttempts: selected.max_attempts ?? 1,
    passPercent: Number(selected.pass_percent),
    opensAt: selected.opens_at ? cairoInput(selected.opens_at) : "",
    closesAt: selected.closes_at ? cairoInput(selected.closes_at) : "",
    questions,
  };
  return (
    <>
      <PageHeading
        title={assessment.title}
        description={
          selected.published_at
            ? "الإصدار المنشور ثابت. حفظ التعديلات أدناه ينشئ إصدارًا جديدًا؛ نتائج الطلاب القديمة محفوظة."
            : "راجع المسودة والأسئلة والإجابة الصحيحة، وبعدها انشر التقييم."
        }
      />
      <div className="button-row">
        <Link
          className="button secondary"
          href={
            standalone
              ? "/admin/assessments"
              : `/admin/courses/${assessment.course_id}`
          }
        >
          {standalone ? "كل الواجبات والامتحانات" : "الرجوع للكورس"}
        </Link>
        {versions.map((v) => (
          <Link
            key={v.id}
            className="button secondary small"
            href={`/admin/assessments/${id}?version=${v.id}`}
          >
            إصدار {v.version_number} · {v.published_at ? "منشور" : "مسودة"}
          </Link>
        ))}
      </div>
      {standalone && (
        <p className="status-message">
          {assessment.kind === "homework" ? "واجب مستقل" : "امتحان مستقل"} ·{" "}
          {assessment.grade_name} · {assessment.subject_name} ·{" "}
          {assessment.deleted_at
            ? "محذوف من العرض"
            : assessment.status === "archived"
              ? "مؤرشف"
              : assessment.status === "published"
                ? "منشور"
                : "مسودة"}
        </p>
      )}
      {editable && !selected.published_at && (
        <section className="workspace-panel page-section">
          <h2>نشر الإصدار {selected.version_number}</h2>
          <MutationForm
            endpoint="/api/admin/assessment-publish"
            fields={[]}
            body={{ versionId: selected.id }}
            label="نشر التقييم"
            confirmMessage="تأكيد نشر التقييم؟ الأسئلة وإعدادات هذا الإصدار تصبح ثابتة بعد النشر."
          />
        </section>
      )}
      {editable ? (
        <section className="workspace-panel page-section">
          <h2>
            {selected.published_at ? "إنشاء إصدار جديد" : "تحرير المسودة"}
          </h2>
          <AssessmentEditor
            key={selected.id}
            initial={initial}
            references={references}
          />
        </section>
      ) : (
        <section className="workspace-panel page-section">
          <h2>مراجعة الأسئلة</h2>
          <p className="muted">
            التقييم محذوف أو مؤرشف؛ الأسئلة والنتائج محفوظة للمراجعة.
          </p>
          <div className="admin-list">
            {questions.map((question, index) => (
              <article key={question.uid}>
                <h3>
                  {index + 1}. {question.prompt}
                </h3>
                <p>الإجابة الصحيحة: {question.options[question.correct]}</p>
                {question.explanation && (
                  <p className="muted">{question.explanation}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="workspace-panel page-section">
        <h2>المحاولات والنتائج الأخيرة</h2>
        <p className="muted">
          آخر ١٠٠ محاولة لهذا التقييم. كل محاولة تحتفظ بإصدارها.
        </p>
        {attempts.length ? (
          <div className="admin-table-wrap">
            <table
              className="admin-table"
              aria-label="محاولات التقييم ونتائجها"
            >
              <thead>
                <tr>
                  <th scope="col">الطالب</th>
                  <th scope="col">المحاولة</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">النتيجة</th>
                  <th scope="col">الوقت</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td data-label="الطالب">
                      <Link
                        href={`/admin/students/${attempt.student_id}`}
                        className="text-link"
                      >
                        {attempt.full_name}
                      </Link>
                    </td>
                    <td data-label="المحاولة">{attempt.attempt_number}</td>
                    <td data-label="الحالة">
                      {attempt.status === "submitted" ? "تم التسليم" : "جارية"}
                    </td>
                    <td data-label="النتيجة">
                      {attempt.possible_points
                        ? `${arabicNumber(Number(attempt.earned_points))} / ${arabicNumber(Number(attempt.possible_points))} · ${attempt.passed ? "ناجح" : "يحتاج تدريب"}`
                        : "لم تُسلّم بعد"}
                    </td>
                    <td data-label="الوقت">
                      {cairoDate(attempt.submitted_at ?? attempt.started_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">لسه مفيش محاولات للتقييم ده.</p>
        )}
      </section>
      <section className="workspace-panel page-section">
        <h2>إجراءات التقييم</h2>
        {standalone &&
          !assessment.deleted_at &&
          assessment.status === "published" && (
            <MutationForm
              endpoint="/api/admin/assessment-archive"
              fields={[]}
              body={{ id }}
              label="أرشفة التقييم المستقل"
              confirmMessage="أرشفة التقييم توقف المحاولات الجديدة وتحفظ المحاولات الجارية والنتائج. تأكيد الأرشفة؟"
            />
          )}
        <MutationForm
          endpoint={`/api/admin/assessment-${assessment.deleted_at ? "restore" : "delete"}`}
          fields={[]}
          body={{ id, confirm: true }}
          label={assessment.deleted_at ? "استعادة التقييم" : "حذف التقييم"}
          variant={assessment.deleted_at ? "secondary" : "danger"}
          confirmMessage={
            assessment.deleted_at
              ? "استعادة ظهور التقييم حسب حالته السابقة؟"
              : "حذف التقييم؟ المسودة غير المنشورة بلا محاولات تُحذف نهائيًا، والتقييم المنشور أو المستخدم يُخفى مع حفظ المحاولات والنتائج."
          }
          navigate
        />
      </section>
    </>
  );
}
