import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { AssessmentEditor } from "@/components/assessment-editor";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { validUuid } from "@/lib/auth-input";
import { referenceData } from "@/server/catalog";
export const metadata = { title: "إضافة تقييم" };
export default async function NewAssessment({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccount("admin");
  const query = await searchParams;
  if (!query.course) {
    if (query.scope && query.scope !== "standalone") notFound();
    if (query.kind !== "homework" && query.kind !== "exam") {
      return (
        <>
          <PageHeading
            title="إضافة واجب أو امتحان مستقل"
            description="اختار نوع التقييم، وحدد صفه ومادته، وبعدها جهّز الأسئلة."
          />
          <div className="button-row">
            <Link
              href="/admin/assessments/new?scope=standalone&kind=homework"
              className="button primary"
            >
              إضافة واجب مستقل
            </Link>
            <Link
              href="/admin/assessments/new?scope=standalone&kind=exam"
              className="button secondary"
            >
              إضافة امتحان مستقل
            </Link>
          </div>
        </>
      );
    }
    const refs = await referenceData();
    return (
      <>
        <PageHeading
          title={
            query.kind === "homework"
              ? "إضافة واجب مستقل"
              : "إضافة امتحان مستقل"
          }
          description="يظهر على المنصة لطلاب الصف المحدد، ولا يحتاج اشتراكًا في كورس."
        />
        <Link href="/admin/assessments" className="text-link">
          كل الواجبات والامتحانات ←
        </Link>
        <section className="workspace-panel page-section">
          <AssessmentEditor
            references={{
              grades: refs.grades.filter((g) => g.enabled),
              subjects: refs.subjects.filter((s) => s.enabled),
            }}
            initial={{
              scope: "standalone",
              kind: query.kind,
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
  if (query.scope && query.scope !== "course") notFound();
  if (
    !validUuid(query.course) ||
    (query.kind !== "homework" && query.kind !== "exam") ||
    (query.kind === "homework" && !validUuid(query.lesson))
  )
    notFound();
  const course = (
    await database().query(
      "select title from app_private.courses where id=$1 and deleted_at is null and status<>'archived'",
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
            scope: "course",
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
