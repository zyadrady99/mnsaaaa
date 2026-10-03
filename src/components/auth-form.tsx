"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeSlash } from "@phosphor-icons/react";
import { grades } from "@/lib/catalog";
import { normalizePhone, validPassword, passwordHint } from "@/lib/auth-input";

type Field = "name" | "grade" | "phone" | "password";
type Errors = Partial<Record<Field, string>>;
const fieldLabels: Record<Field, string> = {
  name: "الاسم الكامل",
  grade: "الصف الدراسي",
  phone: "رقم الموبايل",
  password: "كلمة السر",
};

export function AuthForm({
  mode,
  returnTo,
}: {
  mode: "login" | "register";
  returnTo?: string;
}) {
  const register = mode === "register";
  const [errors, setErrors] = useState<Errors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState("");
  const request = useRef<{ payload: string; id: string } | null>(null);
  const summary = useRef<HTMLDivElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const nextErrors: Errors = {};
    const name = String(data.get("name") || "").trim();
    const phone = normalizePhone(String(data.get("phone") || ""));
    const password = String(data.get("password") || "");
    if (
      register &&
      (name.length < 3 || name.length > 120 || name.split(/\s+/).length < 2)
    )
      nextErrors.name = "اكتب اسمك الكامل، على الأقل اسمين.";
    if (register && !grades.some((grade) => grade.id === data.get("grade")))
      nextErrors.grade = "اختار صفك الدراسي.";
    if (!phone)
      nextErrors.phone = "اكتب رقم موبايل مصري صحيح، مثل 01012345678.";
    if (!password) nextErrors.password = "اكتب كلمة السر.";
    else if (register && !validPassword(password))
      nextErrors.password = passwordHint;
    setErrors(nextErrors);
    setServerError("");
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    setPending(true);
    try {
      const payload = JSON.stringify([phone, name, data.get("grade")]);
      if (!request.current || request.current.payload !== payload)
        request.current = { payload, id: crypto.randomUUID() };
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          register
            ? {
                name,
                grade: data.get("grade"),
                phone,
                password,
                requestId: request.current.id,
              }
            : { phone, password, next: returnTo },
        ),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || "تعذر إتمام العملية. جرّب تاني.");
      const passwordInput = form.elements.namedItem("password");
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
      window.location.assign(
        register
          ? `/login?created=1${returnTo ? `&next=${encodeURIComponent(returnTo)}` : ""}`
          : result.next,
      );
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "تعذر التواصل مع السيرفر. جرّب تاني.",
      );
      requestAnimationFrame(() => summary.current?.focus());
    } finally {
      setPending(false);
    }
  }

  const message = (field: Field) =>
    errors[field] ? (
      <p className="field-error" id={`${field}-error`}>
        {errors[field]}
      </p>
    ) : null;
  const description = (field: Field, hint?: string) =>
    [hint, errors[field] ? `${field}-error` : ""].filter(Boolean).join(" ") ||
    undefined;
  const nextQuery = returnTo ? `?next=${encodeURIComponent(returnTo)}` : "";

  return (
    <form
      onSubmit={submit}
      noValidate
      className="auth-form"
      aria-busy={pending}
    >
      {(Object.keys(errors).length > 0 || serverError) && (
        <div
          className="error-summary"
          role="alert"
          tabIndex={-1}
          ref={summary}
          aria-labelledby="form-errors"
        >
          <h2 id="form-errors">راجع البيانات دي</h2>
          {serverError && <p>{serverError}</p>}
          <ul>
            {Object.entries(errors).map(([field, error]) => (
              <li key={field}>
                <a href={`#${field}`}>
                  {fieldLabels[field as Field]}: {error}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {register && (
        <>
          <div className="field">
            <label htmlFor="name">الاسم الكامل</label>
            <input
              id="name"
              name="name"
              autoComplete="name"
              maxLength={120}
              required
              aria-invalid={Boolean(errors.name)}
              aria-describedby={description("name")}
              placeholder="اسمك زي ما هيتسجل في السنتر"
            />
            {message("name")}
          </div>
          <div className="field">
            <label htmlFor="grade">الصف الدراسي</label>
            <select
              id="grade"
              name="grade"
              defaultValue=""
              required
              aria-invalid={Boolean(errors.grade)}
              aria-describedby={description("grade")}
            >
              <option value="" disabled>
                اختار صفك
              </option>
              {grades.map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.label}
                </option>
              ))}
            </select>
            {message("grade")}
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="phone">رقم الموبايل</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          maxLength={24}
          required
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={description("phone", "phone-hint")}
          placeholder="01xxxxxxxxx"
        />
        <p className="field-hint" id="phone-hint">
          رقمك اللي هتستخدمه كل مرة تدخل فيها.
        </p>
        {message("phone")}
      </div>
      <div className="field">
        <label htmlFor="password">كلمة السر</label>
        <div className="password-input">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            dir="auto"
            autoComplete={register ? "new-password" : "current-password"}
            required
            aria-invalid={Boolean(errors.password)}
            aria-describedby={description(
              "password",
              register ? "password-hint" : undefined,
            )}
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((show) => !show)}
            aria-label={showPassword ? "إخفاء كلمة السر" : "إظهار كلمة السر"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeSlash size={22} aria-hidden="true" />
            ) : (
              <Eye size={22} aria-hidden="true" />
            )}
          </button>
        </div>
        {register && (
          <p className="field-hint" id="password-hint">
            {passwordHint}
          </p>
        )}
        {message("password")}
      </div>
      {!register && (
        <Link href="/help#recovery" className="text-link recovery-link">
          نسيت كلمة السر؟
        </Link>
      )}
      <button className="button primary full" type="submit" disabled={pending}>
        {pending ? "جاري الإتمام…" : register ? "إنشاء حساب" : "دخول"}
        <ArrowLeft size={20} aria-hidden="true" />
      </button>
      <p className="auth-switch">
        {register ? "عندك حساب؟" : "لسه أول مرة؟"}{" "}
        <Link href={`${register ? "/login" : "/register"}${nextQuery}`}>
          {register ? "سجّل دخولك" : "اعمل حساب جديد"}
        </Link>
      </p>
    </form>
  );
}
