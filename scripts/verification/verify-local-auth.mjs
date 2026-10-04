import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import pg from "pg";
import { projectPath } from "../shared/paths.mjs";

process.loadEnvFile(projectPath(".env.local"));
const origin = "http://127.0.0.1:3000";
if (process.env.APP_ORIGIN !== origin || process.env.DOROSNA_LOCAL_ONLY !== "1")
  throw new Error("Local test refused.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const results = [];
async function test(name, run) {
  await run();
  results.push({ name, passed: true });
}
async function post(action, body, cookie = "", customOrigin = origin) {
  const response = await fetch(`${origin}/api/auth/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: customOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  return {
    response,
    data: await response.json(),
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
  };
}
async function expectRedirect(response, path) {
  if (response.status === 307)
    assert.equal(
      new URL(response.headers.get("location"), origin).pathname,
      path,
    );
  else {
    // Next can start streaming the public shell before a protected page resolves.
    // The protected page emits its redirect and never reads/renders private data.
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("NEXT_REDIRECT") && html.includes(path));
    assert.ok(!html.includes("الكورسات المنشورة"));
  }
}
const admin = JSON.parse(
  readFileSync(projectPath(".local/admin-account.json"), "utf8"),
);
let student, adminCookie, studentCookie;
try {
  await db.connect();
  await test("foreign_origin_rejected", async () =>
    assert.equal(
      (
        await post(
          "login",
          { phone: admin.phone, password: admin.password },
          "",
          "https://example.com",
        )
      ).response.status,
      403,
    ));
  await test("browser_cannot_choose_role", async () =>
    assert.equal(
      (
        await post("register", {
          name: "طالب اختبار",
          grade: "g3",
          phone: "01012345678",
          password: "Example!123Ab",
          role: "admin",
          requestId: randomUUID(),
        })
      ).response.status,
      400,
    ));
  await test("admin_password_sign_in", async () => {
    const signed = await post("login", {
      phone: admin.phone,
      password: admin.password,
    });
    assert.equal(signed.response.status, 200);
    assert.equal(signed.data.next, "/admin");
    assert.match(signed.response.headers.get("set-cookie"), /HttpOnly/i);
    assert.match(signed.response.headers.get("set-cookie"), /SameSite=lax/i);
    assert.equal(
      signed.response.headers.get("cache-control"),
      "no-store, private",
    );
    assert.deepEqual(Object.keys(signed.data).sort(), ["next", "signedIn"]);
    adminCookie = signed.cookie;
  });
  await test("admin_dashboard_reads_database", async () => {
    const page = await fetch(`${origin}/admin`, {
      headers: { Cookie: adminCookie },
      redirect: "manual",
    });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /زياد/);
  });
  if (existsSync(projectPath(".local/student-account.json")))
    student = JSON.parse(
      readFileSync(projectPath(".local/student-account.json"), "utf8"),
    );
  else {
    student = {
      name: "طالب اختبار محلي",
      grade: "g3",
      phone: `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      password: `Student!${randomBytes(12).toString("hex")}Aa1`,
      requestId: randomUUID(),
    };
    await test("student_registration_creates_confirmed_profile", async () => {
      const registered = await post("register", student);
      assert.equal(registered.response.status, 201);
      const account = (
        await db.query(
          "select a.role,a.status,a.provisioning_locked,p.grade_id from app_private.accounts a join app_private.student_profiles p on p.account_id=a.id where phone=$1",
          [`+20${student.phone.slice(1)}`],
        )
      ).rows[0];
      assert.equal(account.role, "student");
      assert.equal(account.status, "active");
      assert.equal(account.provisioning_locked, false);
      assert.ok(account.grade_id);
      writeFileSync(
        projectPath(".local/student-account.json"),
        JSON.stringify(student, null, 2) + "\n",
        { mode: 0o600, flag: "wx" },
      );
    });
  }
  await test("registration_retry_does_not_duplicate", async () => {
    const replay = await post("register", student);
    assert.equal(replay.response.status, 201);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from app_private.accounts where phone=$1",
          [`+20${student.phone.slice(1)}`],
        )
      ).rows[0].n,
      1,
    );
  });
  await test("registration_retry_changed_payload_rejected", async () =>
    assert.equal(
      (await post("register", { ...student, name: "اسم مختلف للاختبار" }))
        .response.status,
      409,
    ));
  await test("wrong_password_rejected", async () =>
    assert.equal(
      (
        await post("login", {
          phone: student.phone,
          password: "Wrong!Password123",
        })
      ).response.status,
      401,
    ));
  await test("arabic_phone_sign_in", async () => {
    const signed = await post("login", {
      phone: student.phone.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]),
      password: student.password,
    });
    assert.equal(signed.response.status, 200);
    assert.equal(signed.data.next, "/my-courses");
    studentCookie = signed.cookie;
  });
  await test("student_cannot_open_admin", async () => {
    const page = await fetch(`${origin}/admin`, {
      headers: { Cookie: studentCookie },
      redirect: "manual",
    });
    await expectRedirect(page, "/account");
  });
  await test("profile_reads_own_account", async () => {
    const page = await fetch(`${origin}/account`, {
      headers: { Cookie: studentCookie },
    });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /طالب اختبار محلي/);
  });
  await test("invented_session_rejected", async () => {
    const page = await fetch(`${origin}/admin`, {
      headers: {
        Cookie: `dorosna_session=${randomBytes(32).toString("base64url")}`,
      },
      redirect: "manual",
    });
    await expectRedirect(page, "/login");
  });
  await test("logout_revokes_previous_session", async () => {
    assert.equal(
      (await post("logout", {}, studentCookie)).response.status,
      200,
    );
    const page = await fetch(`${origin}/account`, {
      headers: { Cookie: studentCookie },
      redirect: "manual",
    });
    await expectRedirect(page, "/login");
  });
  await post("logout", {}, adminCookie);
  writeFileSync(
    projectPath(".local/f06-auth-result.json"),
    JSON.stringify(
      {
        localOnly: true,
        passed: results.length,
        results,
        providerTokensPrinted: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: results.length,
      checks: results.map((x) => x.name),
      credentialsPrinted: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      passed: results.length,
      failedAfter: results.at(-1)?.name ?? "start",
      reason:
        error instanceof assert.AssertionError
          ? "assertion_failed"
          : "runtime_failure",
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
