import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  IdentificationCard,
  Ticket,
} from "@phosphor-icons/react/dist/ssr";
import { Breadcrumbs, PageHeading } from "@/components/common/page-heading";

export const metadata: Metadata = { title: "المساعدة" };
export default function Help() {
  return (
    <>
      <Breadcrumbs items={[{ label: "المساعدة" }]} />
      <PageHeading
        eyebrow="نوضّح الخطوة الجاية"
        title="إزاي نقدر نساعدك؟"
        description="الاشتراك واستعادة الحساب بيتموا من خلال السنتر."
      />
      <div className="help-grid">
        <section className="help-card" id="codes">
          <Ticket size={34} aria-hidden="true" />
          <h2>معاك كود كورس؟</h2>
          <p>
            كل كود بيخص كورس واحد، وبيتستخدم على حساب طالب واحد. بتحصل عليه من
            السنتر، والمدة المكتوبة عليه بتبدأ من التفعيل.
          </p>
          <ol>
            <li>اختار الكورس واتأكد إنه الكورس المكتوب على الكود.</li>
            <li>سجّل دخولك برقم الموبايل وكلمة السر.</li>
            <li>
              من «كورساتي»، أدخل الكود وراجع اسم الكورس ومدته ثم أكّد التفعيل.
            </li>
          </ol>
          <Link href="/my-courses#activate" className="button primary">
            تفعيل كود
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
        </section>
        <section className="help-card" id="recovery">
          <IdentificationCard size={34} aria-hidden="true" />
          <h2>نسيت كلمة السر؟</h2>
          <p>
            روح السنتر علشان يتم التحقق من هويتك حضوريًا. الأدمن هيساعدك تستعيد
            الحساب بكود صالح ١٥ دقيقة ولمرة واحدة. اختار كلمة السر الجديدة
            بنفسك.
          </p>
          <p>
            معرفة رقم الموبايل أو كود الكورس لوحدها مش كفاية لاستعادة الحساب.
          </p>
          <Link href="/recover" className="button secondary">
            معايا كود استعادة
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
        </section>
      </div>
    </>
  );
}
