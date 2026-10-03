import Link from "next/link";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { PageHeading } from "@/components/page-heading";
import { cairoDate } from "@/lib/time";
export const metadata = { title: "سجل الإجراءات" };
const labels: Record<string, string> = {
  register: "إنشاء حساب",
  "teacher-save": "حفظ بيانات مدرس",
  "course-save": "حفظ كورس",
  "unit-save": "حفظ وحدة",
  "lesson-save": "حفظ درس",
  "lesson-delete": "حذف درس",
  "unit-delete": "حذف وحدة",
  "course-delete": "حذف كورس",
  "teacher-delete": "حذف مدرس",
  "assessment-delete": "حذف تقييم",
  "reference-delete": "حذف صف أو مادة",
  "code-delete": "حذف كود",
  "code-batch-delete": "حذف دفعة أكواد",
  "image-upload": "رفع صورة",
  "assessment-archive": "أرشفة تقييم",
  "video-fixture": "تجهيز فيديو تجريبي",
  "lesson-publish": "نشر درس",
  "course-publish": "نشر كورس",
  "course-archive": "أرشفة كورس",
  "assessment-save": "حفظ إصدار تقييم",
  "assessment-publish": "نشر إصدار تقييم",
  "codes-generate": "إصدار أكواد",
  "code-export": "تصدير أكواد",
  "code-cancel": "إلغاء كود غير مستخدم",
  "code-activate": "تفعيل كود",
  "student-disable": "تعطيل طالب",
  "student-enable": "تنشيط طالب",
  "student-update": "تعديل بيانات طالب",
  "access-extend": "تمديد وصول",
  "access-withdraw": "سحب وصول",
  "lesson-override": "فتح درس استثنائي",
  "reference-save": "تعديل صف أو مادة",
  "subject-create": "إضافة مادة",
};
function label(action: string) {
  if (labels[action]) return labels[action];
  if (action.endsWith("-restore")) return "استرجاع عنصر محذوف";
  if (action.startsWith("recovery-"))
    return action.endsWith("complete")
      ? "اكتمال استعادة حساب"
      : "إجراء استعادة حساب";
  if (action.startsWith("registration-reconcile")) return "مراجعة تسجيل حساب";
  return "إجراء على المنصة";
}
export default async function Audit() {
  await requireAccount("admin");
  const rows = (
    await database().query(
      "select e.id,e.action,e.target_type,e.target_id,e.reason,e.occurred_at,a.full_name as actor from app_private.audit_events e join app_private.accounts a on a.id=e.actor_id order by e.occurred_at desc,e.id limit 100",
    )
  ).rows;
  return (
    <>
      <PageHeading
        title="سجل الإجراءات"
        description="آخر ١٠٠ إجراء محفوظة مع الفاعل والوقت والسبب عند وجوده."
      />
      <div className="admin-list">
        {rows.map((row) => {
          const href =
            row.target_type === "account"
              ? `/admin/students/${row.target_id}`
              : row.target_type === "course"
                ? `/admin/courses/${row.target_id}`
                : null;
          return (
            <section className="workspace-panel" key={row.id}>
              <h2>{label(row.action)}</h2>
              <p className="muted">
                {row.actor} · {cairoDate(row.occurred_at)}
              </p>
              {row.reason && <p>{row.reason}</p>}
              {href && (
                <Link className="text-link" href={href}>
                  عرض الحساب أو الكورس ←
                </Link>
              )}
            </section>
          );
        })}
      </div>
      {!rows.length && <p className="muted">لسه مفيش إجراءات مسجلة.</p>}
    </>
  );
}
