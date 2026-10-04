import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading, Breadcrumbs } from "@/components/common/page-heading";
import { LessonPlayer } from "@/components/learning/lesson-player";
import { requireAccount } from "@/server/auth/service";
import { database } from "@/server/core/db";
import { validUuid } from "@/lib/auth-input";
import { cairoDate } from "@/lib/time";
export const metadata = { title: "المذاكرة" };
export default async function LearnCourse({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await requireAccount("student"),
    { id } = await params;
  if (!validUuid(id)) notFound();
  const query = await searchParams;
  const course = (
    await database().query(
      `select c.id,c.title,c.status,a.access_until,a.withdrawn_at,a.access_until>clock_timestamp() as active from app_private.courses c join app_private.course_access a on a.course_id=c.id and a.student_id=$2 where c.id=$1 and c.status in ('published','archived')`,
      [id, account.id],
    )
  ).rows[0];
  if (!course) notFound();
  const [lessons, results, exams] = await Promise.all([
    database().query(
      `select l.id,l.title,l.position,u.title as unit_title,p.completed_at,p.position_seconds,p.revision,
      a.id as homework_id,hp.passed_at,exists(select 1 from app_private.gate_overrides where student_id=$2 and lesson_id=l.id) as overridden
      from app_private.lessons l join app_private.course_units u on u.id=l.unit_id
      left join app_private.lesson_progress p on p.lesson_id=l.id and p.student_id=$2
      left join app_private.assessments a on a.lesson_id=l.id and a.kind='homework'
      left join app_private.homework_passes hp on hp.assessment_id=a.id and hp.student_id=$2 where l.course_id=$1 and l.published_at is not null order by l.position`,
      [id, account.id],
    ),
    database().query(
      `select t.id,t.status,t.deadline_at,a.title,r.earned_points,r.possible_points,r.passed from app_private.attempts t join app_private.assessments a on a.id=t.assessment_id left join app_private.attempt_results r on r.attempt_id=t.id where t.student_id=$2 and t.course_id=$1 order by t.started_at desc limit 50`,
      [id, account.id],
    ),
    database().query(
      "select a.id,a.title from app_private.assessments a join app_private.assessment_versions v on v.id=a.current_version_id where a.course_id=$1 and a.kind='exam' and v.published_at is not null and (v.closes_at is null or v.closes_at>clock_timestamp()) order by a.title",
      [id],
    ),
  ]);
  const rows = lessons.rows.map((lesson, index) => ({
    ...lesson,
    open:
      index === 0 ||
      lesson.overridden ||
      Boolean(
        lessons.rows[index - 1].completed_at &&
        lessons.rows[index - 1].passed_at,
      ),
  }));
  const active = course.active && !course.withdrawn_at,
    selected =
      typeof query.lesson === "string"
        ? rows.find((l) => l.id === query.lesson)
        : (rows.find((l) => l.open && !l.completed_at) ?? rows[0]);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "كورساتي", href: "/my-courses" },
          { label: course.title },
        ]}
      />
      <PageHeading
        title={course.title}
        description={
          active
            ? "علّم الدرس كمكتمل ونجّح في واجبه علشان تفتح الخطوة اللي بعدها."
            : "تقدّمك ونتائجك محفوظين. مشاهدة الدروس والمحاولات الجديدة تحتاج وصولًا ساريًا."
        }
      />
      <p className="muted">
        {course.withdrawn_at
          ? "الوصول مسحوب"
          : `الوصول حتى ${cairoDate(course.access_until)}`}
      </p>
      <div className="learning-layout page-section">
        <nav
          className="workspace-panel curriculum-nav"
          aria-label="دروس الكورس"
        >
          <h2>الدروس</h2>
          {rows.map((lesson) => (
            <Link
              key={lesson.id}
              href={`/learn/${id}?lesson=${lesson.id}`}
              className={`curriculum-item${selected?.id === lesson.id ? " selected" : ""}`}
              aria-current={selected?.id === lesson.id ? "page" : undefined}
            >
              <strong>
                {lesson.position}. {lesson.title}
              </strong>
              <span className="muted">
                {lesson.completed_at ? "مكتمل" : lesson.open ? "متاح" : "مقفل"}{" "}
                · {lesson.passed_at ? "الواجب ناجح" : ""}
              </span>
            </Link>
          ))}
        </nav>
        <div>
          {selected && (
            <>
              <div className="section-heading">
                <h2>{selected.title}</h2>
                <span className="muted">{selected.unit_title}</span>
              </div>
              {active && selected.open ? (
                <>
                  <LessonPlayer
                    key={selected.id}
                    lessonId={selected.id}
                    initialPosition={Number(selected.position_seconds ?? 0)}
                    initialRevision={Number(selected.revision ?? 0)}
                  />
                  {selected.homework_id && (
                    <Link
                      className="button primary"
                      href={`/assessments/${selected.homework_id}`}
                    >
                      حل واجب الدرس
                    </Link>
                  )}
                </>
              ) : (
                <div className="workspace-panel">
                  <p>
                    {!active
                      ? "جدّد الوصول بكود صالح علشان تكمل المذاكرة."
                      : "كمّل الدرس السابق ونجّح في واجبه بنسبة ٧٠٪ أو أكتر."}
                  </p>
                  <Link
                    className="button secondary"
                    href="/my-courses#activate"
                  >
                    كورساتي وتفعيل كود
                  </Link>
                </div>
              )}
            </>
          )}
          {active && exams.rows.length > 0 && (
            <section className="workspace-panel page-section">
              <h2>الامتحانات</h2>
              <div className="button-row">
                {exams.rows.map((exam) => (
                  <Link
                    className="button secondary"
                    key={exam.id}
                    href={`/assessments/${exam.id}`}
                  >
                    {exam.title}
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className="workspace-panel page-section">
            <h2>محاولاتك ونتائجك</h2>
            {results.rows.length ? (
              <div className="admin-list">
                {results.rows.map((result) => (
                  <Link
                    className="result-row"
                    key={result.id}
                    href={`/${result.status === "submitted" ? "results" : "attempts"}/${result.id}`}
                  >
                    <strong>{result.title}</strong>
                    <span>
                      {result.status === "submitted"
                        ? `${result.earned_points} / ${result.possible_points} · ${result.passed ? "ناجح" : "يحتاج تدريب"}`
                        : "محاولة جارية"}
                    </span>
                    {result.deadline_at && result.status !== "submitted" && (
                      <span className="muted">
                        حتى {cairoDate(result.deadline_at)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted">
                ابدأ واجبًا أو امتحانًا، وهتظهر محاولاتك هنا.
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
