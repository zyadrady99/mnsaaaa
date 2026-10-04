import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { CatalogImage } from "@/components/catalog/catalog-image";
import { Breadcrumbs, PageHeading } from "@/components/common/page-heading";
import { ActivateCourse } from "@/components/enrollments/activate-course";
import { requireAccount } from "@/server/auth/service";
import { database } from "@/server/core/db";
import { cairoDate } from "@/lib/time";
import { arabicNumber } from "@/lib/catalog";
export const metadata: Metadata = { title: "كورساتي" };
export default async function MyCourses() {
  const account = await requireAccount();
  if (account.role === "admin") redirect("/admin");
  const courses = (
    await database().query(
      `select c.id,c.title,c.status,c.cover_ref,t.name as teacher_name,a.access_until,a.withdrawn_at,a.access_until>clock_timestamp() as active,
    (select count(*)::int from app_private.lessons l join app_private.course_units u on u.id=l.unit_id where l.course_id=c.id and l.published_at is not null and l.deleted_at is null and u.deleted_at is null) as total,
    (select count(*)::int from app_private.lesson_progress p join app_private.lessons l on l.id=p.lesson_id join app_private.course_units u on u.id=l.unit_id where p.student_id=a.student_id and l.course_id=c.id and l.published_at is not null and l.deleted_at is null and u.deleted_at is null and p.completed_at is not null) as completed
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
        <div className="library-course-grid">
          {courses.map((course) => (
            <article
              className="workspace-panel library-course-card"
              key={course.id}
            >
              <Link
                className="library-course-cover"
                href={"/learn/" + course.id}
                aria-label={`افتح ${course.title}`}
              >
                <CatalogImage
                  src={course.cover_ref ?? ""}
                  kind="course"
                  width={600}
                  height={338}
                  sizes="(max-width: 680px) 100vw, (max-width: 1000px) 50vw, 33vw"
                />
              </Link>
              <div className="library-course-body">
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
                <div className="library-progress-label">
                  <span>
                    {arabicNumber(course.completed)} من{" "}
                    {arabicNumber(course.total)} دروس مكتملة
                  </span>
                  <strong>
                    {arabicNumber(
                      course.total
                        ? Math.round((course.completed / course.total) * 100)
                        : 0,
                    )}
                    ٪
                  </strong>
                </div>
                <progress
                  value={course.completed}
                  max={course.total || 1}
                  aria-label={`تقدم إكمال دروس ${course.title}`}
                />
                <Link className="button primary" href={"/learn/" + course.id}>
                  {course.active && !course.withdrawn_at
                    ? "كمّل المذاكرة"
                    : "عرض التقدم والنتائج"}
                  <ArrowLeft size={20} aria-hidden="true" />
                </Link>
              </div>
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
