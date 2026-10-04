import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import pg from "pg";
import { projectPath } from "../shared/paths.mjs";
process.loadEnvFile(projectPath(".env.local"));
const origin = "http://127.0.0.1:3000";
if (process.env.DOROSNA_LOCAL_ONLY !== "1" || process.env.APP_ORIGIN !== origin)
  throw new Error("Local verification only.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const checks = [];
async function api(action, body, cookie = "") {
  const res = await fetch(`${origin}/api/${action}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    data: await res.json(),
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
  };
}
async function ok(action, body, cookie) {
  const r = await api(action, body, cookie);
  assert.ok([200, 201].includes(r.status), `${action}: ${r.data.error}`);
  return r.data;
}
async function upload(
  bytes,
  type,
  cookie = "",
  uploadOrigin = origin,
  kind = "teacher",
) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), "test.png");
  form.append("kind", kind);
  const r = await fetch(`${origin}/api/admin/images`, {
    method: "POST",
    headers: { Origin: uploadOrigin, Cookie: cookie },
    body: form,
  });
  return { status: r.status, data: await r.json() };
}
async function test(name, run) {
  await run();
  checks.push({ name, passed: true });
  console.log("PASS", name);
}
let cookie, teacherId, courseId;
try {
  await db.connect();
  const admin = JSON.parse(
    readFileSync(projectPath(".local/admin-account.json"), "utf8"),
  );
  cookie = (
    await api("auth/login", { phone: admin.phone, password: admin.password })
  ).cookie;
  assert.ok(cookie);
  const png = await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#0f766e" },
  })
    .png()
    .toBuffer();
  const largeDimensions = await sharp({
    create: { width: 4500, height: 4000, channels: 3, background: "#0f766e" },
  })
    .png()
    .toBuffer();
  await test("anonymous_cannot_upload", async () =>
    assert.equal((await upload(png, "image/png")).status, 401));
  await test("upload_requires_same_origin", async () =>
    assert.equal(
      (await upload(png, "image/png", cookie, "https://invalid.example"))
        .status,
      403,
    ));
  await test("svg_and_disguised_svg_are_rejected", async () => {
    assert.equal(
      (
        await upload(
          Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
          "image/svg+xml",
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await upload(
          Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
          "image/png",
          cookie,
        )
      ).status,
      400,
    );
  });
  await test("oversize_file_is_rejected", async () =>
    assert.equal(
      (await upload(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png", cookie))
        .status,
      413,
    ));
  await test("oversize_dimensions_are_rejected", async () =>
    assert.equal(
      (await upload(largeDimensions, "image/png", cookie)).status,
      400,
    ));
  const uploaded = await upload(png, "image/png", cookie);
  let firstRef = uploaded.data.ref,
    secondRef;
  await test("valid_image_is_normalized_and_served", async () => {
    assert.equal(uploaded.status, 201);
    assert.match(firstRef, /^\/media\/images\/[0-9a-f-]{36}$/);
    const r = await fetch(origin + firstRef);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/webp");
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 320);
  });
  const suffix = randomUUID().slice(0, 8);
  const refs = (
    await db.query(
      "select g.id as grade_id,s.id as subject_id from app_private.grades g cross join app_private.subjects s where g.deleted_at is null and g.enabled and s.deleted_at is null and s.enabled limit 1",
    )
  ).rows[0];
  const teacher = {
    name: "تجربة الصور " + suffix,
    slug: "media-" + suffix,
    subjectId: refs.subject_id,
    description: "صورة للتحقق المحلي",
    portrait: firstRef,
    approach: "",
    enabled: true,
  };
  await test("uploaded_teacher_image_is_persisted", async () => {
    teacherId = (await ok("admin/teacher-save", teacher, cookie)).id;
    assert.equal(
      (
        await db.query(
          "select image_ref from app_private.teachers where id=$1",
          [teacherId],
        )
      ).rows[0].image_ref,
      firstRef,
    );
  });
  await test("teacher_image_can_be_replaced", async () => {
    secondRef = (await upload(png, "image/png", cookie)).data.ref;
    assert.notEqual(secondRef, firstRef);
    await ok(
      "admin/teacher-save",
      { ...teacher, id: teacherId, portrait: secondRef },
      cookie,
    );
    assert.equal(
      (
        await db.query(
          "select image_ref from app_private.teachers where id=$1",
          [teacherId],
        )
      ).rows[0].image_ref,
      secondRef,
    );
  });
  const course = {
    title: "تجربة غلاف " + suffix,
    slug: "media-course-" + suffix,
    teacherId,
    gradeId: refs.grade_id,
    subjectId: refs.subject_id,
    description: "",
    subtitle: "",
    cover: secondRef,
    outcomes: "",
  };
  await test("uploaded_course_cover_is_persisted", async () => {
    courseId = (await ok("admin/course-save", course, cookie)).id;
    assert.equal(
      (
        await db.query(
          "select cover_ref from app_private.courses where id=$1",
          [courseId],
        )
      ).rows[0].cover_ref,
      secondRef,
    );
  });
  await test("teacher_and_course_images_can_be_removed", async () => {
    await ok(
      "admin/teacher-save",
      { ...teacher, id: teacherId, portrait: "" },
      cookie,
    );
    await ok(
      "admin/course-save",
      { ...course, id: courseId, cover: "" },
      cookie,
    );
    assert.equal(
      (
        await db.query(
          "select image_ref from app_private.teachers where id=$1",
          [teacherId],
        )
      ).rows[0].image_ref,
      "",
    );
    assert.equal(
      (
        await db.query(
          "select cover_ref from app_private.courses where id=$1",
          [courseId],
        )
      ).rows[0].cover_ref,
      "",
    );
    assert.equal((await fetch(origin + firstRef)).status, 200); // Existing references remain valid.
  });
  await test("arbitrary_and_nonexistent_image_refs_are_rejected", async () => {
    for (const portrait of [
      "/images/../secret.png",
      "https://example.com/a.png",
      `/media/images/${randomUUID()}`,
    ])
      assert.equal(
        (
          await api(
            "admin/teacher-save",
            { ...teacher, id: teacherId, portrait },
            cookie,
          )
        ).status,
        400,
      );
  });
  await test("invalid_media_url_has_no_file_access", async () => {
    assert.equal(
      (await fetch(origin + "/media/images/not-a-uuid")).status,
      404,
    );
    assert.equal(
      (await fetch(origin + "/media/images/" + randomUUID())).status,
      404,
    );
  });
  await ok("admin/course-delete", { id: courseId, confirm: true }, cookie);
  courseId = null;
  await ok("admin/teacher-delete", { id: teacherId, confirm: true }, cookie);
  teacherId = null;
  writeFileSync(
    projectPath(".local/media-verification.json"),
    JSON.stringify({ passed: true, checks, probeImage: firstRef }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length }));
} finally {
  if (courseId)
    await api(
      "admin/course-delete",
      { id: courseId, confirm: true },
      cookie,
    ).catch(() => {});
  if (teacherId)
    await api(
      "admin/teacher-delete",
      { id: teacherId, confirm: true },
      cookie,
    ).catch(() => {});
  await db.end();
}
