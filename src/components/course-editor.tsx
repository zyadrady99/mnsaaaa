import { MutationForm, type FieldSpec } from "./mutation-form";
import { referenceData } from "@/server/catalog";
import { database } from "@/server/db";
type EditableCourse = {
  id: string;
  title: string;
  slug: string;
  teacher_id: string;
  grade_id: string;
  subject_id: string;
  description: string;
  subtitle: string;
  cover_ref: string;
  outcomes: string[];
  status: string;
};
export async function CourseEditor({ course }: { course?: EditableCourse }) {
  const [refs, teacherResult] = await Promise.all([
    referenceData(),
    database().query(
      "select id,name from app_private.teachers where enabled or id=$1 order by name",
      [course?.teacher_id ?? null],
    ),
  ]);
  const teachers = teacherResult.rows;
  const covers = ["physics", "chemistry", "math", "arabic"].map((name, i) => ({
    value: `/images/course-${name}.svg`,
    label: `غلاف تجريبي ${i + 1}`,
  }));
  const frozen = Boolean(course && course.status !== "draft");
  const fields: FieldSpec[] = [
    {
      name: "title",
      label: "اسم الكورس",
      value: course?.title,
      required: true,
    },
    {
      name: "slug",
      label: "رابط الكورس",
      value: course?.slug,
      required: true,
      disabled: frozen,
      hint: "حروف إنجليزي صغيرة وأرقام وشرطات.",
    },
    {
      name: "teacherId",
      label: "المدرس",
      type: "select",
      value: course?.teacher_id,
      required: true,
      disabled: frozen,
      options: teachers.map((t) => ({ value: t.id, label: `أ. ${t.name}` })),
    },
    {
      name: "gradeId",
      label: "الصف الدراسي",
      type: "select",
      value: course?.grade_id,
      required: true,
      disabled: frozen,
      options: refs.grades
        .filter((g) => g.enabled || g.id === course?.grade_id)
        .map((g) => ({ value: g.id, label: g.name })),
    },
    {
      name: "subjectId",
      label: "المادة",
      type: "select",
      value: course?.subject_id,
      required: true,
      disabled: frozen,
      options: refs.subjects
        .filter((s) => s.enabled || s.id === course?.subject_id)
        .map((s) => ({ value: s.id, label: s.name })),
    },
    {
      name: "subtitle",
      label: "وصف مختصر",
      value: course?.subtitle,
      maxLength: 300,
    },
    {
      name: "description",
      label: "وصف الكورس",
      type: "textarea",
      value: course?.description,
    },
    {
      name: "cover",
      label: "غلاف الكورس",
      type: "select",
      value: course?.cover_ref ?? covers[0].value,
      options: covers,
      required: true,
    },
    {
      name: "outcomes",
      label: "هتتعلم إيه؟",
      type: "textarea",
      value: course?.outcomes.join("\n"),
      hint: "كل نقطة في سطر منفصل.",
    },
  ];
  return (
    <MutationForm
      endpoint="/api/admin/course-save"
      fields={fields}
      body={course ? { id: course.id } : {}}
      navigate={!course}
      label={course ? "حفظ بيانات الكورس" : "إنشاء المسودة"}
    />
  );
}
