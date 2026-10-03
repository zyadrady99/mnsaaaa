import Image from "next/image";
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
        <Image
          src={course.cover}
          alt=""
          width={640}
          height={480}
          sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 33vw"
        />
        <span className="cover-badge">
          {course.gradeName ?? gradeLabel(course.grade)}
        </span>
      </div>
      <div className="course-card-body">
        <span className="eyebrow">
          {course.subjectName ?? subjectLabel(course.subject)}
        </span>
        <h3>{course.title}</h3>
        <div className="teacher-byline">
          <Image src={teacher.portrait} alt="" width={32} height={32} />
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
        <Image
          src={teacher.portrait}
          alt={`رسم تجريبي للمدرس ${teacher.name}`}
          width={400}
          height={400}
          sizes="(max-width: 767px) 50vw, 25vw"
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
          <ArrowUpLeft size={21} aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}
