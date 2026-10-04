import Form from "next/form";
import Link from "next/link";
import {
  Check,
  MagnifyingGlass,
  SlidersHorizontal,
} from "@phosphor-icons/react/dist/ssr";
import { type CatalogQuery } from "@/lib/catalog";
import { referenceData } from "@/server/catalog/queries";

function CatalogChoices({
  name,
  legend,
  allLabel,
  selected,
  choices,
}: {
  name: "subject" | "grade";
  legend: string;
  allLabel: string;
  selected: string;
  choices: { id: string; label: string }[];
}) {
  return (
    <fieldset className="catalog-choice-group">
      <legend>{legend}</legend>
      <div className="catalog-choice-chips">
        {[{ id: "", label: allLabel }, ...choices].map((choice) => (
          <label className="catalog-choice" key={choice.id}>
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={choice.id}
              defaultChecked={selected === choice.id}
            />
            <Check
              className="catalog-choice-check"
              size={16}
              aria-hidden="true"
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

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
      className="filter-panel catalog-filter-panel"
      key={`${query.q}/${query.subject}/${query.grade}`}
    >
      <div className="field search-field catalog-search-field">
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
      <CatalogChoices
        name="grade"
        legend="صفك الدراسي"
        allLabel="كل الصفوف"
        selected={query.grade ?? ""}
        choices={grades}
      />
      <CatalogChoices
        name="subject"
        legend="المادة"
        allLabel="كل المواد"
        selected={query.subject ?? ""}
        choices={subjects}
      />
      <button className="button primary filter-submit" type="submit">
        <SlidersHorizontal size={20} aria-hidden="true" />
        اعرض النتايج
      </button>
      {active && (
        <Link className="button ghost filter-clear" href={action}>
          مسح الفلاتر
        </Link>
      )}
    </Form>
  );
}
