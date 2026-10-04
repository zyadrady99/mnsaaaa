import "server-only";
import { cache } from "react";
import { database } from "@/server/core/db";
import {
  type Course,
  type Teacher,
  type GradeId,
  type CatalogQuery,
  normalizeSearch,
} from "@/lib/catalog";

export type Reference = {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
};
export const referenceData = cache(async () => {
  const [grades, subjects] = await Promise.all([
    database().query<Reference>(
      "select id,slug,name,enabled from app_private.grades where deleted_at is null order by sort_order",
    ),
    database().query<Reference>(
      "select id,slug,name,enabled from app_private.subjects where deleted_at is null order by name",
    ),
  ]);
  return { grades: grades.rows, subjects: subjects.rows };
});
export const publicCatalog = cache(async () => {
  const rows = (
    await database()
      .query(`select c.id,c.slug,c.title,c.subtitle,c.cover_ref,c.outcomes,
    g.slug as grade,g.name as grade_name,s.slug as subject,s.name as subject_name,
    t.id as teacher_id,t.slug as teacher_slug,t.name as teacher_name,t.biography,t.image_ref,t.approach,
    coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'title',u.title,'lessons',
      coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'minutes',l.minutes) order by l.position)
        from app_private.lessons l where l.unit_id=u.id and l.published_at is not null and l.deleted_at is null),'[]'::jsonb)) order by u.position)
      from app_private.course_units u where u.course_id=c.id and u.deleted_at is null and exists(select 1 from app_private.lessons l where l.unit_id=u.id and l.published_at is not null and l.deleted_at is null)),'[]'::jsonb) as units
    from app_private.courses c join app_private.teachers t on t.id=c.teacher_id
    join app_private.grades g on g.id=c.grade_id join app_private.subjects s on s.id=c.subject_id
    where c.status='published' and c.deleted_at is null and t.deleted_at is null and g.deleted_at is null and s.deleted_at is null and t.enabled and g.enabled and s.enabled order by c.published_at desc,c.id`)
  ).rows;
  const courses: Course[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    cover: row.cover_ref ?? "",
    outcomes: row.outcomes,
    units: row.units,
    grade: row.grade as GradeId,
    gradeName: row.grade_name,
    subject: row.subject,
    subjectName: row.subject_name,
    teacherSlug: row.teacher_slug,
    teacher: {
      id: row.teacher_id,
      slug: row.teacher_slug,
      name: row.teacher_name,
      subject: row.subject,
      subjectName: row.subject_name,
      grades: [],
      portrait: row.image_ref ?? "",
      description: row.biography,
      approach: row.approach,
    },
  }));
  const teacherRows = (
    await database()
      .query(`select t.id,t.slug,t.name,t.biography,t.image_ref,t.approach,s.slug as subject,s.name as subject_name
    from app_private.teachers t join app_private.subjects s on s.id=t.subject_id where t.deleted_at is null and s.deleted_at is null and t.enabled and s.enabled order by t.name`)
  ).rows;
  const teachers: Teacher[] = teacherRows.map((row) => {
    const owned = courses.filter((course) => course.teacherSlug === row.slug);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.biography,
      portrait: row.image_ref ?? "",
      approach: row.approach,
      subject: row.subject,
      subjectName: row.subject_name,
      courseCount: owned.length,
      grades: [...new Set(owned.map((c) => c.grade))],
      gradeNames: [...new Set(owned.map((c) => c.gradeName!))],
    };
  });
  return { courses, teachers };
});
export async function getPublishedCourse(slug: string) {
  return (await publicCatalog()).courses.find((course) => course.slug === slug);
}
export async function getPublicTeacher(slug: string) {
  return (await publicCatalog()).teachers.find(
    (teacher) => teacher.slug === slug,
  );
}
export async function catalogQuery(
  params: Record<string, string | string[] | undefined>,
): Promise<CatalogQuery> {
  const refs = await referenceData();
  const first = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : value?.[0];
  return {
    q: first(params.q)?.slice(0, 100).trim() ?? "",
    subject: refs.subjects.some(
      (s) => s.enabled && s.slug === first(params.subject),
    )
      ? first(params.subject)
      : "",
    grade: refs.grades.some((g) => g.enabled && g.slug === first(params.grade))
      ? first(params.grade)
      : "",
  };
}
export function matchingCourses(courses: Course[], query: CatalogQuery) {
  const q = normalizeSearch(query.q ?? "");
  return courses.filter(
    (c) =>
      (!query.grade || c.grade === query.grade) &&
      (!query.subject || c.subject === query.subject) &&
      (!q ||
        normalizeSearch(
          `${c.title} ${c.teacher?.name} ${c.subjectName}`,
        ).includes(q)),
  );
}
export function matchingTeachers(teachers: Teacher[], query: CatalogQuery) {
  const q = normalizeSearch(query.q ?? "");
  return teachers.filter(
    (t) =>
      (!query.subject || t.subject === query.subject) &&
      (!query.grade || t.grades.includes(query.grade as GradeId)) &&
      (!q || normalizeSearch(`${t.name} ${t.subjectName}`).includes(q)),
  );
}
