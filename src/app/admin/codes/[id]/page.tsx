import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/common/page-heading";
import { MutationForm } from "@/components/admin/mutation-form";
import { requireAccount } from "@/server/auth/service";
import { database } from "@/server/core/db";
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
      `select c.id,c.masked_suffix,c.cancelled_at,c.deleted_at,a.activated_at,s.full_name,s.id as student_id from app_private.activation_codes c
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
        {!batch.deleted_at && (
          <a
            className="button primary"
            href={`/api/admin/code-export/${id}`}
            download
          >
            تنزيل الأكواد CSV
          </a>
        )}
        <Link className="button secondary" href="/admin/codes">
          كل الدفعات
        </Link>
      </div>
      <section className="workspace-panel page-section">
        <p className="muted">
          حذف الدفعة يلغي أكوادها غير المستخدمة ويحفظ اشتراكات الطلاب وسجل
          الأكواد المستخدمة. الاستعادة تعيد العرض وتُبقي الإلغاء.
        </p>
        <MutationForm
          endpoint={`/api/admin/code-batch-${batch.deleted_at ? "restore" : "delete"}`}
          body={{ id, confirm: true }}
          fields={[]}
          label={batch.deleted_at ? "استعادة عرض الدفعة" : "حذف الدفعة"}
          variant={batch.deleted_at ? "secondary" : "danger"}
          navigate={!batch.deleted_at}
          confirmMessage={
            batch.deleted_at
              ? "استعادة عرض الدفعة؟ الأكواد الملغية تظل ملغية."
              : "حذف الدفعة وإلغاء أكوادها غير المستخدمة؟ اشتراكات الطلاب وسجل التفعيل محفوظان."
          }
        />
      </section>
      <div className="admin-list">
        {codes
          .filter((code) => !code.deleted_at)
          .map((code) => (
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
                    variant="danger"
                  />
                )
              )}
              {!batch.deleted_at && (
                <MutationForm
                  endpoint="/api/admin/code-delete"
                  body={{ id: code.id, confirm: true }}
                  fields={[]}
                  label="حذف الكود"
                  variant="danger"
                  confirmMessage="حذف الكود من العرض؟ غير المستخدم يُلغى نهائيًا، والمستخدم يظل اشتراك صاحبه محفوظًا."
                />
              )}
            </div>
          ))}
      </div>
      {codes.some((code) => code.deleted_at) && (
        <section className="page-section">
          <h2>الأكواد المحذوفة</h2>
          <div className="admin-list">
            {codes
              .filter((code) => code.deleted_at)
              .map((code) => (
                <section className="workspace-panel" key={code.id}>
                  <strong dir="ltr">•••• {code.masked_suffix}</strong>
                  <MutationForm
                    endpoint="/api/admin/code-restore"
                    body={{ id: code.id, confirm: true }}
                    fields={[]}
                    label="استعادة عرض الكود"
                    variant="secondary"
                    confirmMessage="استعادة عرض الكود؟ إذا كان ملغيًا يظل ملغيًا."
                  />
                </section>
              ))}
          </div>
        </section>
      )}
    </>
  );
}
