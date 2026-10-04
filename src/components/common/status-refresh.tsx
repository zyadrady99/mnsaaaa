"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function StatusRefresh({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [pending, router]);
  return null;
}
