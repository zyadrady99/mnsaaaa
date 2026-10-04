import Link from "next/link";
import { PageHeading } from "@/components/common/page-heading";
import { requireAccount } from "@/server/auth/service";
import { database } from "@/server/core/db";
import { arabicNumber } from "@/lib/catalog";
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
      .query(`select c.id,c.title,c.status,c.deleted_at,t.name as teacher_name,g.name as grade_name,
    (select count(*)::int from app_private.lessons l where l.course_id=c.id) as lessons
    from app_private.courses c join app_private.teachers t on t.id=c.teacher_id join app_private.grades g on g.id=c.grade_id order by c.deleted_at nulls first,c.title`)
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
      <section
        className="workspace-panel page-section"
        aria-labelledby="admin-course-list"
      >
        <div className="admin-section-heading">
          <h2 id="admin-course-list">كل الكورسات</h2>
          <span className="muted">{arabicNumber(courses.length)} كورس</span>
        </div>
        {courses.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" aria-labelledby="admin-course-list">
              <thead>
                <tr>
                  <th scope="col">الكورس</th>
                  <th scope="col">المدرس</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td data-label="الكورس">
                      <strong className="admin-table-title">
                        {course.title}
                      </strong>
                      <span className="admin-table-secondary">
                        {course.grade_name} · {arabicNumber(course.lessons)}{" "}
                        دروس
                      </span>
                    </td>
                    <td data-label="المدرس">أ. {course.teacher_name}</td>
                    <td data-label="الحالة">
                      <span
                        className="admin-status"
                        data-status={
                          course.deleted_at ? "archived" : course.status
                        }
                      >
                        {course.deleted_at
                          ? "في المحذوفات"
                          : statusNames[course.status]}
                      </span>
                    </td>
                    <td data-label="الإجراء">
                      <Link
                        href={`/admin/courses/${course.id}`}
                        className="text-link admin-table-action"
                        aria-label={`إدارة كورس ${course.title}`}
                      >
                        إدارة الكورس ←
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            لسه مفيش كورسات. أضف كورسًا وابدأ بتجهيز مسودته.
          </p>
        )}
      </section>
    </>
  );
}
