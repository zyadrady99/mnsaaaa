import type { Metadata } from "next";
import { CourseCard } from "@/components/catalog/cards";
import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { EmptyState } from "@/components/common/empty-state";
import { Breadcrumbs, PageHeading } from "@/components/common/page-heading";
import { courseCountText } from "@/lib/catalog";
import {
  publicCatalog,
  catalogQuery,
  matchingCourses,
} from "@/server/catalog/queries";

export const metadata: Metadata = { title: "الكورسات" };
export default async function Courses({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await catalogQuery(await searchParams);
  const results = matchingCourses((await publicCatalog()).courses, query);
  return (
    <>
      <Breadcrumbs items={[{ label: "الكورسات" }]} />
      <PageHeading
        eyebrow="مساحة للتعلّم"
        title="اختار الكورس المناسب ليك"
        description="دوّر بالمادة أو المدرس، واختار صفك علشان توصل أسرع."
      />
      <CatalogFilters action="/courses" query={query} kind="courses" />
      <p className="result-count" role="status">
        {courseCountText(results.length)}
        {query.q
          ? ` لبحث «${query.q}»`
          : results.length === 1
            ? " متاح للاستكشاف"
            : results.length === 2
              ? " متاحين للاستكشاف"
              : " متاحة للاستكشاف"}
      </p>
      {results.length ? (
        <section aria-labelledby="course-results-heading">
          <h2 id="course-results-heading" className="sr-only">
            نتائج الكورسات
          </h2>
          <div className="course-grid">
            {results.map((course) => (
              <CourseCard course={course} key={course.slug} />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          title="مفيش كورسات بالاختيارات دي"
          description="جرّب اسم أقصر أو غيّر المادة والصف الدراسي."
          href="/courses"
          action="عرض كل الكورسات"
        />
      )}
    </>
  );
}
