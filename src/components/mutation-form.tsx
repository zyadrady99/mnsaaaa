"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type FieldSpec = {
  name: string;
  label: string;
  type?:
    "text" | "textarea" | "number" | "select" | "checkbox" | "datetime-local";
  value?: string | number | boolean;
  required?: boolean;
  hint?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  disabled?: boolean;
};
export function MutationForm({
  endpoint,
  fields,
  body = {},
  label = "حفظ",
  navigate = false,
  confirmMessage,
  children,
}: {
  endpoint: string;
  fields: FieldSpec[];
  body?: Record<string, unknown>;
  label?: string;
  navigate?: boolean;
  confirmMessage?: string;
  children?: React.ReactNode;
}) {
  const prefix = useId(),
    router = useRouter();
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const alert = useRef<HTMLDivElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const form = event.currentTarget,
      values = new FormData(form),
      data = { ...body };
    for (const field of fields)
      data[field.name] = field.disabled
        ? field.value
        : field.type === "checkbox"
          ? values.has(field.name)
          : field.type === "number"
            ? Number(values.get(field.name))
            : String(values.get(field.name) ?? "");
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? "تعذر الحفظ. حاول تاني.");
      setMessage(result.message ?? "اتحفظ بنجاح.");
      if (navigate && result.next) router.push(result.next);
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "تعذر الاتصال. حاول تاني.",
      );
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
      {fields.map((field) => {
        const id = `${prefix}-${field.name}`,
          hint = field.hint ? `${id}-hint` : undefined;
        const shared = {
          id,
          name: field.name,
          required: field.required,
          disabled: pending || field.disabled,
          "aria-describedby": hint,
        };
        return (
          <div
            className={`field${field.type === "checkbox" ? " checkbox-field" : ""}`}
            key={field.name}
          >
            {field.type === "checkbox" ? (
              <label htmlFor={id}>
                <input
                  {...shared}
                  type="checkbox"
                  defaultChecked={Boolean(field.value)}
                />
                {field.label}
              </label>
            ) : (
              <>
                <label htmlFor={id}>{field.label}</label>
                {field.type === "textarea" ? (
                  <textarea
                    {...shared}
                    rows={4}
                    defaultValue={String(field.value ?? "")}
                    maxLength={field.maxLength ?? 5000}
                  />
                ) : field.type === "select" ? (
                  <select {...shared} defaultValue={String(field.value ?? "")}>
                    <option value="" disabled>
                      اختار…
                    </option>
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...shared}
                    type={field.type ?? "text"}
                    defaultValue={String(field.value ?? "")}
                    maxLength={field.maxLength ?? 180}
                    min={field.min}
                    max={field.max}
                    dir={field.name === "slug" ? "ltr" : undefined}
                  />
                )}
              </>
            )}
            {field.hint && (
              <p className="field-hint" id={hint}>
                {field.hint}
              </p>
            )}
          </div>
        );
      })}
      {children}
      <button type="submit" className="button primary" disabled={pending}>
        {pending ? "جاري الإتمام…" : label}
      </button>
      {message && (
        <p className="status-message" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
