"use client";
import { useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import styles from "./image-field.module.css";

export function ImageField({
  id,
  name,
  label,
  value,
  kind,
  disabled,
  describedBy,
  onBusy,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  kind: "teacher" | "course";
  disabled?: boolean;
  describedBy?: string;
  onBusy: (name: string, busy: boolean) => void;
}) {
  const [ref, setRef] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 4 * 1024 * 1024 ||
      !file.size
    ) {
      setError("اختار JPG أو PNG أو WebP، حجمها ٤ ميجابايت أو أقل.");
      return;
    }
    setBusy(true);
    onBusy(name, true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      const response = await fetch("/api/admin/images", {
        method: "POST",
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "تعذر رفع الصورة.");
      setRef(result.ref);
    } catch (error) {
      setError(
        error instanceof TypeError || error instanceof SyntaxError
          ? "تعذر رفع الصورة. راجع اتصالك وحاول تاني."
          : error instanceof Error
            ? error.message
            : "تعذر رفع الصورة. حاول تاني.",
      );
    } finally {
      setBusy(false);
      onBusy(name, false);
    }
  }
  return (
    <div className={styles.field} aria-busy={busy}>
      <input type="hidden" name={name} value={ref} />
      <div
        className={`${styles.preview} ${kind === "teacher" ? styles.portrait : styles.cover}`}
      >
        {ref ? (
          <Image
            src={ref}
            alt={`معاينة ${label}`}
            width={kind === "teacher" ? 144 : 440}
            height={kind === "teacher" ? 144 : 248}
            unoptimized
          />
        ) : (
          <span>
            {kind === "teacher" ? "أضف صورة المدرس" : "أضف غلاف الكورس"}
          </span>
        )}
      </div>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={upload}
        disabled={disabled || busy}
        className={styles.file}
        aria-describedby={describedBy}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className="button secondary"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "جاري رفع الصورة…" : ref ? "تغيير الصورة" : "رفع صورة"}
        </button>
        {ref && (
          <button
            type="button"
            className="button danger"
            disabled={disabled || busy}
            onClick={() => {
              setRef("");
              setError("");
            }}
          >
            إزالة الصورة
          </button>
        )}
      </div>
      <p className="field-hint">
        JPG أو PNG أو WebP · حتى ٤ ميجابايت.{" "}
        {kind === "course"
          ? "الأفضل غلاف أفقي بنسبة ١٦:٩."
          : "الأفضل صورة مربعة واضحة."}{" "}
        احفظ البيانات لتأكيد التغيير.
      </p>
      {error && (
        <p className="error-summary" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
