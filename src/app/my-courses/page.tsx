import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs, PageHeading } from "@/components/page-heading";
import { ActivateCourse } from "@/components/activate-course";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { cairoDate } from "@/lib/time";
export const metadata: Metadata = { title: "كورساتي" };
export default async function MyCourses() {
  const account = await requireAccount();
  if (account.role === "admin") redirect("/admin");
  const courses = (
    await database().query(
      `select c.id,c.title,c.status,t.name as teacher_name,a.access_until,a.withdrawn_at,a.access_until>clock_timestamp() as active,
    (select count(*)::int from app_private.lessons l where l.course_id=c.id and l.published_at is not null) as total,
    (select count(*)::int from app_private.lesson_progress p join app_private.lessons l on l.id=p.lesson_id where p.student_id=a.student_id and l.course_id=c.id and l.published_at is not null and p.completed_at is not null) as completed
    from app_private.course_access a join app_private.courses c on c.id=a.course_id join app_private.teachers t on t.id=c.teacher_id
    where a.student_id=$1 and c.status in ('published','archived') order by a.started_at desc`,
      [account.id],
    )
  ).rows;
  return (
    <>
      <Breadcrumbs items={[{ label: "كورساتي" }]} />
      <PageHeading
        eyebrow="مكانك للمذاكرة"
        title="كورساتك، وتقدّمك محفوظ"
        description="فعّل كودك، وكمّل من آخر خطوة وصلت لها."
      />
      <ActivateCourse />
      <section className="page-section">
        <h2>كورساتي</h2>
        <div className="admin-list">
          {courses.map((course) => (
            <article className="workspace-panel" key={course.id}>
              <div className="admin-list-row">
                <div>
                  <h3>{course.title}</h3>
                  <p className="teacher-byline">أ. {course.teacher_name}</p>
                </div>
                <span className="chip neutral">
                  {course.withdrawn_at
                    ? "الوصول مسحوب"
                    : course.active
                      ? "نشط"
                      : "انتهت المدة"}
                </span>
              </div>
              <p className="muted">
                {course.withdrawn_at
                  ? "كود جديد صالح يفتح مدة جديدة لو الكورس منشور."
                  : "الوصول حتى " + cairoDate(course.access_until)}
              </p>
              <p>
                {course.completed} من {course.total} دروس مكتملة
              </p>
              <progress
                value={course.completed}
                max={course.total || 1}
                aria-label="تقدم إكمال الدروس"
              />
              <Link className="button primary" href={"/learn/" + course.id}>
                {course.active && !course.withdrawn_at
                  ? "كمّل المذاكرة"
                  : "عرض التقدم والنتائج"}
              </Link>
            </article>
          ))}
        </div>
        {!courses.length && (
          <div className="workspace-panel page-section">
            <h3>لسه مفيش كورسات مفعّلة</h3>
            <p className="muted">
              اكتب كود السنتر بالأعلى، أو استكشف الكورسات المتاحة.
            </p>
            <Link className="button secondary" href="/courses">
              استكشف الكورسات
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
