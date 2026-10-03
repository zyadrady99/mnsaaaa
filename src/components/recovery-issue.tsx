"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cairoDate } from "@/lib/time";
export function RecoveryIssue({
  studentId,
  review = false,
}: {
  studentId: string;
  review?: boolean;
}) {
  const id = useId(),
    router = useRouter(),
    alert = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [grant, setGrant] = useState<{ code: string; expiresAt: string } | null>(
      null,
    ),
    [copied, setCopied] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget,
      verificationRef = String(
        new FormData(form).get("verificationRef") ?? "",
      ).trim();
    setPending(true);
    setError("");
    setGrant(null);
    setCopied(false);
    try {
      const response = await fetch(
        `/api/admin/${review ? "recovery-reconcile" : "recovery-issue"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, verificationRef }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message ?? "تعذر إصدار كود الاستعادة.");
      setGrant({ code: data.recoveryCode, expiresAt: data.expiresAt });
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "تعذر الاتصال.");
      requestAnimationFrame(() => alert.current?.focus());
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="mutation-form" onSubmit={submit} aria-busy={pending}>
      {error && (
        <div className="error-summary" role="alert" tabIndex={-1} ref={alert}>
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor={id}>مرجع التحقق من هوية الطالب حضوريًا</label>
        <input
          id={id}
          name="verificationRef"
          minLength={3}
          maxLength={120}
          required
          disabled={pending}
        />
        <p className="field-hint">
          مثال: رقم تذكرة الدعم في السنتر. تجنّب كتابة أرقام مستندات الهوية.
        </p>
      </div>
      <label className="checkbox-field">
        <input type="checkbox" required disabled={pending} /> تحققت من هوية
        الطالب في السنتر وأقدر أسلّمه الكود.
      </label>
      <button className="button secondary" disabled={pending || Boolean(grant)}>
        {pending
          ? "جاري التجهيز…"
          : review
            ? "إعادة إصدار بعد المراجعة"
            : "إصدار كود استعادة"}
      </button>
      {grant && (
        <div className="status-message" role="status">
          <p>
            الكود صالح حتى {cairoDate(grant.expiresAt)} ولمرة واحدة. جلسات
            الطالب القديمة اتقفلت.
          </p>
          <label htmlFor={`${id}-code`}>
            كود الاستعادة — انسخه وسلّمه للطالب
          </label>
          <input
            id={`${id}-code`}
            className="code-input"
            value={grant.code}
            readOnly
            dir="ltr"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(grant.code);
                setCopied(true);
              } catch {
                setError("حدّد الكود وانسخه يدويًا.");
              }
            }}
          >
            {copied ? "تم النسخ" : "نسخ الكود"}
          </button>
          <p>
            الطالب يفتحه من صفحة «استعادة الحساب» ويختار كلمة سر جديدة. الكود مش
            بيتحفظ في المتصفح.
          </p>
        </div>
      )}
    </form>
  );
}
