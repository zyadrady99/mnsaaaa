import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { courses as demoCourses } from "../src/lib/catalog.ts";
process.loadEnvFile(".env.local");
const origin = "http://127.0.0.1:3000";
if (process.env.DOROSNA_LOCAL_ONLY !== "1" || process.env.APP_ORIGIN !== origin)
  throw new Error("Local demo only.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const admin = JSON.parse(readFileSync(".local/admin-account.json", "utf8"));
let cookie = "";
async function post(action, body, adminRoute = true) {
  const response = await fetch(
    `${origin}/api/${adminRoute ? "admin" : "auth"}/${action}`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `Demo operation rejected: ${action} (${data.error ?? response.status})`,
    );
  if (!adminRoute && action === "login")
    cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  return data;
}
const questions = [
  {
    prompt: "سؤال تجريبي: حاصل جمع ٢ + ٣ يساوي كام؟",
    options: ["٥", "٦", "٧"],
    correct: 0,
    points: 7,
    explanation: "٢ + ٣ = ٥. السؤال للتجربة المحلية فقط.",
  },
  {
    prompt: "سؤال تجريبي: حاصل ضرب ٤ × ٢ يساوي كام؟",
    options: ["٦", "٨", "١٠"],
    correct: 1,
    points: 3,
    explanation: "٤ × ٢ = ٨. السؤال للتجربة المحلية فقط.",
  },
];
let completed = 0;
try {
  await db.connect();
  await post("login", { phone: admin.phone, password: admin.password }, false);
  const courses = (
    await db.query(
      "select id from app_private.courses where status='draft' and slug=any($1::text[]) order by title",
      [demoCourses.map((c) => c.slug)],
    )
  ).rows;
  for (const course of courses) {
    const lessons = (
      await db.query(
        "select id,title,published_at from app_private.lessons where course_id=$1 order by position",
        [course.id],
      )
    ).rows;
    if (!lessons.length) continue;
    for (const lesson of lessons) {
      if (lesson.published_at) continue;
      await post("video-fixture", { lessonId: lesson.id });
      let assessment = (
        await db.query(
          "select id,current_version_id from app_private.assessments where lesson_id=$1 and kind='homework'",
          [lesson.id],
        )
      ).rows[0];
      if (!assessment) {
        const saved = await post("assessment-save", {
          courseId: course.id,
          lessonId: lesson.id,
          kind: "homework",
          title: `واجب تجريبي — ${lesson.title}`,
          questions,
        });
        await post("assessment-publish", { versionId: saved.versionId });
      } else if (!assessment.current_version_id) {
        const latest = (
          await db.query(
            "select id from app_private.assessment_versions where assessment_id=$1 and published_at is null order by version_number desc limit 1",
            [assessment.id],
          )
        ).rows[0];
        if (!latest) throw new Error("Incomplete existing demo assessment.");
        await post("assessment-publish", { versionId: latest.id });
      }
      await post("lesson-publish", { lessonId: lesson.id });
      completed++;
    }
    await post("course-publish", { id: course.id });
  }
  await post("logout", {}, false);
  console.log(
    JSON.stringify({
      localDemoReady: true,
      publishedLessons: completed,
      paidVideoService: false,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error &&
      error.message.startsWith("Demo operation rejected:")
      ? error.message
      : "Local demo preparation stopped at an incomplete boundary.",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
