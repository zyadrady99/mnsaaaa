"use client";
import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { passwordHint, validPassword } from "@/lib/auth-input";
export function RecoveryForm() {
  const id = useId(),
    alert = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    const form = event.currentTarget,
      values = new FormData(form),
      password = String(values.get("password") ?? "");
    try {
      if (!validPassword(password)) throw new Error(passwordHint);
      if (password !== values.get("confirm"))
        throw new Error("كلمتا السر مش متطابقتين.");
      setPending(true);
      const res = await fetch("/api/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: String(values.get("code") ?? "").trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "تعذر الاستعادة.");
      form.reset();
      setDone(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "تعذر الاتصال.");
      requestAnimationFrame(() => alert.current?.focus());
    } finally {
      setPending(false);
    }
  }
  if (done)
    return (
      <div className="status-message" role="status">
        <h2>كلمة السر اتغيّرت</h2>
        <p>
          سجّل دخولك بالكلمة الجديدة. لو الحساب معطّل، تواصل مع السنتر لتنشيطه.
        </p>
        <Link className="button primary" href="/login">
          تسجيل الدخول
        </Link>
      </div>
    );
  return (
    <form className="mutation-form" onSubmit={submit} aria-busy={pending}>
      {error && (
        <div className="error-summary" role="alert" tabIndex={-1} ref={alert}>
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-code`}>كود الاستعادة من السنتر</label>
        <input
          id={`${id}-code`}
          name="code"
          className="code-input"
          dir="ltr"
          minLength={43}
          maxLength={43}
          autoComplete="off"
          spellCheck={false}
          required
          disabled={pending}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-password`}>كلمة السر الجديدة</label>
        <input
          id={`${id}-password`}
          name="password"
          type="password"
          minLength={12}
          maxLength={72}
          autoComplete="new-password"
          aria-describedby={`${id}-hint`}
          required
          disabled={pending}
        />
        <p id={`${id}-hint`} className="field-hint">
          {passwordHint}
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${id}-confirm`}>تأكيد كلمة السر</label>
        <input
          id={`${id}-confirm`}
          name="confirm"
          type="password"
          minLength={12}
          maxLength={72}
          autoComplete="new-password"
          required
          disabled={pending}
        />
      </div>
      <button className="button primary full" disabled={pending}>
        {pending ? "جاري الاستعادة…" : "تغيير كلمة السر"}
      </button>
    </form>
  );
}
