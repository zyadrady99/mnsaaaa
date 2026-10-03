import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { CodeGenerateForm } from "@/components/code-generate-form";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { cairoDate } from "@/lib/time";
export const metadata = { title: "أكواد الاشتراك" };
export default async function CodesAdmin() {
  await requireAccount("admin");
  const [courses, batches] = await Promise.all([
    database().query(
      "select id,title from app_private.courses where status='published' order by title",
    ),
    database().query(
      `select b.id,b.duration_days,b.quantity,b.created_at,c.title,(select count(*)::int from app_private.activations a join app_private.activation_codes x on x.id=a.code_id where x.batch_id=b.id) as used from app_private.code_batches b join app_private.courses c on c.id=b.course_id order by b.created_at desc limit 100`,
    ),
  ]);
  return (
    <>
      <PageHeading
        title="أكواد الاشتراك"
        description="أنشئ دفعة لكورس واحد ومدّة محددة، ونزّل الأكواد لتوزيعها من السنتر."
      />
      <section className="workspace-panel">
        <h2>دفعة جديدة</h2>
        <CodeGenerateForm courses={courses.rows} />
      </section>
      <section className="page-section">
        <h2>الدفعات السابقة</h2>
        <div className="admin-list">
          {batches.rows.map((b) => (
            <Link
              className="workspace-panel admin-list-row"
              key={b.id}
              href={`/admin/codes/${b.id}`}
            >
              <div>
                <h3>{b.title}</h3>
                <p className="muted">
                  {b.duration_days} يوم · {b.quantity} كود · {b.used} مستخدم
                </p>
                <p className="muted">{cairoDate(b.created_at)}</p>
              </div>
              <span className="text-link">عرض الدفعة ←</span>
            </Link>
          ))}
        </div>
        {!batches.rows.length && (
          <p className="muted">لسه مفيش دفعات. ابدأ بالدفعة الأولى.</p>
        )}
      </section>
    </>
  );
}
