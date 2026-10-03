import { CatalogImage } from "@/components/catalog-image";
import Link from "next/link";
import {
  ArrowUpLeft,
  BookOpen,
  PlayCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  type Course,
  type Teacher,
  arabicNumber,
  courses,
  getTeacher,
  gradeLabel,
  lessonCount,
  subjectLabel,
} from "@/lib/catalog";

export function CourseCard({ course }: { course: Course }) {
  const teacher = course.teacher ?? getTeacher(course.teacherSlug)!;
  return (
    <Link href={`/courses/${course.slug}`} className="course-card card-link">
      <div className={`course-cover theme-${course.subject}`}>
        <CatalogImage
          src={course.cover}
          kind="course"
          alt=""
          width={640}
          height={360}
          sizes="(max-width: 600px) 100vw, (max-width: 900px) 50vw, 33vw"
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
        <div className="teacher-byline">
          <CatalogImage
            src={teacher.portrait}
            kind="teacher"
            alt=""
            width={36}
            height={36}
            compact
          />
          <span>أ. {teacher.name}</span>
        </div>
        <div className="card-footer">
          <span>
            <PlayCircle size={19} aria-hidden="true" />
            {arabicNumber(lessonCount(course))} دروس
          </span>
          <span className="card-action">
            تفاصيل الكورس
            <ArrowUpLeft size={18} aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}
export function TeacherCard({ teacher }: { teacher: Teacher }) {
  const count =
    teacher.courseCount ??
    courses.filter((course) => course.teacherSlug === teacher.slug).length;
  return (
    <Link href={`/teachers/${teacher.slug}`} className="teacher-card card-link">
      <div className={`teacher-portrait theme-${teacher.subject}`}>
        <CatalogImage
          src={teacher.portrait}
          kind="teacher"
          alt=""
          width={400}
          height={400}
          sizes="(max-width: 600px) 110px, (max-width: 900px) 50vw, 25vw"
        />
        <span className="portrait-subject">
          {teacher.subjectName ?? subjectLabel(teacher.subject)}
        </span>
      </div>
      <div className="teacher-card-body">
        <h3>أ. {teacher.name}</h3>
        <p className="teacher-grades">
          {(teacher.gradeNames ?? teacher.grades.map(gradeLabel)).join(" · ")}
        </p>
        <div className="card-footer">
          <span>
            <BookOpen size={18} aria-hidden="true" />
            {arabicNumber(count)} كورسات
          </span>
          <span className="teacher-card-action">
            عرض الكورسات
            <ArrowUpLeft size={18} aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  );
}
