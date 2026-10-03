import { notFound } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { AssessmentEditor } from "@/components/assessment-editor";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { validUuid } from "@/lib/auth-input";
export const metadata = { title: "إضافة تقييم" };
export default async function NewAssessment({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccount("admin");
  const query = await searchParams;
  if (
    !validUuid(query.course) ||
    (query.kind !== "homework" && query.kind !== "exam") ||
    (query.kind === "homework" && !validUuid(query.lesson))
  )
    notFound();
  const course = (
    await database().query(
      "select title from app_private.courses where id=$1",
      [query.course],
    )
  ).rows[0];
  if (!course) notFound();
  return (
    <>
      <PageHeading
        title={query.kind === "homework" ? "إضافة واجب" : "إضافة امتحان"}
        description={course.title}
      />
      <section className="workspace-panel">
        <AssessmentEditor
          initial={{
            courseId: query.course,
            kind: query.kind,
            lessonId:
              query.kind === "homework" ? (query.lesson as string) : undefined,
            title: "",
            durationMinutes: 30,
            maxAttempts: 1,
            passPercent: 70,
            opensAt: "",
            closesAt: "",
            questions: [],
          }}
        />
      </section>
    </>
  );
}
