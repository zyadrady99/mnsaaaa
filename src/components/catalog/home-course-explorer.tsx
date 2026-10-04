"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Atom,
  BookOpen,
  Calculator,
  Check,
  Flask,
  MagnifyingGlass,
  SquaresFour,
  TextAa,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { arabicNumber, normalizeSearch } from "@/lib/catalog";

type ReferenceOption = { id: string; label: string };
type CourseOption = {
  slug: string;
  grade: string;
  subject: string;
  searchText: string;
  card: ReactNode;
};
type Query = { q: string; grade: string; subject: string };
const subjectIcons: Record<string, typeof BookOpen> = {
  physics: Atom,
  chemistry: Flask,
  math: Calculator,
  arabic: TextAa,
};

export function HomeCourseExplorer({
  courses,
  grades,
  subjects,
}: {
  courses: CourseOption[];
  grades: ReferenceOption[];
  subjects: ReferenceOption[];
}) {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState<Query>(() => {
    const grade = searchParams.get("grade") ?? "";
    const subject = searchParams.get("subject") ?? "";
    return {
      q: (searchParams.get("q") ?? "").slice(0, 100),
      grade: grades.some((option) => option.id === grade) ? grade : "",
      subject: subjects.some((option) => option.id === subject) ? subject : "",
    };
  });

  useEffect(() => {
    function restoreQuery() {
      const params = new URLSearchParams(window.location.search);
      const grade = params.get("grade") ?? "";
      const subject = params.get("subject") ?? "";
      setQuery({
        q: (params.get("q") ?? "").slice(0, 100),
        grade: grades.some((option) => option.id === grade) ? grade : "",
        subject: subjects.some((option) => option.id === subject)
          ? subject
          : "",
      });
    }
    window.addEventListener("popstate", restoreQuery);
    return () => window.removeEventListener("popstate", restoreQuery);
  }, [grades, subjects]);

  function updateQuery(patch: Partial<Query>, mode: "push" | "replace") {
    const next = { ...query, ...patch };
    setQuery(next);
    const url = new URL(window.location.href);
    for (const key of ["q", "grade", "subject"] as const) {
      if (next[key]) url.searchParams.set(key, next[key]);
      else url.searchParams.delete(key);
    }
    const href = `${url.pathname}${url.search}${url.hash}`;
    if (
      href !==
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    ) {
      if (mode === "push") window.history.pushState(null, "", href);
      else window.history.replaceState(null, "", href);
    }
  }

  const normalizedQuery = normalizeSearch(query.q);
  const results = courses.filter(
    (course) =>
      (!query.grade || course.grade === query.grade) &&
      (!query.subject || course.subject === query.subject) &&
      (!normalizedQuery ||
        normalizeSearch(course.searchText).includes(normalizedQuery)),
  );
  const active = Boolean(query.q || query.grade || query.subject);
  const gradeName = grades.find((grade) => grade.id === query.grade)?.label;
  const count =
    results.length === 1
      ? "كورس واحد"
      : results.length === 2
        ? "كورسين"
        : `${arabicNumber(results.length)} كورسات`;
  const availability =
    results.length === 1
      ? "متاح للاستكشاف"
      : results.length === 2
        ? "متاحين للاستكشاف"
        : "متاحة للاستكشاف";

  return (
    <section
      className="discovery-section"
      id="discover"
      aria-labelledby="discover-title"
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">خطوتك الجاية</p>
          <h2 id="discover-title">الكورس اللي بتدوّر عليه.</h2>
          <p className="section-description">
            اختار صفك ومادتك، أو اكتب اسم الكورس أو المدرس.
          </p>
        </div>
        <Link href="/courses" className="text-link">
          كل الكورسات
          <ArrowLeft size={19} aria-hidden="true" />
        </Link>
      </div>

      <form
        action="/#discover"
        method="get"
        className="explorer"
        role="search"
        aria-label="ابحث في الكورسات المنشورة"
        onSubmit={(event) => {
          event.preventDefault();
          updateQuery({}, "push");
        }}
      >
        <div className="search-form">
          <label className="search-label" htmlFor="home-course-search">
            اسم الكورس أو المدرس
          </label>
          <div className="search-field">
            <MagnifyingGlass size={22} aria-hidden="true" />
            <input
              id="home-course-search"
              name="q"
              type="search"
              maxLength={100}
              autoComplete="off"
              placeholder="اسم الكورس، المدرس أو المادة"
              value={query.q}
              onChange={(event) =>
                updateQuery({ q: event.target.value }, "replace")
              }
            />
            <button className="button primary search-button" type="submit">
              ابحث
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="filters">
          <fieldset className="filter-group">
            <legend>الصف الدراسي</legend>
            <div className="chip-list grade-filters">
              {[{ id: "", label: "كل الصفوف" }, ...grades].map((grade) => (
                <label key={grade.id} className="filter-chip">
                  <input
                    className="sr-only"
                    type="radio"
                    name="grade"
                    value={grade.id}
                    checked={query.grade === grade.id}
                    onChange={() => updateQuery({ grade: grade.id }, "push")}
                  />
                  <span>{grade.label}</span>
                  <Check
                    className="filter-check"
                    size={14}
                    aria-hidden="true"
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="filter-group subject-group">
            <legend>المادة</legend>
            <div className="chip-list subject-filters">
              {[{ id: "", label: "كل المواد" }, ...subjects].map((subject) => {
                const Icon = subject.id
                  ? (subjectIcons[subject.id] ?? BookOpen)
                  : SquaresFour;
                return (
                  <label key={subject.id} className="filter-chip">
                    <input
                      className="sr-only"
                      type="radio"
                      name="subject"
                      value={subject.id}
                      checked={query.subject === subject.id}
                      onChange={() =>
                        updateQuery({ subject: subject.id }, "push")
                      }
                    />
                    <Icon size={17} aria-hidden="true" />
                    <span>{subject.label}</span>
                    <Check
                      className="filter-check"
                      size={14}
                      aria-hidden="true"
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </form>

      <div className="results-bar">
        <p role="status" aria-live="polite" aria-atomic="true">
          {count}
          {gradeName ? ` · ${gradeName}` : ` ${availability}`}
        </p>
        {active && (
          <Link
            href="/#discover"
            className="text-link home-filter-reset"
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              updateQuery({ q: "", grade: "", subject: "" }, "push");
            }}
          >
            مسح الاختيارات
            <X size={16} aria-hidden="true" />
          </Link>
        )}
      </div>

      {results.length > 0 ? (
        <div className="course-grid">
          {results.map((course) => (
            <Fragment key={course.slug}>{course.card}</Fragment>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            <MagnifyingGlass size={30} aria-hidden="true" />
          </span>
          <h3>
            {courses.length
              ? "لسه ملقيناش كورس بالاختيارات دي."
              : "لسه مفيش كورسات منشورة."}
          </h3>
          <p className="muted">
            {courses.length
              ? "جرّب اسم أقصر، أو غيّر المادة والصف."
              : "لما يتنشر محتوى جديد هتلاقيه هنا. تقدر تتعرف على المدرسين المتاحين."}
          </p>
          <Link
            href={courses.length ? "/#discover" : "/teachers"}
            className="button secondary"
            onClick={(event) => {
              if (
                !courses.length ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              updateQuery({ q: "", grade: "", subject: "" }, "push");
            }}
          >
            {courses.length ? "اعرض كل الكورسات" : "اعرف المدرسين"}
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}
