import { randomUUID } from "node:crypto";
import pg from "pg";
import { localSettings } from "../shared/local-stack.mjs";
import { grades, subjects, teachers, courses } from "../../src/lib/catalog.ts";

const settings = localSettings();
const db = new pg.Client({ connectionString: settings.DB_URL });
try {
  await db.connect();
  await db.query("begin");
  await db.query(
    "select pg_advisory_xact_lock(hashtextextended('dorosna-local-seed',0))",
  );
  if ((await db.query("select id from app_private.grades limit 1")).rowCount) {
    await db.query("commit");
    console.log(
      JSON.stringify({ seeded: false, existingCatalogPreserved: true }),
    );
  } else {
    const gradeIds = new Map(),
      subjectIds = new Map(),
      teacherIds = new Map();
    for (const [i, g] of grades.entries()) {
      const id = randomUUID();
      gradeIds.set(g.id, id);
      await db.query(
        "insert into app_private.grades(id,slug,name,sort_order) values($1,$2,$3,$4)",
        [id, g.id, g.label, i + 1],
      );
    }
    for (const s of subjects) {
      const id = randomUUID();
      subjectIds.set(s.id, id);
      await db.query(
        "insert into app_private.subjects(id,slug,name) values($1,$2,$3)",
        [id, s.id, s.label],
      );
    }
    for (const t of teachers) {
      const id = randomUUID();
      teacherIds.set(t.slug, id);
      await db.query(
        `insert into app_private.teachers(id,slug,name,subject_id,biography,image_ref,approach)
        values($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          t.slug,
          t.name,
          subjectIds.get(t.subject),
          t.description,
          t.portrait,
          JSON.stringify(t.approach),
        ],
      );
    }
    for (const c of courses) {
      const id = randomUUID();
      await db.query(
        `insert into app_private.courses(id,slug,teacher_id,grade_id,subject_id,title,description,subtitle,cover_ref,outcomes)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          c.slug,
          teacherIds.get(c.teacherSlug),
          gradeIds.get(c.grade),
          subjectIds.get(c.subject),
          c.title,
          c.subtitle,
          c.subtitle,
          c.cover,
          JSON.stringify(c.outcomes),
        ],
      );
      let position = 0;
      for (const [i, u] of c.units.entries()) {
        const unit = randomUUID();
        await db.query(
          "insert into app_private.course_units(id,course_id,title,position) values($1,$2,$3,$4)",
          [unit, id, u.title, i + 1],
        );
        for (const l of u.lessons)
          await db.query(
            "insert into app_private.lessons(course_id,unit_id,position,title,minutes) values($1,$2,$3,$4,$5)",
            [id, unit, ++position, l.title, l.minutes],
          );
      }
    }
    await db.query("commit");
    console.log(
      JSON.stringify({
        seeded: true,
        grades: grades.length,
        teachers: teachers.length,
        draftCourses: courses.length,
      }),
    );
  }
} catch {
  await db.query("rollback").catch(() => {});
  console.error("Local catalog seed failed; existing data was preserved.");
  process.exitCode = 1;
} finally {
  await db.end();
}
