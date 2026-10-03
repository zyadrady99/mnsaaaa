import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { MutationForm } from "@/components/mutation-form";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { validUuid } from "@/lib/auth-input";
import { cairoDate } from "@/lib/time";
export const metadata = { title: "دفعة الأكواد" };
export default async function BatchAdmin({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccount("admin");
  const { id } = await params;
  if (!validUuid(id)) notFound();
  const batch = (
    await database().query(
      "select b.*,c.title from app_private.code_batches b join app_private.courses c on c.id=b.course_id where b.id=$1",
      [id],
    )
  ).rows[0];
  if (!batch) notFound();
  const codes = (
    await database().query(
      `select c.id,c.masked_suffix,c.cancelled_at,a.activated_at,s.full_name,s.id as student_id from app_private.activation_codes c
    left join app_private.activations a on a.code_id=c.id left join app_private.accounts s on s.id=a.student_id where c.batch_id=$1 order by c.id`,
      [id],
    )
  ).rows;
  return (
    <>
      <PageHeading
        title={batch.title}
        description={`${batch.quantity} كود · ${batch.duration_days} يوم لكل كود`}
      />
      <p className="muted">
        آخر موعد للتفعيل:{" "}
        {batch.activate_before
          ? cairoDate(batch.activate_before)
          : "بدون موعد نهائي"}
      </p>
      <div className="button-row">
        <a
          className="button primary"
          href={`/api/admin/code-export/${id}`}
          download
        >
          تنزيل الأكواد CSV
        </a>
        <Link className="button secondary" href="/admin/codes">
          كل الدفعات
        </Link>
      </div>
      <div className="admin-list">
        {codes.map((code) => (
          <div className="workspace-panel admin-list-row" key={code.id}>
            <strong dir="ltr">•••• {code.masked_suffix}</strong>
            <span className="chip neutral">
              {code.activated_at
                ? "مستخدم"
                : code.cancelled_at
                  ? "ملغي"
                  : "غير مستخدم"}
            </span>
            {code.student_id ? (
              <span>
                {code.full_name} · {cairoDate(code.activated_at)}
              </span>
            ) : (
              !code.cancelled_at && (
                <MutationForm
                  endpoint="/api/admin/code-cancel"
                  fields={[]}
                  body={{ id: code.id }}
                  label="إلغاء الكود"
                />
              )
            )}
          </div>
        ))}
      </div>
    </>
  );
}
