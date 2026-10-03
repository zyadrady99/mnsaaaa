import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import {
  normalizePhone,
  validPassword,
  validUuid,
  passwordHint,
} from "@/lib/auth-input";
import { database, transaction } from "./db";
import { provider } from "./provider";
import { denied } from "./errors";

export const sessionCookie = "dorosna_session";
export const sessionSeconds = 7 * 24 * 60 * 60;
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export type Account = {
  id: string;
  full_name: string;
  phone: string;
  role: "student" | "admin";
  status: "active" | "disabled";
  auth_epoch: string;
  provisioning_locked: boolean;
  recovery_locked: boolean;
  grade_slug: string | null;
  grade_name: string | null;
  created_at: string;
};

export async function identity(
  db: PoolClient,
  token: string,
  role?: Account["role"],
  lock = false,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    denied(401, "unauthorized", "سجّل دخولك علشان تكمل.");
  const account = (
    await db.query<Account>(
      `select a.*, g.slug as grade_slug,g.name as grade_name from app_private.sessions s
    join app_private.accounts a on a.id=s.account_id
    left join app_private.student_profiles p on p.account_id=a.id
    left join app_private.grades g on g.id=p.grade_id
    where s.token_hash=$1 and s.revoked_at is null and s.expires_at>clock_timestamp()
    and s.auth_epoch=a.auth_epoch and a.status='active' and not a.provisioning_locked and not a.recovery_locked
    ${lock ? "for update of a" : ""}`,
      [tokenHash(token)],
    )
  ).rows[0];
  if (!account)
    denied(
      401,
      "unauthorized",
      "جلسة الدخول انتهت أو الحساب غير متاح. سجّل دخولك تاني.",
    );
  if (role && account.role !== role) denied();
  return account;
}

export const currentAccount = cache(async () => {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;
  const db = await database().connect();
  try {
    return await identity(db, token);
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 401)
      return null;
    throw error;
  } finally {
    db.release();
  }
});
export async function requireAccount(role?: Account["role"]) {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (role && account.role !== role) redirect("/account");
  return account;
}
export async function requestToken() {
  return (await cookies()).get(sessionCookie)?.value ?? "";
}

// External Auth changes share an advisory lock with recovery and reconciliation.
// The provider call never holds a database transaction open.
export async function accountOperation<T>(key: string, work: () => Promise<T>) {
  const db = await database().connect();
  let held = false;
  try {
    held = (
      await db.query(
        "select pg_try_advisory_lock(hashtextextended($1,0)) as held",
        [`dorosna-auth:${key}`],
      )
    ).rows[0].held;
    if (!held)
      denied(
        409,
        "operation_busy",
        "في عملية على الحساب ده لسه بتتم. جرّب تاني بعد لحظات.",
      );
    return await work();
  } finally {
    if (held)
      await db
        .query("select pg_advisory_unlock(hashtextextended($1,0))", [
          `dorosna-auth:${key}`,
        ])
        .catch(() => {});
    db.release();
  }
}

export async function register(body: Record<string, unknown>) {
  const phone = normalizePhone(body.phone);
  const name =
    typeof body.name === "string"
      ? body.name.normalize("NFC").trim().replace(/\s+/g, " ")
      : "";
  if (
    !phone ||
    name.length < 3 ||
    name.length > 120 ||
    name.split(" ").length < 2 ||
    /[\p{Cc}]/u.test(name) ||
    !["g1", "g2", "g3"].includes(String(body.grade)) ||
    !validUuid(body.requestId)
  )
    denied(
      400,
      "invalid_registration",
      "راجع الاسم ورقم الموبايل والصف الدراسي.",
    );
  if (!validPassword(body.password))
    denied(400, "invalid_password", passwordHint);
  const password = body.password;
  const requestId = body.requestId;
  const payload = createHash("sha256")
    .update(JSON.stringify([phone, name, body.grade]))
    .digest();
  return accountOperation(`phone:${phone}`, async () => {
    const prepared = await transaction(async (db) => {
      const existing = (
        await db.query(
          `select r.*,a.phone,a.full_name,a.provisioning_locked from app_private.registrations r
        join app_private.accounts a on a.id=r.account_id where r.request_id=$1 for update of r,a`,
          [requestId],
        )
      ).rows[0];
      if (existing) {
        if (!existing.payload_digest.equals(payload))
          denied(409, "request_conflict", "البيانات اتغيّرت. ابدأ تسجيل جديد.");
        return existing;
      }
      if (
        (
          await db.query("select id from app_private.accounts where phone=$1", [
            phone,
          ])
        ).rowCount
      )
        denied(
          409,
          "registration_unavailable",
          "تعذر إنشاء الحساب بالبيانات دي. لو عندك حساب سجّل دخولك، أو تواصل مع السنتر.",
        );
      const grade = (
        await db.query(
          "select id from app_private.grades where slug=$1 and enabled",
          [body.grade],
        )
      ).rows[0];
      if (!grade)
        denied(400, "grade_unavailable", "الصف الدراسي ده غير متاح حاليًا.");
      const accountId = randomUUID(),
        providerId = randomUUID();
      await db.query(
        "insert into app_private.accounts(id,phone,full_name,role) values($1,$2,$3,'student')",
        [accountId, phone, name],
      );
      await db.query(
        "insert into app_private.student_profiles(account_id,grade_id) values($1,$2)",
        [accountId, grade.id],
      );
      await db.query(
        "insert into app_private.identity_links(account_id,provider,external_subject) values($1,'supabase',$2)",
        [accountId, providerId],
      );
      return (
        await db.query(
          `insert into app_private.registrations(request_id,payload_digest,account_id,provider_id,stage)
        values($1,$2,$3,$4,'creating') returning *`,
          [requestId, payload, accountId, providerId],
        )
      ).rows[0];
    });
    if (prepared.stage === "complete") return { registered: true };
    if (prepared.stage === "review")
      denied(
        503,
        "registration_review",
        "التسجيل محتاج مراجعة من السنتر. بياناتك محفوظة؛ متعملش حساب تاني.",
      );
    try {
      if (prepared.stage === "creating") {
        const created = await provider("POST", "/admin/users", {
          id: prepared.provider_id,
          phone,
          password,
          phone_confirm: true,
          ban_duration: "876000h",
          app_metadata: { dorosna_registration: requestId },
        });
        if (!created.ok || created.data?.id !== prepared.provider_id)
          throw new Error("Registration provider creation unconfirmed.");
        await database().query(
          "update app_private.registrations set stage='profiled' where request_id=$1 and stage='creating'",
          [requestId],
        );
      }
      const unfrozen = await provider(
        "PUT",
        `/admin/users/${prepared.provider_id}`,
        { phone, phone_confirm: true, ban_duration: "none" },
      );
      if (!unfrozen.ok || unfrozen.data?.id !== prepared.provider_id)
        throw new Error("Registration unfreeze unconfirmed.");
      await transaction(async (db) => {
        const account = (
          await db.query(
            "select * from app_private.accounts where id=$1 for update",
            [prepared.account_id],
          )
        ).rows[0];
        if (
          !account ||
          !account.provisioning_locked ||
          account.status !== "active" ||
          account.recovery_locked
        )
          throw new Error("Registration state changed.");
        await db.query(
          "update app_private.accounts set provisioning_locked=false where id=$1",
          [account.id],
        );
        await db.query(
          "update app_private.registrations set stage='complete' where request_id=$1",
          [requestId],
        );
        await db.query(
          `insert into app_private.audit_events(actor_id,action,target_type,target_id,operation_id)
          values($1,'register','account',$1,$2)`,
          [account.id, requestId],
        );
      });
    } catch {
      await database().query(
        "update app_private.registrations set stage='review' where request_id=$1 and stage<>'complete'",
        [requestId],
      );
      denied(
        503,
        "registration_review",
        "تعذر إكمال التسجيل. السنتر يقدر يراجع العملية؛ متعملش حساب تاني.",
      );
    }
    return { registered: true };
  });
}

export async function login(body: Record<string, unknown>) {
  const phone = normalizePhone(body.phone),
    password = body.password;
  const invalid = () =>
    denied(
      401,
      "invalid_credentials",
      "رقم الموبايل أو كلمة السر غير صحيحين، أو الحساب غير متاح.",
    );
  if (
    !phone ||
    typeof password !== "string" ||
    !password ||
    Buffer.byteLength(password) > 72
  )
    invalid();
  const observed = (
    await database().query(
      `select a.*,i.external_subject from app_private.accounts a
    join app_private.identity_links i on i.account_id=a.id and i.provider='supabase' where a.phone=$1`,
      [phone],
    )
  ).rows[0];
  if (
    !observed ||
    observed.status !== "active" ||
    observed.provisioning_locked ||
    observed.recovery_locked
  )
    invalid();
  const signed = await provider("POST", "/token?grant_type=password", {
    phone,
    password,
  });
  if (
    !signed.ok ||
    signed.data?.user?.id !== observed.external_subject ||
    !signed.data?.access_token
  )
    invalid();
  const token = randomBytes(32).toString("base64url");
  await transaction(async (db) => {
    const live = (
      await db.query(
        "select * from app_private.accounts where id=$1 for update",
        [observed.id],
      )
    ).rows[0];
    if (
      !live ||
      live.status !== "active" ||
      live.provisioning_locked ||
      live.recovery_locked ||
      live.auth_epoch !== observed.auth_epoch
    )
      invalid();
    await db.query(
      `insert into app_private.sessions(token_hash,account_id,auth_epoch,expires_at)
      values($1,$2,$3,clock_timestamp()+$4*interval '1 second')`,
      [tokenHash(token), live.id, live.auth_epoch, sessionSeconds],
    );
  });
  // Auth is the password verifier; the application uses its own revocable opaque session.
  // Do not keep provider access/refresh tokens in cookies, storage or persistent logs.
  await provider(
    "POST",
    "/logout?scope=local",
    undefined,
    signed.data?.access_token,
  ).catch(() => {});
  return { token, role: observed.role as Account["role"] };
}
export async function logout(token: string) {
  if (/^[A-Za-z0-9_-]{43}$/.test(token))
    await database().query(
      "update app_private.sessions set revoked_at=clock_timestamp() where token_hash=$1 and revoked_at is null",
      [tokenHash(token)],
    );
}
