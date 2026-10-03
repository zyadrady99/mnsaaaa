import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { arabicNumber } from "@/lib/catalog";

export const metadata = { title: "لوحة الإدارة" };
export default async function AdminPage() {
  const account = await requireAccount("admin");
  const counts = (
    await database().query(`select
    (select count(*)::int from app_private.accounts where role='student') as students,
    (select count(*)::int from app_private.courses where status='published') as courses,
    (select count(*)::int from app_private.teachers where enabled) as teachers,
    (select count(*)::int from app_private.activations) as activations`)
  ).rows[0];
  return (
    <>
      <PageHeading
        eyebrow="إدارة دروسنا"
        title={`أهلًا، ${account.full_name}`}
        description="تابع المنصة وجهّز محتواها من هنا."
      />
      <div className="stats-grid">
        {[
          ["الطلاب", counts.students],
          ["الكورسات المنشورة", counts.courses],
          ["المدرسون", counts.teachers],
          ["التفعيلات", counts.activations],
        ].map(([label, value]) => (
          <div className="workspace-panel" key={label}>
            <p className="muted">{label}</p>
            <strong className="stat-value">
              {arabicNumber(Number(value))}
            </strong>
          </div>
        ))}
      </div>
      <section className="workspace-panel page-section">
        <h2>ابدأ إدارة المنصة</h2>
        <p className="muted">
          جهّز الدروس والواجبات والامتحانات، أصدر أكواد الاشتراك، وتابع حسابات
          الطلاب من مكان واحد.
        </p>
        <div className="chip-row">
          <Link href="/admin/courses" className="button primary">
            إدارة المحتوى
          </Link>
          <Link href="/admin/codes" className="button secondary">
            إصدار الأكواد
          </Link>
          <Link href="/admin/students" className="button secondary">
            متابعة الطلاب
          </Link>
          <Link href="/account" className="text-link">
            بيانات حسابي
          </Link>
        </div>
      </section>
    </>
  );
}
