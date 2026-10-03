import Form from "next/form";
import Link from "next/link";
import {
  MagnifyingGlass,
  SlidersHorizontal,
} from "@phosphor-icons/react/dist/ssr";
import { type CatalogQuery } from "@/lib/catalog";
import { referenceData } from "@/server/catalog";

export async function CatalogFilters({
  action,
  query,
  kind,
}: {
  action: string;
  query: CatalogQuery;
  kind: "courses" | "teachers";
}) {
  const references = await referenceData();
  const subjects = references.subjects
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.slug, label: s.name }));
  const grades = references.grades
    .filter((g) => g.enabled)
    .map((g) => ({ id: g.slug, label: g.name }));
  const active = Boolean(query.q || query.subject || query.grade);
  return (
    <Form
      action={action}
      className="filter-panel"
      key={`${query.q}/${query.subject}/${query.grade}`}
    >
      <div className="field search-field">
        <label htmlFor="catalog-q">
          {kind === "courses" ? "ابحث عن كورس" : "ابحث عن مدرس"}
        </label>
        <div className="search-input">
          <MagnifyingGlass size={21} aria-hidden="true" />
          <input
            id="catalog-q"
            name="q"
            type="search"
            maxLength={100}
            defaultValue={query.q}
            placeholder={
              kind === "courses"
                ? "اسم الكورس، المدرس أو المادة"
                : "اسم المدرس أو المادة"
            }
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="catalog-subject">المادة</label>
        <select
          id="catalog-subject"
          name="subject"
          defaultValue={query.subject}
        >
          <option value="">كل المواد</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="catalog-grade">الصف الدراسي</label>
        <select id="catalog-grade" name="grade" defaultValue={query.grade}>
          <option value="">كل الصفوف</option>
          {grades.map((grade) => (
            <option key={grade.id} value={grade.id}>
              {grade.label}
            </option>
          ))}
        </select>
      </div>
      <button className="button primary filter-submit" type="submit">
        <SlidersHorizontal size={20} aria-hidden="true" />
        تطبيق
      </button>
      {active && (
        <Link className="button ghost filter-clear" href={action}>
          مسح الفلاتر
        </Link>
      )}
    </Form>
  );
}
