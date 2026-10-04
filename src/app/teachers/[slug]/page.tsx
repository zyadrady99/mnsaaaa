import type { Metadata } from "next";
import { CatalogImage } from "@/components/catalog/catalog-image";
import { notFound } from "next/navigation";
import { BookOpen, Check } from "@phosphor-icons/react/dist/ssr";
import { CourseCard } from "@/components/catalog/cards";
import { Breadcrumbs } from "@/components/common/page-heading";
import { arabicNumber, gradeLabel, subjectLabel } from "@/lib/catalog";
import { getPublicTeacher, publicCatalog } from "@/server/catalog/queries";

type Props = { params: Promise<{ slug: string }> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const teacher = await getPublicTeacher((await params).slug);
  return { title: teacher ? `أ. ${teacher.name}` : "المدرس غير موجود" };
}
export default async function TeacherPage({ params }: Props) {
  const teacher = await getPublicTeacher((await params).slug);
  if (!teacher) notFound();
  const available = (await publicCatalog()).courses.filter(
    (course) => course.teacherSlug === teacher.slug,
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "المدرسون", href: "/teachers" },
          { label: `أ. ${teacher.name}` },
        ]}
      />
      <section className="teacher-profile">
        <div className={`profile-portrait theme-${teacher.subject}`}>
          <CatalogImage
            src={teacher.portrait}
            kind="teacher"
            alt={`صورة المدرس ${teacher.name}`}
            width={400}
            height={400}
            preload
          />
        </div>
        <div className="profile-copy">
          <p className="eyebrow">
            {teacher.subjectName ?? subjectLabel(teacher.subject)}
          </p>
          <h1>أ. {teacher.name}</h1>
          <p className="muted">
            {(teacher.gradeNames ?? teacher.grades.map(gradeLabel)).join(" · ")}
          </p>
          <p className="profile-description">{teacher.description}</p>
          <span className="inline-meta">
            <BookOpen size={21} aria-hidden="true" />
            {arabicNumber(available.length)} كورسات متاحة
          </span>
        </div>
      </section>
      <section className="page-section">
        <div className="section-heading">
          <h2>كورسات المدرس</h2>
        </div>
        <div className="course-grid">
          {available.map((course) => (
            <CourseCard key={course.slug} course={course} />
          ))}
        </div>
      </section>
      <section className="approach-panel">
        <h2>طريقة التعلّم</h2>
        <ul>
          {teacher.approach.map((item) => (
            <li key={item}>
              <Check size={21} aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
