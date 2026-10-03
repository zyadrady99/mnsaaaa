import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

export default function NotFound() {
  return (
    <section className="empty-state not-found">
      <p className="eyebrow">٤٠٤ · الصفحة مش موجودة</p>
      <h1>الخطوة دي مش موجودة هنا</h1>
      <p className="muted">
        الرابط ممكن يكون اتغيّر. ارجع للكورسات واختار من المتاح.
      </p>
      <Link href="/courses" className="button primary">
        استكشف الكورسات
        <ArrowLeft size={20} aria-hidden="true" />
      </Link>
    </section>
  );
}
