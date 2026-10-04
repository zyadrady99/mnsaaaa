import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  PencilSimple,
} from "@phosphor-icons/react/dist/ssr";
import { CourseCard, TeacherCard } from "@/components/catalog/cards";
import { HomeContinue } from "@/components/catalog/home-continue";
import { HomeCourseExplorer } from "@/components/catalog/home-course-explorer";
import { HomeGradePicker } from "@/components/catalog/home-grade-picker";
import { currentAccount } from "@/server/auth/service";
import {
  catalogQuery,
  publicCatalog,
  referenceData,
} from "@/server/catalog/queries";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [catalog, refs, account, params] = await Promise.all([
    publicCatalog(),
    referenceData(),
    currentAccount(),
    searchParams,
  ]);
  const query = await catalogQuery(params);
  const student = account?.role === "student";
  const grades = refs.grades
    .filter((grade) => grade.enabled)
    .map((grade) => ({ id: grade.slug, label: grade.name }));
  const subjects = refs.subjects
    .filter((subject) => subject.enabled)
    .map((subject) => ({ id: subject.slug, label: subject.name }));
  const courses = catalog.courses.map((course) => ({
    slug: course.slug,
    grade: course.grade,
    subject: course.subject,
    searchText: `${course.title} ${course.teacher?.name ?? ""} ${course.subjectName ?? ""}`,
    card: <CourseCard course={course} />,
  }));

  return (
    <div className={`student-refresh${student ? " student-view" : ""}`}>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-line" aria-hidden="true" />
            {student ? "كل خطوة صغيرة بتفرق" : "ثانوي، وخطوتك على قدّك"}
          </p>
          <h1 id="hero-title">
            {student ? "جاهز نكمّل؟" : "كل درس،"}
            <br />
            <span className="hero-emphasis">
              {student ? "خطوة جديدة." : "خطوة لقدّام."}
            </span>
          </h1>
          <p className="hero-description">
            {student
              ? "ارجع للكورس اللي بدأته، أو اكتشف حاجة جديدة."
              : "اختار مدرسك، افهم الفكرة، واتدرّب عليها."}
            <br />
            {student
              ? "مذاكرتك كلها في مكان واحد."
              : "مذاكرتك كلها في مكان واحد، وبداية أسهل."}
          </p>
          <Link
            href={student ? "#continue-section" : "#discover"}
            className="button primary hero-cta"
          >
            {student ? "نرجع للمذاكرة" : "يلا نلاقي كورسك"}
            <ArrowLeft size={22} aria-hidden="true" />
          </Link>
          {!student && grades.length > 0 && (
            <Suspense fallback={null}>
              <HomeGradePicker grades={grades} />
            </Suspense>
          )}
        </div>
        <div className="hero-visual">
          <span className="visual-orbit orbit-one" aria-hidden="true" />
          <span className="visual-orbit orbit-two" aria-hidden="true" />
          <span className="visual-dot dot-one" aria-hidden="true" />
          <span className="visual-dot dot-two" aria-hidden="true" />
          <div className="study-illustration">
            <Image
              src="/images/study-scene.svg"
              width={600}
              height={430}
              alt="مكتب مذاكرة عليه كتب وكراسة ونبتة"
              preload
              sizes="(max-width: 680px) 80vw, 45vw"
            />
          </div>
          <span className="learning-note note-understand">
            <span className="note-icon">
              <BookOpen size={22} aria-hidden="true" />
            </span>
            <span>
              <strong>افهم الفكرة</strong>
              <small>الشرح خطوة بخطوة</small>
            </span>
          </span>
          <span className="learning-note note-practice">
            <span className="note-icon">
              <PencilSimple size={22} aria-hidden="true" />
            </span>
            <span>
              <strong>جرّب بإيدك</strong>
              <small>تدريب يثبّت اللي فهمته</small>
            </span>
          </span>
          <span className="small-note">
            <Check size={18} aria-hidden="true" />
            وخد الخطوة اللي بعدها
          </span>
        </div>
      </section>

      {student && account && <HomeContinue accountId={account.id} />}

      <Suspense
        fallback={
          <div className="workspace-panel" aria-busy="true">
            بنجهّز الكورسات المتاحة...
          </div>
        }
      >
        <HomeCourseExplorer
          key={JSON.stringify(query)}
          courses={courses}
          grades={grades}
          subjects={subjects}
        />
      </Suspense>

      <section
        className="teachers-section"
        id="teachers"
        aria-labelledby="teachers-title"
      >
        <div className="section-heading">
          <div>
            <p className="section-kicker">اختار طريقتك</p>
            <h2 id="teachers-title">مدرّس تفهم معاه.</h2>
            <p className="section-description">
              اعرف طريقته، وشوف الكورسات اللي بيشرحها.
            </p>
          </div>
          <Link href="/teachers" className="text-link">
            كل المدرسين
            <ArrowLeft size={19} aria-hidden="true" />
          </Link>
        </div>
        {catalog.teachers.length > 0 ? (
          <div className="teacher-grid">
            {catalog.teachers.map((teacher) => (
              <TeacherCard key={teacher.slug} teacher={teacher} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>لسه مفيش مدرسين متاحين.</h3>
            <p className="muted">
              لما يتضاف مدرس جديد هتلاقي صفحته وكورساته هنا.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
