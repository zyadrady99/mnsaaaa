import Image from "next/image";
import Link from "next/link";
import Form from "next/form";
import {
  ArrowLeft,
  ArrowUpLeft,
  BookOpen,
  ChalkboardTeacher,
  MagnifyingGlass,
  Ticket,
  Atom,
  Flask,
  Calculator,
  TextAa,
} from "@phosphor-icons/react/dist/ssr";
import { CourseCard, TeacherCard } from "@/components/cards";
import { publicCatalog, referenceData } from "@/server/catalog";
const subjectIcons: Record<string, typeof BookOpen> = {
  physics: Atom,
  chemistry: Flask,
  math: Calculator,
  arabic: TextAa,
};

export default async function Home() {
  const [catalog, refs] = await Promise.all([publicCatalog(), referenceData()]);
  const { courses, teachers } = catalog;
  const subjects = refs.subjects
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.slug, label: s.name }));
  return (
    <>
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">بداية جديدة، خطوة أوضح</p>
          <h1 id="hero-title">
            مذاكرتك،
            <br />
            <span>خطوة بخطوة.</span>
          </h1>
          <p className="hero-description">
            اختار مدرسك، افهم درسك، واتدرّب عليه.
            <br className="desktop-break" /> كل اللي محتاجه للمذاكرة في مكان
            واحد.
          </p>
          <Link href="/courses" className="button primary">
            استكشف الكورسات
            <ArrowLeft size={21} aria-hidden="true" />
          </Link>
          <div className="hero-footnote">
            <BookOpen size={18} aria-hidden="true" />
            للصفوف الأول والثاني والثالث الثانوي
          </div>
        </div>
        <div className="hero-art">
          <Image
            src="/images/study-scene.svg"
            alt="رسم لمكتب مذاكرة عليه كتب وكراسة ونبتة"
            width={600}
            height={430}
            preload
            sizes="(max-width: 767px) 90vw, 45vw"
          />
        </div>
      </section>
      <section className="discovery-bar" aria-label="اختار نقطة البداية">
        <Form action="/courses" className="home-search">
          <label className="sr-only" htmlFor="home-q">
            ابحث عن كورس أو مدرس
          </label>
          <MagnifyingGlass size={23} aria-hidden="true" />
          <input
            id="home-q"
            name="q"
            type="search"
            placeholder="بتدوّر على إيه؟ اسم كورس أو مدرس"
            maxLength={100}
          />
          <button className="button secondary small" type="submit">
            بحث
          </button>
        </Form>
        <Link href="/teachers" className="quick-link">
          <ChalkboardTeacher size={24} aria-hidden="true" />
          <span>اختار مدرسك</span>
          <ArrowUpLeft size={20} aria-hidden="true" />
        </Link>
        <Link href="/my-courses#activate" className="quick-link">
          <Ticket size={24} aria-hidden="true" />
          <span>معاك كود كورس؟</span>
          <ArrowUpLeft size={20} aria-hidden="true" />
        </Link>
      </section>
      <section className="page-section" aria-labelledby="subjects-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ابدأ بالمادة</p>
            <h2 id="subjects-title">ناوي تذاكر إيه النهارده؟</h2>
          </div>
        </div>
        <div className="subject-grid">
          {subjects.map((subject) => {
            const SubjectIcon = subjectIcons[subject.id] ?? BookOpen;
            return (
              <Link
                key={subject.id}
                href={`/courses?subject=${subject.id}`}
                className={`subject-link theme-${subject.id}`}
              >
                <span className="subject-symbol" aria-hidden="true">
                  <SubjectIcon size={26} aria-hidden="true" />
                </span>
                <span>{subject.label}</span>
                <ArrowUpLeft size={22} aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      </section>
      <section className="page-section" aria-labelledby="teachers-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">الفهم بيبدأ مع مدرسك</p>
            <h2 id="teachers-title">اتعرّف على المدرسين</h2>
          </div>
          <Link href="/teachers" className="text-link">
            كل المدرسين
            <ArrowLeft size={19} aria-hidden="true" />
          </Link>
        </div>
        <div className="teacher-grid">
          {teachers.map((teacher) => (
            <TeacherCard key={teacher.slug} teacher={teacher} />
          ))}
        </div>
      </section>
      <section className="page-section" aria-labelledby="courses-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">اختار خطوتك الجاية</p>
            <h2 id="courses-title">كورسات تقدر تبدأ بيها</h2>
          </div>
          <Link href="/courses" className="text-link">
            كل الكورسات
            <ArrowLeft size={19} aria-hidden="true" />
          </Link>
        </div>
        <div className="course-grid">
          {courses.slice(0, 3).map((course) => (
            <CourseCard key={course.slug} course={course} />
          ))}
        </div>
      </section>
    </>
  );
}
