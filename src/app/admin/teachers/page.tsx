import { PageHeading } from "@/components/page-heading";
import { MutationForm, type FieldSpec } from "@/components/mutation-form";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { referenceData } from "@/server/catalog";
export const metadata = { title: "إدارة المدرسين" };
export default async function TeachersAdmin() {
  await requireAccount("admin");
  const teachers = (
    await database().query("select * from app_private.teachers order by name")
  ).rows;
  const subjects = (await referenceData()).subjects
    .filter((s) => s.enabled)
    .map((s) => ({ value: s.id, label: s.name }));
  function fields(teacher?: (typeof teachers)[number]): FieldSpec[] {
    return [
      {
        name: "name",
        label: "اسم المدرس",
        required: true,
        value: teacher?.name,
        maxLength: 120,
      },
      {
        name: "slug",
        label: "رابط المدرس",
        required: true,
        value: teacher?.slug,
        hint: "حروف إنجليزي صغيرة وأرقام وشرطات.",
      },
      {
        name: "subjectId",
        label: "المادة",
        type: "select",
        options: subjects,
        required: true,
        value: teacher?.subject_id,
      },
      {
        name: "portrait",
        label: "صورة المدرس",
        type: "image",
        value: teacher?.image_ref ?? "",
      },
      {
        name: "description",
        label: "نبذة عن المدرس",
        type: "textarea",
        value: teacher?.biography,
        maxLength: 3000,
      },
      {
        name: "approach",
        label: "طريقة الشرح",
        type: "textarea",
        value: teacher?.approach?.join("\n"),
        hint: "كل نقطة في سطر منفصل.",
      },
      {
        name: "enabled",
        label: "إظهار المدرس في الموقع",
        type: "checkbox",
        value: teacher?.enabled ?? true,
      },
    ];
  }
  return (
    <>
      <PageHeading
        eyebrow="إدارة المحتوى"
        title="المدرسون"
        description="المدرس سجل في المنصة؛ دخوله بحساب مستقل غير مطلوب."
      />
      <details className="workspace-panel editor-details">
        <summary>إضافة مدرس</summary>
        <MutationForm
          endpoint="/api/admin/teacher-save"
          fields={fields()}
          label="إضافة المدرس"
        />
      </details>
      <div className="admin-list">
        {teachers
          .filter((teacher) => !teacher.deleted_at)
          .map((teacher) => (
            <details
              className="workspace-panel editor-details"
              key={teacher.id}
            >
              <summary>
                <strong>أ. {teacher.name}</strong>
                <span className="muted">
                  {teacher.enabled ? "ظاهر" : "مخفي"}
                </span>
              </summary>
              <MutationForm
                endpoint="/api/admin/teacher-save"
                fields={fields(teacher)}
                body={{ id: teacher.id }}
                key={JSON.stringify(teacher)}
                label="حفظ بيانات المدرس"
              />
              <MutationForm
                endpoint="/api/admin/teacher-delete"
                fields={[]}
                body={{ id: teacher.id, confirm: true }}
                label="حذف المدرس"
                variant="danger"
                confirmMessage="حذف المدرس؟ المدرس غير المرتبط بكورسات يُحذف نهائيًا. المرتبط ينتقل للمحذوفات مع حفظ كورساته ووصول الطلاب."
              />
            </details>
          ))}
      </div>
      {teachers.some((teacher) => teacher.deleted_at) && (
        <section className="page-section">
          <h2>المدرسون المحذوفون</h2>
          <div className="admin-list">
            {teachers
              .filter((teacher) => teacher.deleted_at)
              .map((teacher) => (
                <section className="workspace-panel" key={teacher.id}>
                  <h3>أ. {teacher.name}</h3>
                  <MutationForm
                    endpoint="/api/admin/teacher-restore"
                    body={{ id: teacher.id, confirm: true }}
                    fields={[]}
                    label="استعادة المدرس"
                    variant="secondary"
                    confirmMessage="استعادة المدرس للوحة الإدارة؟ يمكنك مراجعة بياناته وإظهاره بعد الاستعادة."
                  />
                </section>
              ))}
          </div>
        </section>
      )}
    </>
  );
}
