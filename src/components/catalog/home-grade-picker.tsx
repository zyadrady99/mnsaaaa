"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, GraduationCap } from "@phosphor-icons/react/dist/ssr";
import { arabicNumber } from "@/lib/catalog";

export function HomeGradePicker({
  grades,
}: {
  grades: { id: string; label: string }[];
}) {
  const searchParams = useSearchParams();
  const selected = searchParams.get("grade");
  return (
    <div className="hero-grade-picker">
      <p className="grade-picker-label">إنت في سنة كام؟</p>
      <div aria-label="اختار صفك الدراسي">
        {grades.map((grade) => {
          const year = grade.id.match(/^g([1-3])$/)?.[1];
          return (
            <Link
              key={grade.id}
              href={`/?grade=${encodeURIComponent(grade.id)}#discover`}
              aria-current={selected === grade.id ? "true" : undefined}
              data-selected={selected === grade.id}
            >
              <span aria-hidden="true">
                {year ? (
                  arabicNumber(Number(year))
                ) : (
                  <GraduationCap size={18} />
                )}
              </span>
              {grade.label}
              {selected === grade.id && <Check size={14} aria-hidden="true" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
