"use client";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImageField } from "@/components/admin/image-field";

export type FieldSpec = {
  name: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "number"
    | "select"
    | "checkbox"
    | "datetime-local"
    | "image";
  imageKind?: "teacher" | "course";
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
  variant = "primary",
  children,
}: {
  endpoint: string;
  fields: FieldSpec[];
  body?: Record<string, unknown>;
  label?: string;
  navigate?: boolean;
  confirmMessage?: string;
  variant?: "primary" | "secondary" | "danger";
  children?: React.ReactNode;
}) {
  const prefix = useId(),
    router = useRouter();
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const busy = pending || refreshing;
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<string[]>([]);
  function imageBusy(name: string, busy: boolean) {
    setUploads((current) =>
      busy
        ? [...new Set([...current, name])]
        : current.filter((field) => field !== name),
    );
  }
  const alert = useRef<HTMLDivElement>(null);
  const classNameButton = `button ${variant}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || uploads.length) return;
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
      startRefresh(() => {
        if (navigate && result.next) router.push(result.next);
        router.refresh();
      });
    } catch (error) {
      setError(
        error instanceof TypeError || error instanceof SyntaxError
          ? "تعذر الاتصال. راجع اتصالك وحاول تاني."
          : error instanceof Error
            ? error.message
            : "تعذر الاتصال. حاول تاني.",
      );
      requestAnimationFrame(() => alert.current?.focus());
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="mutation-form"
      onSubmit={submit}
      aria-busy={busy || uploads.length > 0}
    >
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
          disabled: busy || field.disabled,
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
                {field.type === "image" ? (
                  <ImageField
                    key={String(field.value ?? "")}
                    id={id}
                    name={field.name}
                    label={field.label}
                    kind={
                      field.imageKind ??
                      (field.name === "cover" ? "course" : "teacher")
                    }
                    value={String(field.value ?? "")}
                    disabled={busy || field.disabled}
                    describedBy={hint}
                    onBusy={imageBusy}
                  />
                ) : field.type === "textarea" ? (
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
      <button
        type="submit"
        className={classNameButton}
        disabled={busy || uploads.length > 0}
      >
        {uploads.length
          ? "انتظر اكتمال رفع الصورة…"
          : busy
            ? "جاري الإتمام…"
            : label}
      </button>
      {message && (
        <p className="status-message" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
