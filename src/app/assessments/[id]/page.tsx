import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { MutationForm } from "@/components/mutation-form";
import { assessmentPreview } from "@/server/assessments";
import { requireAccount, requestToken } from "@/server/auth";
import { AppError } from "@/server/errors";
import { cairoDate } from "@/lib/time";
export const metadata = { title: "تعليمات التقييم" };
export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccount("student");
  let data;
  try {
    data = await assessmentPreview((await params).id, await requestToken());
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <>
        <PageHeading title="التقييم غير متاح" description={error.message} />
        <Link className="button primary" href="/my-courses">
          كورساتي
        </Link>
        <Link className="button secondary" href="/assessments">
          الواجبات والامتحانات
        </Link>
      </>
    );
  }
  const allowed =
    data.windowOpen &&
    (data.kind === "homework" || data.attemptsUsed < data.maxAttempts!);
  return (
    <>
      <PageHeading
        title={data.title}
        description={
          data.kind === "homework"
            ? "اتدرّب براحتك؛ المحاولات غير محدودة، والنجاح من ٧٠٪."
            : "راجع المدة والمحاولات قبل البدء. الوقت يستمر عند انقطاع الإنترنت."
        }
      />
      <section className="workspace-panel">
        <h2>قبل ما تبدأ</h2>
        <dl className="profile-details">
          <div>
            <dt>عدد الأسئلة</dt>
            <dd>{data.questionCount}</dd>
          </div>
          <div>
            <dt>نسبة النجاح</dt>
            <dd>{data.passPercent}٪</dd>
          </div>
          {data.kind === "exam" && (
            <>
              <div>
                <dt>المدة</dt>
                <dd>{Math.floor(data.durationSeconds! / 60)} دقيقة</dd>
              </div>
              <div>
                <dt>المحاولات</dt>
                <dd>
                  {data.attemptsUsed} مستخدمة من {data.maxAttempts}
                </dd>
              </div>
              <div>
                <dt>الوقت الموحّد</dt>
                <dd>
                  {data.opensAt ? cairoDate(data.opensAt) : "متاح الآن"} ·{" "}
                  {data.closesAt
                    ? `ينتهي ${cairoDate(data.closesAt)}`
                    : "بدون نهاية موحّدة"}
                </dd>
              </div>
            </>
          )}
        </dl>
        <p className="muted">
          الحفظ يتم بعد تأكيد السيرفر. الإجابات المكتوب عليها «على الجهاز فقط»
          لم تصل بعد، ولا تُحسب لو وقت الامتحان انتهى قبل حفظها.
        </p>
        {data.activeAttemptId ? (
          <Link
            className="button primary"
            href={`/attempts/${data.activeAttemptId}`}
          >
            كمّل المحاولة الجارية
          </Link>
        ) : allowed ? (
          <MutationForm
            endpoint="/api/attempts/start"
            body={{ assessmentId: data.id, versionId: data.versionId }}
            fields={[]}
            label={data.kind === "homework" ? "ابدأ الواجب" : "ابدأ الامتحان"}
            navigate
          />
        ) : (
          <p className="status-message">
            الامتحان خارج موعده أو محاولاتك خلصت.{" "}
            {data.scope === "standalone"
              ? "نتائجك السابقة موجودة في صفحة الواجبات والامتحانات."
              : "نتائجك السابقة موجودة في صفحة الكورس."}
          </p>
        )}
        <Link
          className="button secondary"
          href={
            data.scope === "standalone"
              ? "/assessments"
              : `/learn/${data.courseId}`
          }
        >
          {data.scope === "standalone"
            ? "الواجبات والامتحانات"
            : "الرجوع للكورس"}
        </Link>
      </section>
    </>
  );
}
