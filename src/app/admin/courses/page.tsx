import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
const statusNames: Record<string, string> = {
  draft: "مسودة",
  published: "منشور",
  archived: "مؤرشف",
};
export const metadata = { title: "إدارة الكورسات" };
export default async function CoursesAdmin() {
  await requireAccount("admin");
  const courses = (
    await database()
      .query(`select c.id,c.title,c.status,t.name as teacher_name,g.name as grade_name,
    (select count(*)::int from app_private.lessons l where l.course_id=c.id) as lessons
    from app_private.courses c join app_private.teachers t on t.id=c.teacher_id join app_private.grades g on g.id=c.grade_id order by c.title`)
  ).rows;
  return (
    <>
      <PageHeading
        eyebrow="إدارة المحتوى"
        title="الكورسات"
        description="جهّز المسودة ودروسها، وبعد المراجعة انشرها للطلاب."
      />
      <Link href="/admin/courses/new" className="button primary">
        إضافة كورس
      </Link>
      <div className="admin-list">
        {courses.map((course) => (
          <Link
            className="workspace-panel admin-list-row"
            href={`/admin/courses/${course.id}`}
            key={course.id}
          >
            <div>
              <h2>{course.title}</h2>
              <p className="muted">
                أ. {course.teacher_name} · {course.grade_name} ·{" "}
                {course.lessons} دروس
              </p>
            </div>
            <span className="chip neutral">{statusNames[course.status]}</span>
            <span className="text-link">إدارة الكورس ←</span>
          </Link>
        ))}
      </div>
    </>
  );
}
