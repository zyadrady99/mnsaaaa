import { PageHeading } from "@/components/page-heading";
import { MutationForm } from "@/components/mutation-form";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
export const metadata = { title: "الصفوف والمواد" };
export default async function SettingsAdmin() {
  await requireAccount("admin");
  const [grades, subjects] = await Promise.all([
    database().query("select * from app_private.grades order by sort_order"),
    database().query("select * from app_private.subjects order by name"),
  ]);
  const refs = { grades: grades.rows, subjects: subjects.rows };
  return (
    <>
      <PageHeading
        title="الصفوف والمواد"
        description="عدّل الأسماء أو أوقف إظهارها في التصفح الجديد."
      />
      <details className="workspace-panel editor-details">
        <summary>إضافة مادة</summary>
        <MutationForm
          endpoint="/api/admin/subject-create"
          fields={[
            {
              name: "name",
              label: "اسم المادة",
              required: true,
              maxLength: 80,
            },
            {
              name: "slug",
              label: "رابط المادة",
              required: true,
              maxLength: 80,
              hint: "حروف إنجليزي صغيرة وأرقام وشرطات.",
            },
          ]}
          label="إضافة المادة"
        />
      </details>
      {[
        { kind: "grade", title: "الصفوف الدراسية", items: refs.grades },
        { kind: "subject", title: "المواد", items: refs.subjects },
      ].map((group) => (
        <section className="page-section" key={group.kind}>
          <h2>{group.title}</h2>
          <div className="admin-list">
            {group.items
              .filter((item) => !item.deleted_at)
              .map((item) => (
                <details
                  className="workspace-panel editor-details"
                  key={item.id}
                >
                  <summary>
                    {item.name}
                    <span className="muted">
                      {item.enabled ? "متاح" : "مخفي"}
                    </span>
                  </summary>
                  <MutationForm
                    endpoint="/api/admin/reference-save"
                    body={{ id: item.id, kind: group.kind }}
                    fields={[
                      {
                        name: "name",
                        label: "الاسم",
                        value: item.name,
                        required: true,
                        maxLength: 80,
                      },
                      {
                        name: "enabled",
                        label: "متاح في التصفح",
                        type: "checkbox",
                        value: item.enabled,
                      },
                    ]}
                    key={`${item.name}/${item.enabled}`}
                  />
                  <MutationForm
                    endpoint="/api/admin/reference-delete"
                    body={{ id: item.id, kind: group.kind, confirm: true }}
                    fields={[]}
                    label={group.kind === "grade" ? "حذف الصف" : "حذف المادة"}
                    variant="danger"
                    confirmMessage="حذف العنصر؟ غير المرتبط يُحذف نهائيًا، والمرتبط بكورسات أو طلاب ينتقل للمحذوفات مع حفظ السجل."
                  />
                </details>
              ))}
          </div>
          {group.items.some((item) => item.deleted_at) && (
            <details className="workspace-panel editor-details">
              <summary>المحذوفات</summary>
              <div className="admin-list">
                {group.items
                  .filter((item) => item.deleted_at)
                  .map((item) => (
                    <section key={item.id}>
                      <h3>{item.name}</h3>
                      <MutationForm
                        endpoint="/api/admin/reference-restore"
                        body={{ id: item.id, kind: group.kind, confirm: true }}
                        fields={[]}
                        label="استعادة"
                        variant="secondary"
                        confirmMessage="استعادة العنصر للوحة الإدارة؟ يمكنك إظهاره بعد مراجعة بياناته."
                      />
                    </section>
                  ))}
              </div>
            </details>
          )}
        </section>
      ))}
    </>
  );
}
