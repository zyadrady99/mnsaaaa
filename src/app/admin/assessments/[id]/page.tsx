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
import { cairoInput } from "@/lib/time";
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
      "select * from app_private.assessments where id=$1",
      [id],
    )
  ).rows[0];
  if (!assessment) notFound();
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
          href={`/admin/courses/${assessment.course_id}`}
        >
          الرجوع للكورس
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
      {!selected.published_at && (
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
      <section className="workspace-panel page-section">
        <h2>{selected.published_at ? "إنشاء إصدار جديد" : "تحرير المسودة"}</h2>
        <AssessmentEditor key={selected.id} initial={initial} />
      </section>
    </>
  );
}
