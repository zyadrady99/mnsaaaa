"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fromCairoInput } from "@/lib/time";
export function CodeGenerateForm({
  courses,
}: {
  courses: { id: string; title: string }[];
}) {
  const prefix = useId(),
    router = useRouter(),
    request = useRef<{ payload: string; id: string } | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const alert = useRef<HTMLDivElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const body = {
        courseId: String(form.get("course")),
        durationDays: Number(form.get("duration")),
        quantity: Number(form.get("quantity")),
        activateBefore: fromCairoInput(String(form.get("deadline") ?? "")),
      };
      const payload = JSON.stringify(body);
      if (!request.current || request.current.payload !== payload)
        request.current = { payload, id: crypto.randomUUID() };
      const response = await fetch("/api/admin/codes-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestId: request.current.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "تعذر إنشاء الدفعة.");
      router.push(result.next);
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
        <label htmlFor={`${prefix}-course`}>الكورس</label>
        <select id={`${prefix}-course`} name="course" defaultValue="" required>
          <option value="" disabled>
            اختار كورسًا منشورًا
          </option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>
      <div className="editor-columns">
        <div className="field">
          <label htmlFor={`${prefix}-duration`}>مدة الوصول</label>
          <select id={`${prefix}-duration`} name="duration" defaultValue="30">
            {[30, 60, 90].map((days) => (
              <option key={days} value={days}>
                {days} يوم
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-quantity`}>عدد الأكواد</label>
          <input
            id={`${prefix}-quantity`}
            name="quantity"
            type="number"
            defaultValue={10}
            min={1}
            max={500}
            required
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-deadline`}>آخر موعد للتفعيل، اختياري</label>
        <input
          id={`${prefix}-deadline`}
          name="deadline"
          type="datetime-local"
        />
        <p className="field-hint">
          بتوقيت القاهرة. لو فارغ، الكود يفضل صالحًا لحد الاستخدام أو الإلغاء.
        </p>
      </div>
      <button
        className="button primary"
        type="submit"
        disabled={pending || !courses.length}
      >
        {pending ? "جاري الإنشاء…" : "إنشاء دفعة الأكواد"}
      </button>
    </form>
  );
}
