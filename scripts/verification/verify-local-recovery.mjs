import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { projectPath } from "../shared/paths.mjs";
process.loadEnvFile(projectPath(".env.local"));
const origin = "http://127.0.0.1:3000";
if (process.env.DOROSNA_LOCAL_ONLY !== "1" || process.env.APP_ORIGIN !== origin)
  throw new Error("Local verification only.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }),
  checks = [];
async function api(path, body, cookie = "") {
  const res = await fetch(origin + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: res.status,
    data: await res.json(),
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
  };
}
async function ok(path, body, cookie) {
  const res = await api(path, body, cookie);
  assert.ok(
    [200, 201].includes(res.status),
    `${path}: ${res.data.error ?? res.status}`,
  );
  return res;
}
async function test(name, run) {
  await run();
  checks.push({ name, passed: true });
  console.log("PASS", name);
}
let adminCookie = "",
  studentCookie = "";
try {
  await db.connect();
  const admin = JSON.parse(
    readFileSync(projectPath(".local/admin-account.json"), "utf8"),
  );
  const student = JSON.parse(
    readFileSync(projectPath(".local/learning-student.json"), "utf8"),
  );
  adminCookie = (
    await ok("auth/login", { phone: admin.phone, password: admin.password })
  ).cookie;
  const fixtureId = (
    await db.query("select id from app_private.accounts where phone=$1", [
      "+20" + student.phone.slice(1),
    ])
  ).rows[0].id;
  await ok("admin/student-enable", { studentId: fixtureId }, adminCookie);
  studentCookie = (
    await ok("auth/login", { phone: student.phone, password: student.password })
  ).cookie;
  const studentId = (
    await db.query("select id from app_private.accounts where phone=$1", [
      "+20" + student.phone.slice(1),
    ])
  ).rows[0].id;
  const body = {
    studentId,
    verificationRef: "local-recovery-test-" + randomUUID(),
  };
  const before = (
    await db.query(
      "select (select count(*) from app_private.attempts where student_id=$1) attempts,(select count(*) from app_private.course_access where student_id=$1) accesses,(select count(*) from app_private.lesson_progress where student_id=$1) progress",
      [studentId],
    )
  ).rows[0];
  await test("student_cannot_issue_admin_recovery", async () =>
    assert.equal(
      (await api("admin/recovery-issue", body, studentCookie)).status,
      403,
    ));
  const grant = (await ok("admin/recovery-issue", body, adminCookie)).data;
  await test("recovery_revokes_old_sessions_and_old_password", async () => {
    assert.equal(
      (
        await api(
          "results/" +
            (
              await db.query(
                "select id from app_private.attempts where student_id=$1 limit 1",
                [studentId],
              )
            ).rows[0].id,
          undefined,
          studentCookie,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await api("auth/login", {
          phone: student.phone,
          password: student.password,
        })
      ).status,
      401,
    );
  });
  await test("only_hash_persisted_and_weak_password_does_not_consume_grant", async () => {
    const row = (
      await db.query(
        "select token_hash,stage from app_private.recoveries where token_hash=$1",
        [createHash("sha256").update(grant.recoveryCode).digest("hex")],
      )
    ).rows[0];
    assert.equal(row.stage, "issued");
    assert.notEqual(row.token_hash, grant.recoveryCode);
    assert.equal(
      (await api("recovery", { code: grant.recoveryCode, password: "weak" }))
        .status,
      400,
    );
  });
  const replacementPassword = `Recover!${randomUUID()}aA9`;
  await test("recovery_one_use_changes_password_and_never_auto_signs_in", async () => {
    const recovered = await ok("recovery", {
      code: grant.recoveryCode,
      password: replacementPassword,
    });
    assert.equal(recovered.cookie, "");
    assert.equal(
      (
        await api("recovery", {
          code: grant.recoveryCode,
          password: replacementPassword,
        })
      ).status,
      400,
    );
    student.password = replacementPassword;
    writeFileSync(
      projectPath(".local/learning-student.json"),
      JSON.stringify(student, null, 2),
    );
    studentCookie = (
      await ok("auth/login", {
        phone: student.phone,
        password: student.password,
      })
    ).cookie;
  });
  await test("reissuing_invalidates_previous_unconsumed_code", async () => {
    const first = (await ok("admin/recovery-issue", body, adminCookie)).data;
    const second = (await ok("admin/recovery-issue", body, adminCookie)).data;
    assert.equal(
      (
        await api("recovery", {
          code: first.recoveryCode,
          password: student.password,
        })
      ).status,
      400,
    );
    await ok("recovery", {
      code: second.recoveryCode,
      password: student.password,
    });
  });
  await test("concurrent_recovery_claims_have_one_winner", async () => {
    const one = (await ok("admin/recovery-issue", body, adminCookie)).data;
    const res = await Promise.all([
      api("recovery", { code: one.recoveryCode, password: student.password }),
      api("recovery", { code: one.recoveryCode, password: student.password }),
    ]);
    assert.equal(res.filter((r) => r.status === 200).length, 1);
    assert.ok(res.some((r) => [400, 409].includes(r.status)));
  });
  await test("expired_recovery_cannot_be_used", async () => {
    const expired = (await ok("admin/recovery-issue", body, adminCookie)).data;
    // Test-only clock simulation for this synthetic grant; no product request can do this.
    await db.query(
      "update app_private.recoveries set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1",
      [createHash("sha256").update(expired.recoveryCode).digest("hex")],
    );
    assert.equal(
      (
        await api("recovery", {
          code: expired.recoveryCode,
          password: student.password,
        })
      ).status,
      400,
    );
    const newer = (await ok("admin/recovery-issue", body, adminCookie)).data;
    await ok("recovery", {
      code: newer.recoveryCode,
      password: student.password,
    });
  });
  await test("unfinished_recovery_requires_explicit_admin_reconciliation", async () => {
    const uncertain = (await ok("admin/recovery-issue", body, adminCookie))
      .data;
    // Simulate a process interruption after the provider freeze, on the fixture only.
    await db.query(
      "update app_private.recoveries set stage='review' where token_hash=$1",
      [createHash("sha256").update(uncertain.recoveryCode).digest("hex")],
    );
    assert.equal(
      (await api("admin/recovery-issue", body, adminCookie)).status,
      409,
    );
    const resolved = (await ok("admin/recovery-reconcile", body, adminCookie))
      .data;
    assert.equal(
      (
        await api("recovery", {
          code: uncertain.recoveryCode,
          password: student.password,
        })
      ).status,
      400,
    );
    await ok("recovery", {
      code: resolved.recoveryCode,
      password: student.password,
    });
  });
  await test("disabled_student_remains_disabled_after_password_recovery", async () => {
    await ok(
      "admin/student-disable",
      { studentId, reason: "اختبار استعادة حساب معطّل" },
      adminCookie,
    );
    const disabled = (await ok("admin/recovery-issue", body, adminCookie)).data;
    await ok("recovery", {
      code: disabled.recoveryCode,
      password: student.password,
    });
    assert.equal(
      (
        await db.query(
          "select status,recovery_locked from app_private.accounts where id=$1",
          [studentId],
        )
      ).rows[0].status,
      "disabled",
    );
    assert.equal(
      (
        await api("auth/login", {
          phone: student.phone,
          password: student.password,
        })
      ).status,
      401,
    );
    await ok("admin/student-enable", { studentId }, adminCookie);
    studentCookie = (
      await ok("auth/login", {
        phone: student.phone,
        password: student.password,
      })
    ).cookie;
  });
  await test("incomplete_registration_reconciles_only_matching_provider_identity", async () => {
    // Simulate a crash before the final local registration commit. The provider
    // identity and trusted registration marker were created by the real register API.
    await db.query("begin");
    await db.query(
      "update app_private.registrations set stage='review' where account_id=$1",
      [studentId],
    );
    await db.query(
      "update app_private.accounts set provisioning_locked=true where id=$1",
      [studentId],
    );
    await db.query("commit");
    assert.equal(
      (
        await api("auth/login", {
          phone: student.phone,
          password: student.password,
        })
      ).status,
      401,
    );
    await ok("admin/registration-reconcile", body, adminCookie);
    assert.equal(
      (
        await db.query(
          "select provisioning_locked from app_private.accounts where id=$1",
          [studentId],
        )
      ).rows[0].provisioning_locked,
      false,
    );
    await ok("auth/login", {
      phone: student.phone,
      password: student.password,
    });
  });
  await test("recovery_preserves_progress_access_and_attempt_history", async () => {
    const after = (
      await db.query(
        "select (select count(*) from app_private.attempts where student_id=$1) attempts,(select count(*) from app_private.course_access where student_id=$1) accesses,(select count(*) from app_private.lesson_progress where student_id=$1) progress",
        [studentId],
      )
    ).rows[0];
    assert.deepEqual(after, before);
  });
  writeFileSync(
    projectPath(".local/f10-recovery-result.json"),
    JSON.stringify({ at: new Date().toISOString(), checks }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      artifact: ".local/f10-recovery-result.json",
    }),
  );
} finally {
  for (const cookie of [adminCookie, studentCookie])
    if (cookie) await api("auth/logout", {}, cookie).catch(() => {});
  await db.end();
}
