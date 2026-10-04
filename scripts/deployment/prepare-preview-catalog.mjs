import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grades, subjects, teachers, courses } from "../../src/lib/catalog.ts";
import { projectPath, projectRoot } from "../shared/paths.mjs";

const fixtureCatalog = { grades, subjects, teachers, courses };
const expectedCounts = {
  grades: 3,
  subjects: 4,
  teachers: 4,
  courses: 8,
  course_units: 12,
  lessons: 33,
};
const migrationFiles = [
  "20261002193221_dorosna_product.sql",
  "20261003173546_standalone_assessments.sql",
  "20261003173551_catalog_delete.sql",
  "20261003173556_media_assets.sql",
];
const migrationNames = migrationFiles.map((file) =>
  file.replace(/^\d+_/, "").replace(/\.sql$/, ""),
);
const targetTables = Object.keys(expectedCounts);

export function sqlText(value) {
  assert.equal(typeof value, "string", "SQL text values must be strings.");
  assert.ok(!value.includes("\0"), "PostgreSQL text cannot contain NUL.");
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlJSON(value) {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function requireText(value, label) {
  assert.ok(typeof value === "string" && value.trim(), `${label} is required.`);
  sqlText(value);
}

function uniqueSlugs(rows, key, label) {
  const slugs = new Set();
  for (const row of rows) {
    assert.match(row[key], /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${label} slug`);
    assert.ok(!slugs.has(row[key]), `${label} contains a duplicate slug.`);
    slugs.add(row[key]);
  }
  return slugs;
}

export function validatePreviewCatalog(catalog = fixtureCatalog) {
  const counts = {
    grades: catalog.grades.length,
    subjects: catalog.subjects.length,
    teachers: catalog.teachers.length,
    courses: catalog.courses.length,
    course_units: catalog.courses.reduce(
      (n, course) => n + course.units.length,
      0,
    ),
    lessons: catalog.courses.reduce(
      (n, course) =>
        n +
        course.units.reduce((total, unit) => total + unit.lessons.length, 0),
      0,
    ),
  };
  assert.deepEqual(counts, expectedCounts, "The approved demo counts changed.");
  const gradeSlugs = uniqueSlugs(catalog.grades, "id", "Grades");
  const subjectSlugs = uniqueSlugs(catalog.subjects, "id", "Subjects");
  const teacherSlugs = uniqueSlugs(catalog.teachers, "slug", "Teachers");
  uniqueSlugs(catalog.courses, "slug", "Courses");
  const assets = new Set();
  function image(ref) {
    assert.match(
      ref,
      /^\/images\/[a-z0-9-]+\.svg$/,
      "Only approved static SVGs.",
    );
    assets.add(ref);
  }
  for (const grade of catalog.grades) requireText(grade.label, "Grade name");
  for (const subject of catalog.subjects)
    requireText(subject.label, "Subject name");
  for (const teacher of catalog.teachers) {
    requireText(teacher.name, "Teacher name");
    requireText(teacher.description, "Teacher biography");
    assert.ok(subjectSlugs.has(teacher.subject), "Unknown teacher subject.");
    assert.ok(teacher.grades.every((grade) => gradeSlugs.has(grade)));
    assert.ok(Array.isArray(teacher.approach));
    teacher.approach.forEach((text) => requireText(text, "Teaching approach"));
    image(teacher.portrait);
  }
  for (const course of catalog.courses) {
    requireText(course.title, "Course title");
    requireText(course.subtitle, "Course subtitle");
    assert.ok(teacherSlugs.has(course.teacherSlug), "Unknown course teacher.");
    assert.ok(gradeSlugs.has(course.grade), "Unknown course grade.");
    assert.ok(subjectSlugs.has(course.subject), "Unknown course subject.");
    assert.ok(
      catalog.teachers.find((teacher) => teacher.slug === course.teacherSlug)
        .subject === course.subject,
      "Course subject must match its teacher.",
    );
    assert.ok(Array.isArray(course.outcomes));
    course.outcomes.forEach((text) => requireText(text, "Course outcome"));
    image(course.cover);
    assert.ok(course.units.length > 0);
    for (const unit of course.units) {
      requireText(unit.title, "Unit title");
      assert.ok(unit.lessons.length > 0);
      for (const lesson of unit.lessons) {
        requireText(lesson.title, "Lesson title");
        assert.ok(Number.isSafeInteger(lesson.minutes) && lesson.minutes > 0);
      }
    }
  }
  return { counts, assets: [...assets].sort() };
}

function idBySlug(table, slug) {
  assert.ok(["grades", "subjects", "teachers", "courses"].includes(table));
  return `(select id from app_private.${table} where slug = ${sqlText(slug)})`;
}

function insert(table, columns, values) {
  assert.ok(targetTables.includes(table));
  return `insert into app_private.${table} (${columns.join(", ")})\nvalues (${values.join(", ")});`;
}

export function previewCatalogSQL(projectRef, catalog = fixtureCatalog) {
  assert.match(
    projectRef,
    /^[a-z][a-z0-9]{19}$/,
    "Explicit project ref required.",
  );
  validatePreviewCatalog(catalog);
  const blocks = [
    `-- Offline demo catalog for intended Supabase project: ${projectRef}
-- This annotation does not verify the connected project's identity.
-- Review the manifest and select the exact project in the connector before applying.
-- 3 grades, 4 subjects, 4 fictional teachers, 8 draft courses, 12 units, 33 draft lessons.
-- No accounts, access codes, results, video uploads or publication timestamps.
begin isolation level read committed;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local standard_conforming_strings = on;
set local search_path = pg_catalog;
select pg_advisory_xact_lock(hashtextextended('dorosna-preview-catalog-seed', 0));

do $preview_schema$
declare required_name text; required_table text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'preview_catalog_migration_history_missing';
  end if;
  foreach required_name in array array[${migrationNames.map(sqlText).join(", ")}] loop
    if not exists (select 1 from supabase_migrations.schema_migrations where name = required_name) then
      raise exception 'preview_catalog_required_migration_missing: %', required_name;
    end if;
  end loop;
  foreach required_table in array array[${[...targetTables, "assessments", "media_assets"].map(sqlText).join(", ")}] loop
    if to_regclass(format('app_private.%I', required_table)) is null then
      raise exception 'preview_catalog_required_table_missing: %', required_table;
    end if;
  end loop;
  if exists (
    select 1 from (values
      ('grades', 'slug'), ('subjects', 'slug'), ('subjects', 'enabled'),
      ('teachers', 'slug'), ('teachers', 'subject_id'), ('teachers', 'approach'),
      ('courses', 'slug'), ('courses', 'subtitle'), ('courses', 'outcomes'),
      ('lessons', 'minutes'), ('assessments', 'scope'), ('assessments', 'status'),
      ('media_assets', 'content_type'),
      ${targetTables.map((table) => `(${sqlText(table)}, 'deleted_at')`).join(",\n      ")}
    ) as required(table_name, column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'app_private' and c.table_name = required.table_name
        and c.column_name = required.column_name
    )
  ) then
    raise exception 'preview_catalog_schema_incomplete';
  end if;
end
$preview_schema$;

-- Readers can continue; competing writes wait until this short transaction ends.
lock table ${targetTables.map((table) => `app_private.${table}`).join(", ")}
  in share row exclusive mode;

do $preview_empty$
begin
  if ${targetTables.map((table) => `exists (select 1 from app_private.${table})`).join("\n    or ")} then
    raise exception 'preview_catalog_not_empty_existing_data_preserved';
  end if;
end
$preview_empty$;`,
  ];
  for (const [index, grade] of catalog.grades.entries()) {
    blocks.push(
      insert(
        "grades",
        ["id", "slug", "name", "sort_order", "enabled"],
        [
          "gen_random_uuid()",
          sqlText(grade.id),
          sqlText(grade.label),
          String(index + 1),
          "true",
        ],
      ),
    );
  }
  for (const subject of catalog.subjects) {
    blocks.push(
      insert(
        "subjects",
        ["id", "slug", "name", "enabled"],
        [
          "gen_random_uuid()",
          sqlText(subject.id),
          sqlText(subject.label),
          "true",
        ],
      ),
    );
  }
  for (const teacher of catalog.teachers) {
    blocks.push(
      insert(
        "teachers",
        [
          "id",
          "slug",
          "name",
          "subject_id",
          "biography",
          "image_ref",
          "approach",
          "enabled",
        ],
        [
          "gen_random_uuid()",
          sqlText(teacher.slug),
          sqlText(teacher.name),
          idBySlug("subjects", teacher.subject),
          sqlText(teacher.description),
          sqlText(teacher.portrait),
          sqlJSON(teacher.approach),
          "true",
        ],
      ),
    );
  }
  for (const course of catalog.courses) {
    blocks.push(
      insert(
        "courses",
        [
          "id",
          "slug",
          "teacher_id",
          "grade_id",
          "subject_id",
          "title",
          "description",
          "subtitle",
          "cover_ref",
          "outcomes",
          "status",
          "delivery_environment",
        ],
        [
          "gen_random_uuid()",
          sqlText(course.slug),
          idBySlug("teachers", course.teacherSlug),
          idBySlug("grades", course.grade),
          idBySlug("subjects", course.subject),
          sqlText(course.title),
          sqlText(course.subtitle),
          sqlText(course.subtitle),
          sqlText(course.cover),
          sqlJSON(course.outcomes),
          "'draft'",
          "'development'",
        ],
      ),
    );
    let lessonPosition = 0;
    for (const [unitIndex, unit] of course.units.entries()) {
      blocks.push(
        insert(
          "course_units",
          ["id", "course_id", "title", "position"],
          [
            "gen_random_uuid()",
            idBySlug("courses", course.slug),
            sqlText(unit.title),
            String(unitIndex + 1),
          ],
        ),
      );
      for (const lesson of unit.lessons) {
        blocks.push(
          insert(
            "lessons",
            ["id", "course_id", "unit_id", "position", "title", "minutes"],
            [
              "gen_random_uuid()",
              idBySlug("courses", course.slug),
              `(select id from app_private.course_units where course_id = ${idBySlug("courses", course.slug)} and position = ${unitIndex + 1})`,
              String(++lessonPosition),
              sqlText(lesson.title),
              String(lesson.minutes),
            ],
          ),
        );
      }
    }
  }
  blocks.push(`do $preview_verify$
begin
  if ${Object.entries(expectedCounts)
    .map(
      ([table, count]) =>
        `(select count(*) from app_private.${table}) <> ${count}`,
    )
    .join("\n    or ")} then
    raise exception 'preview_catalog_count_mismatch';
  end if;
  if exists (select 1 from app_private.courses where status <> 'draft' or published_at is not null or archived_at is not null)
    or exists (select 1 from app_private.lessons where published_at is not null or first_used_at is not null or current_video_id is not null) then
    raise exception 'preview_catalog_must_remain_unpublished';
  end if;
end
$preview_verify$;

commit;
`);
  return blocks.join("\n\n");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function fileHash(relativePath) {
  return {
    path: relativePath,
    sha256: sha256(await readFile(projectPath(relativePath))),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "node scripts/deployment/prepare-preview-catalog.mjs --project-ref <ref> [--check]\nGenerates offline SQL and a hash manifest. --check validates without writing files.",
    );
    return;
  }
  const refIndex = args.indexOf("--project-ref");
  assert.ok(
    refIndex !== -1 && args[refIndex + 1],
    "Pass --project-ref explicitly.",
  );
  const projectRef = args[refIndex + 1];
  const remaining = args.filter(
    (_, index) => index !== refIndex && index !== refIndex + 1,
  );
  assert.ok(
    remaining.length <= 1 && remaining.every((arg) => arg === "--check"),
    "Unknown or repeated arguments.",
  );
  const sql = previewCatalogSQL(projectRef);
  const { counts, assets } = validatePreviewCatalog();
  const [generator, source, migrations, images] = await Promise.all([
    fileHash("scripts/deployment/prepare-preview-catalog.mjs"),
    fileHash("src/lib/catalog.ts"),
    Promise.all(
      migrationFiles.map((file) => fileHash(`supabase/migrations/${file}`)),
    ),
    Promise.all(assets.map((ref) => fileHash(`public${ref}`))),
  ]);
  const manifest = {
    formatVersion: 1,
    intendedProjectRef: projectRef,
    connectionIdentityVerified: false,
    databaseContacted: false,
    counts,
    courseStatus: "draft",
    deliveryEnvironment: "development",
    publishedCourses: 0,
    publishedLessons: 0,
    videoUploads: 0,
    accountsImported: 0,
    requiredMigrationNames: migrationNames,
    sql: {
      path: ".local/deployment-preview/preview-catalog.sql",
      sha256: sha256(sql),
    },
    generator,
    source,
    migrations,
    images,
  };
  if (!remaining.includes("--check")) {
    const output = projectPath(".local", "deployment-preview");
    await mkdir(output, { recursive: true });
    const relative = path.relative(
      await realpath(projectRoot),
      await realpath(output),
    );
    assert.ok(
      relative &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative),
      "Output must remain within the project.",
    );
    await writeFile(path.join(output, "preview-catalog.sql"), sql, "utf8");
    await writeFile(
      path.join(output, "preview-catalog.manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(
    JSON.stringify({
      generated: !remaining.includes("--check"),
      intendedProjectRef: projectRef,
      databaseContacted: false,
      counts,
      sqlSha256: manifest.sql.sha256,
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch {
    console.error(
      "Preview catalog preparation failed. Check --project-ref, demo data, image files and local output permissions. No database was contacted.",
    );
    process.exitCode = 1;
  }
}
