"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <button
        className="button secondary small"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError("");
          try {
            const response = await fetch("/api/auth/logout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (!response.ok) throw new Error("تعذر الخروج. حاول تاني.");
            router.replace("/login");
            router.refresh();
          } catch (error) {
            setError(error instanceof Error ? error.message : "تعذر الخروج.");
            setPending(false);
          }
        }}
      >
        {pending ? "جاري الخروج…" : "تسجيل الخروج"}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
