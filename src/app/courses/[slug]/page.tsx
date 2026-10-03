import type { Metadata } from "next";
import { CatalogImage } from "@/components/catalog-image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CaretDown,
  Check,
  Clock,
  LockSimple,
  PlayCircle,
  Ticket,
} from "@phosphor-icons/react/dist/ssr";
import { Breadcrumbs } from "@/components/page-heading";
import {
  arabicNumber,
  courseMinutes,
  gradeLabel,
  lessonCount,
  subjectLabel,
} from "@/lib/catalog";
import { getPublishedCourse } from "@/server/catalog";
import { currentAccount } from "@/server/auth";
import { database } from "@/server/db";

type Props = { params: Promise<{ slug: string }> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const course = await getPublishedCourse((await params).slug);
  return { title: course?.title || "الكورس غير موجود" };
}
export default async function CoursePage({ params }: Props) {
  const course = await getPublishedCourse((await params).slug);
  if (!course) notFound();
  const teacher = course.teacher!;
  const minutes = courseMinutes(course);
  const account = await currentAccount();
  const access =
    account?.role === "student"
      ? (
          await database().query(
            "select access_until>clock_timestamp() and withdrawn_at is null as active from app_private.course_access where student_id=$1 and course_id=$2",
            [account.id, course.id],
          )
        ).rows[0]
      : null;
  const next =
    account?.role === "admin"
      ? `/admin/courses/${course.id}`
      : access?.active
        ? `/learn/${course.id}`
        : account
          ? "/my-courses#activate"
          : `/login?next=${encodeURIComponent(`/courses/${course.slug}`)}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "الكورسات", href: "/courses" },
          { label: course.title },
        ]}
      />
      <div className="course-detail-layout">
        <header className="course-heading">
          <div className="chip-row">
            <span className="chip">
              {course.subjectName ?? subjectLabel(course.subject)}
            </span>
            <span className="chip neutral">
              {course.gradeName ?? gradeLabel(course.grade)}
            </span>
          </div>
          <h1>{course.title}</h1>
          <p className="muted">{course.subtitle}</p>
          <Link
            href={`/teachers/${teacher.slug}`}
            className="teacher-byline detail-byline"
          >
            <CatalogImage
              src={teacher.portrait}
              kind="teacher"
              alt=""
              width={40}
              height={40}
              compact
            />
            <span>أ. {teacher.name}</span>
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
          <div className="course-facts">
            <span>
              <PlayCircle size={20} aria-hidden="true" />
              {arabicNumber(lessonCount(course))} دروس
            </span>
            <span>
              <BookOpen size={20} aria-hidden="true" />
              {arabicNumber(course.units.length)} وحدات
            </span>
            <span>
              <Clock size={20} aria-hidden="true" />
              {arabicNumber(Math.floor(minutes / 60))} س و
              {arabicNumber(minutes % 60)} د
            </span>
          </div>
        </header>
        <aside className="enrollment-card">
          <div className={`enrollment-cover theme-${course.subject}`}>
            <CatalogImage
              src={course.cover}
              kind="course"
              alt=""
              width={640}
              height={360}
              preload
            />
          </div>
          <div className="enrollment-body">
            <p className="eyebrow">ابدأ بكود من السنتر</p>
            <h2>
              خطوتك الجاية في{" "}
              {course.subjectName ?? subjectLabel(course.subject)}
            </h2>
            <p className="muted">
              الكود مرتبط بالكورس ده، ومدته تبدأ وقت التفعيل.
            </p>
            <Link className="button primary full" href={next}>
              {account?.role === "admin"
                ? "إدارة الكورس"
                : access?.active
                  ? "ابدأ التعلّم"
                  : account
                    ? "تفعيل كود الكورس"
                    : "دخول لتفعيل الكورس"}
              <ArrowLeft size={19} aria-hidden="true" />
            </Link>
            <Link className="text-link" href="/help#codes">
              <Ticket size={20} aria-hidden="true" />
              إزاي أحصل على كود؟
            </Link>
          </div>
        </aside>
        <div className="course-detail-main">
          <section className="outcomes">
            <h2>هتتعلم إيه؟</h2>
            <ul>
              {course.outcomes.map((outcome) => (
                <li key={outcome}>
                  <Check size={21} aria-hidden="true" />
                  <span>{outcome}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="curriculum">
            <div className="section-heading">
              <h2>محتوى الكورس</h2>
              <span className="muted">
                {arabicNumber(lessonCount(course))} دروس
              </span>
            </div>
            <p className="curriculum-note">
              <LockSimple size={18} aria-hidden="true" />
              عناوين الدروس للمعاينة. المشاهدة بتحتاج تفعيل الكورس.
            </p>
            <div className="unit-list">
              {course.units.map((unit, index) => (
                <details className="unit" key={unit.title} open={index === 0}>
                  <summary>
                    <span className="unit-number">
                      {arabicNumber(index + 1).padStart(2, "٠")}
                    </span>
                    <span className="unit-title">
                      <strong>{unit.title}</strong>
                      <span>{arabicNumber(unit.lessons.length)} دروس</span>
                    </span>
                    <CaretDown size={20} aria-hidden="true" />
                  </summary>
                  <ol>
                    {unit.lessons.map((lesson, i) => (
                      <li key={lesson.title}>
                        <span className="lesson-number">
                          {arabicNumber(i + 1)}
                        </span>
                        <span className="lesson-title">
                          {lesson.title}
                          <span>يتاح بعد التفعيل</span>
                        </span>
                        <span className="lesson-duration">
                          {arabicNumber(lesson.minutes)} د
                        </span>
                        <LockSimple size={19} aria-label="مقفل حتى التفعيل" />
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
