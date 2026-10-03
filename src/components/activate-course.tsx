"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cairoDate } from "@/lib/time";
type Preview = {
  courseId: string;
  title: string;
  durationDays: number;
  replay: boolean;
  withdrawn: boolean;
};
export function ActivateCourse() {
  const id = useId(),
    router = useRouter(),
    alert = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<{
    message: string;
    courseId: string;
    accessUntil: string;
    withdrawn: boolean;
  } | null>(null);
  async function request(action: "preview" | "activate") {
    if (pending) return;
    setError("");
    setPending(true);
    try {
      const response = await fetch(`/api/codes/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "preview"
            ? { code }
            : { code, courseId: preview?.courseId },
        ),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "الكود غير متاح.");
      if (action === "preview") {
        setPreview(data);
        setResult(null);
      } else {
        setResult(data);
        setPreview(null);
        setCode("");
        router.refresh();
      }
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
    <section
      className="workspace-panel"
      id="activate"
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`}>معاك كود كورس؟</h2>
      {error && (
        <div className="error-summary" role="alert" tabIndex={-1} ref={alert}>
          {error}
        </div>
      )}
      <form
        className="mutation-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void request("preview");
        }}
      >
        <div className="field">
          <label htmlFor={`${id}-code`}>كود الاشتراك</label>
          <input
            id={`${id}-code`}
            name="code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setPreview(null);
              setResult(null);
            }}
            dir="ltr"
            maxLength={100}
            placeholder="DRS-XXXXXXXX-XXXXXXXX-XXXXXXXX"
            autoComplete="off"
            required
            disabled={pending}
          />
        </div>
        <button className="button secondary" type="submit" disabled={pending}>
          {pending ? "جاري المراجعة…" : "راجع الكود"}
        </button>
      </form>
      {preview && (
        <div className="activation-preview" role="status">
          <h3>{preview.title}</h3>
          <p>مدة الكود: {preview.durationDays} يوم من التفعيل.</p>
          {preview.replay && (
            <p className="muted">
              الكود مستخدم لحسابك بالفعل؛ مفيش مدة هتتضاف تاني.
            </p>
          )}
          <button
            className="button primary"
            disabled={pending}
            onClick={() => void request("activate")}
          >
            {preview.replay ? "عرض حالة التفعيل" : "تأكيد تفعيل الكورس"}
          </button>
        </div>
      )}
      {result && (
        <div className="activation-preview" role="status">
          <p>{result.message}</p>
          {!result.withdrawn && (
            <>
              <p className="muted">
                الوصول حتى {cairoDate(result.accessUntil)}
              </p>
              <Link
                className="button primary"
                href={`/learn/${result.courseId}`}
              >
                افتح الكورس
              </Link>
            </>
          )}
        </div>
      )}
    </section>
  );
}
