import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, PageHeading } from "@/components/common/page-heading";
import { LogoutButton } from "@/components/auth/logout-button";
import { requireAccount } from "@/server/auth/service";
import { gradeLabel, type GradeId } from "@/lib/catalog";
export const metadata: Metadata = { title: "حسابي" };
export default async function AccountPage() {
  const account = await requireAccount();
  return (
    <>
      <Breadcrumbs items={[{ label: "حسابي" }]} />
      <PageHeading
        eyebrow="كل خطوة محفوظة"
        title={"أهلًا، " + account.full_name}
        description="بيانات حسابك الدراسي."
      />
      <section className="workspace-panel" aria-labelledby="profile-title">
        <h2 id="profile-title">بيانات الحساب</h2>
        <dl className="profile-details">
          <div>
            <dt>الاسم الكامل</dt>
            <dd>{account.full_name}</dd>
          </div>
          <div>
            <dt>رقم الموبايل</dt>
            <dd dir="ltr">{account.phone.replace(/^\+20/, "0")}</dd>
          </div>
          <div>
            <dt>{account.role === "admin" ? "نوع الحساب" : "الصف الدراسي"}</dt>
            <dd>
              {account.role === "admin"
                ? "مدير المنصة"
                : (account.grade_name ??
                  gradeLabel(account.grade_slug as GradeId))}
            </dd>
          </div>
        </dl>
        <div className="button-row">
          <Link
            className="button primary"
            href={account.role === "admin" ? "/admin" : "/my-courses"}
          >
            {account.role === "admin" ? "لوحة الإدارة" : "كورساتي"}
          </Link>
          <LogoutButton />
        </div>
      </section>
      <p className="page-section muted">
        لو محتاج تصحّح بياناتك أو تستعيد كلمة السر، تواصل مع إدارة السنتر للتحقق
        من حسابك.
      </p>
    </>
  );
}
