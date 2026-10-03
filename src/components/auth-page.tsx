import Image from "next/image";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { AuthForm } from "@/components/auth-form";

export function AuthPage({
  mode,
  returnTo,
}: {
  mode: "login" | "register";
  returnTo?: string;
}) {
  const register = mode === "register";
  return (
    <div className="auth-layout">
      <section className="auth-main">
        <p className="eyebrow">
          {register ? "أول خطوة تبدأ بيك" : "أهلًا بيك في دروسنا"}
        </p>
        <h1>{register ? "ابدأ رحلتك الدراسية" : "نورت، جاهز تتعلّم؟"}</h1>
        <p className="muted">
          {register
            ? "اسمك وصفّك ورقمك، ونرتّب باقي الطريق معاك."
            : "ادخل برقم موبايلك وكلمة السر."}
        </p>
        <AuthForm mode={mode} returnTo={returnTo} />
      </section>
      <aside className="auth-aside">
        <div className="auth-aside-copy">
          <p className="eyebrow">كل خطوة بتفرق</p>
          <h2>
            فهم أحسن.
            <br />
            تدريب أكتر.
          </h2>
          <p>
            من أول فكرة في الدرس،
            <br />
            لحد ما تحلّها بنفسك.
          </p>
        </div>
        <Image src="/images/study-scene.svg" alt="" width={600} height={430} />
        <ul>
          <li>
            <CheckCircle size={21} aria-hidden="true" />
            مدرّسك وكورساتك في مكان واحد
          </li>
          <li>
            <CheckCircle size={21} aria-hidden="true" />
            واجبات تساعدك تثبّت الفهم
          </li>
          <li>
            <CheckCircle size={21} aria-hidden="true" />
            تقدّم ونتائج تقدر ترجع لهم
          </li>
        </ul>
      </aside>
    </div>
  );
}
