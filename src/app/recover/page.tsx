import Link from "next/link";
import { PageHeading } from "@/components/common/page-heading";
import { RecoveryForm } from "@/components/auth/recovery-form";
export const metadata = {
  title: "استعادة الحساب",
  referrer: "no-referrer" as const,
};
export default function Recover() {
  return (
    <div className="recovery-layout">
      <section className="workspace-panel">
        <PageHeading
          title="استعادة الحساب"
          description="بعد التحقق من هويتك في السنتر، أدخل كود الاستعادة واختار كلمة سر جديدة."
        />
        <RecoveryForm />
        <p className="muted">
          الكود صالح ١٥ دقيقة ولمرة واحدة. لو انتهى، اطلب كودًا جديدًا من
          السنتر.
        </p>
        <Link className="text-link" href="/login">
          ارجع لتسجيل الدخول ←
        </Link>
      </section>
    </div>
  );
}
