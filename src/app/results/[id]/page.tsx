import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { readResult } from "@/server/assessments";
import { requireAccount, requestToken } from "@/server/auth";
import { AppError } from "@/server/errors";
import { cairoDate } from "@/lib/time";
export const metadata = { title: "نتيجة المحاولة" };
type ModelQuestion = {
  id: string;
  position: number;
  prompt: string;
  options: { id: string; label: string }[];
  selected_option_id: string | null;
  correct_option_id: string;
  explanation: string;
};
export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccount("student");
  let result;
  try {
    result = await readResult((await params).id, await requestToken());
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <>
        <PageHeading title="النتيجة غير متاحة" description={error.message} />
        <Link className="button primary" href="/my-courses">
          كورساتي
        </Link>
      </>
    );
  }
  return (
    <>
      <PageHeading
        title={result.title}
        description={`نتيجة المحاولة ${result.attemptNumber} · ${cairoDate(result.gradedAt)}`}
      />
      <section className="workspace-panel result-summary">
        <p className="eyebrow">
          {result.passed ? "ناجح — خطوة اتقدّمتها" : "لسه محتاج تدريب"}
        </p>
        <h2>
          {result.earnedPoints} / {result.possiblePoints}
        </h2>
        <p>
          {((result.earnedPoints / result.possiblePoints) * 100).toFixed(1)}٪
        </p>
        {result.kind === "homework" && (
          <p className="muted">
            {result.passed
              ? "النجاح محفوظ. علّم الدرس كمكتمل علشان تفتح اللي بعده."
              : "تقدر تبدأ محاولة واجب جديدة وتتدرّب تاني."}
          </p>
        )}
        <Link className="button primary" href={`/learn/${result.courseId}`}>
          ارجع للكورس
        </Link>
      </section>
      {result.kind === "exam" &&
        (result.modelAvailable ? (
          <section className="page-section">
            <h2>نموذج الإجابة</h2>
            <div className="admin-list">
              {(result.model as ModelQuestion[]).map((question) => (
                <article className="workspace-panel" key={question.id}>
                  <h3>
                    {question.position}. {question.prompt}
                  </h3>
                  <p className="muted">
                    إجابتك:{" "}
                    {question.options.find(
                      (o) => o.id === question.selected_option_id,
                    )?.label ?? "بدون إجابة"}
                  </p>
                  <p>
                    الإجابة الصحيحة:{" "}
                    <strong>
                      {
                        question.options.find(
                          (o) => o.id === question.correct_option_id,
                        )?.label
                      }
                    </strong>
                  </p>
                  {question.explanation && (
                    <p className="page-section">{question.explanation}</p>
                  )}
                </article>
              ))}
            </div>
          </section>
        ) : (
          <p className="status-message">
            {result.closesAt
              ? `الصحيح والشرح يتاحوا بعد النهاية الموحّدة: ${cairoDate(result.closesAt)}.`
              : "الصحيح والشرح يتاحوا بعد استنفاد محاولاتك في الامتحان."}
          </p>
        ))}
    </>
  );
}
