import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  localSettings,
  provider,
} from "../experiments/auth-spike/scripts/local-runtime.mjs";

const root = path.resolve(import.meta.dirname, "..");
const credentialPath = path.join(root, ".local", "admin-account.json");
const settings = localSettings(),
  auth = provider(settings);
const db = new pg.Client({ connectionString: settings.DB_URL });
const phone = "+201000000001";
try {
  await db.connect();
  const existing = (
    await db.query(
      "select id,status,provisioning_locked from app_private.accounts where phone=$1 and role='admin'",
      [phone],
    )
  ).rows[0];
  if (existing) {
    if (
      !existsSync(credentialPath) ||
      existing.status !== "active" ||
      existing.provisioning_locked
    )
      throw new Error(
        "Existing local admin needs review; password not overwritten.",
      );
    console.log(
      JSON.stringify({
        adminReady: true,
        reused: true,
        credentialFile: ".local/admin-account.json",
      }),
    );
  } else {
    const password = `Drsna!${randomBytes(15).toString("base64url")}9aA`;
    const accountId = randomUUID(),
      providerId = randomUUID();
    const created = await auth(
      "POST",
      "/admin/users",
      {
        id: providerId,
        phone,
        password,
        phone_confirm: true,
        ban_duration: "876000h",
        app_metadata: { dorosna_local_admin: true },
      },
      { admin: true },
    );
    if (!created.ok || created.data?.id !== providerId)
      throw new Error("Local admin identity creation unconfirmed.");
    await db.query("begin");
    await db.query(
      "insert into app_private.accounts(id,phone,full_name,role) values($1,$2,'زياد — إدارة المنصة','admin')",
      [accountId, phone],
    );
    await db.query(
      "insert into app_private.identity_links(account_id,provider,external_subject) values($1,'supabase',$2)",
      [accountId, providerId],
    );
    await db.query(
      `insert into app_private.audit_events(actor_id,action,target_type,target_id,operation_id)
      values($1,'bootstrap_local_admin','account',$1,$2)`,
      [accountId, randomUUID()],
    );
    await db.query("commit");
    const unfrozen = await auth(
      "PUT",
      `/admin/users/${providerId}`,
      { phone, phone_confirm: true, ban_duration: "none" },
      { admin: true },
    );
    if (!unfrozen.ok) throw new Error("Local admin requires review.");
    await db.query(
      "update app_private.accounts set provisioning_locked=false where id=$1",
      [accountId],
    );
    writeFileSync(
      credentialPath,
      JSON.stringify(
        {
          phone: phone.replace(/^\+20/, "0"),
          password,
          login: "http://127.0.0.1:3000/login",
          admin: "http://127.0.0.1:3000/admin",
          localOnly: true,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      JSON.stringify({
        adminReady: true,
        reused: false,
        credentialFile: ".local/admin-account.json",
        passwordPrinted: false,
      }),
    );
  }
} catch {
  await db.query("rollback").catch(() => {});
  console.error(
    "Local admin setup needs review; credentials were not printed or overwritten.",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
