import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/common/page-heading";
import { AttemptRunner } from "@/components/assessments/attempt-runner";
import { readAttempt } from "@/server/assessments/service";
import { requireAccount, requestToken } from "@/server/auth/service";
import { AppError } from "@/server/core/errors";
export const metadata = { title: "حل التقييم" };
export default async function AttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccount("student");
  let data;
  try {
    data = await readAttempt((await params).id, await requestToken());
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <>
        <PageHeading title="المحاولة غير متاحة" description={error.message} />
        <Link className="button primary" href="/my-courses">
          كورساتي
        </Link>
      </>
    );
  }
  if (data.submitted) redirect(data.next);
  return (
    <>
      <PageHeading
        title={data.title}
        description={`المحاولة ${data.attemptNumber} · الإجابات تتحفظ تلقائيًا بعد تأكيد السيرفر.`}
      />
      <AttemptRunner
        attemptId={data.id}
        studentId={data.studentId}
        questions={data.questions}
        remainingMs={data.remainingMs}
        kind={data.kind}
      />
    </>
  );
}
