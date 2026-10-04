import { CatalogImage } from "@/components/catalog/catalog-image";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  PlayCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  type Course,
  type Teacher,
  arabicNumber,
  courseCountText,
  gradeLabel,
  lessonCount,
  subjectLabel,
} from "@/lib/catalog";

export function CourseCard({ course }: { course: Course }) {
  const teacher = course.teacher;
  return (
    <Link href={`/courses/${course.slug}`} className="course-card card-link">
      <div className={`course-cover theme-${course.subject}`}>
        <CatalogImage
          src={course.cover}
          kind="course"
          alt=""
          width={640}
          height={360}
          sizes="(max-width: 680px) calc(100vw - 36px), (max-width: 980px) 50vw, 33vw"
        />
        <span className="cover-badge">
          {course.gradeName ?? gradeLabel(course.grade)}
        </span>
      </div>
      <div className="course-card-body">
        <span className="eyebrow">
          {course.subjectName ?? subjectLabel(course.subject)}
        </span>
        <h3 className="course-card-title">{course.title}</h3>
        {course.subtitle.trim() ? (
          <p className="course-subtitle" title={course.subtitle}>
            {course.subtitle}
          </p>
        ) : null}
        {teacher ? (
          <div className="teacher-byline">
            <CatalogImage
              src={teacher.portrait}
              kind="teacher"
              alt=""
              width={38}
              height={38}
              compact
            />
            <span>أ. {teacher.name}</span>
          </div>
        ) : null}
        <div className="card-footer">
          <span>
            <PlayCircle size={19} aria-hidden="true" />
            {arabicNumber(lessonCount(course))} دروس
          </span>
          <span className="card-action">
            شوف التفاصيل
            <ArrowLeft size={18} aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}
export function TeacherCard({ teacher }: { teacher: Teacher }) {
  const grades = teacher.gradeNames ?? teacher.grades.map(gradeLabel);
  return (
    <Link href={`/teachers/${teacher.slug}`} className="teacher-card card-link">
      <div className={`teacher-portrait theme-${teacher.subject}`}>
        <CatalogImage
          src={teacher.portrait}
          kind="teacher"
          alt=""
          width={400}
          height={400}
          sizes="(max-width: 680px) 112px, (max-width: 980px) 50vw, 25vw"
        />
      </div>
      <div className="teacher-card-body">
        <h3>أ. {teacher.name}</h3>
        <p className="teacher-subject">
          {teacher.subjectName ?? subjectLabel(teacher.subject)}
        </p>
        {grades.length ? (
          <p className="teacher-grades">{grades.join(" · ")}</p>
        ) : null}
        {teacher.description.trim() ? (
          <p className="teacher-description" title={teacher.description}>
            {teacher.description}
          </p>
        ) : null}
        {teacher.courseCount !== undefined ? (
          <span className="teacher-course-count">
            <BookOpen size={18} aria-hidden="true" />
            {courseCountText(teacher.courseCount)}
          </span>
        ) : null}
        <span className="teacher-button">
          شوف كورساته
          <ArrowLeft size={18} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}
