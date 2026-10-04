import type { Metadata } from "next";
import { TeacherCard } from "@/components/catalog/cards";
import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { EmptyState } from "@/components/common/empty-state";
import { Breadcrumbs, PageHeading } from "@/components/common/page-heading";
import { arabicNumber } from "@/lib/catalog";
import {
  publicCatalog,
  catalogQuery,
  matchingTeachers,
} from "@/server/catalog/queries";

export const metadata: Metadata = { title: "المدرسون" };
export default async function Teachers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await catalogQuery(await searchParams);
  const results = matchingTeachers((await publicCatalog()).teachers, query);
  return (
    <>
      <Breadcrumbs items={[{ label: "المدرسون" }]} />
      <PageHeading
        eyebrow="افهمها مع مدرسك"
        title="مدرسون لكل خطوة"
        description="اتعرّف على طريقة شرح المدرس، وشوف كورساته المتاحة."
      />
      <CatalogFilters action="/teachers" query={query} kind="teachers" />
      <p className="result-count" role="status">
        {arabicNumber(results.length)} مدرسين
        {query.q ? ` لبحث «${query.q}»` : " متاحين"}
      </p>
      {results.length ? (
        <section aria-labelledby="teacher-results-heading">
          <h2 id="teacher-results-heading" className="sr-only">
            نتائج المدرسين
          </h2>
          <div className="teacher-grid">
            {results.map((teacher) => (
              <TeacherCard teacher={teacher} key={teacher.slug} />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          title="مفيش مدرسين بالاختيارات دي"
          description="جرّب البحث باسم المدرس، أو اختار مادة وصف مختلفين."
          href="/teachers"
          action="عرض كل المدرسين"
        />
      )}
    </>
  );
}
