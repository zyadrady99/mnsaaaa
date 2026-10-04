import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { database, transaction } from "@/server/core/db";
import { accountOperation, identity, tokenHash } from "@/server/auth/service";
import { provider } from "@/server/auth/provider";
import { audit, text, uuid } from "@/server/catalog/admin";
import { denied } from "@/server/core/errors";
import { normalizePhone, passwordHint, validPassword } from "@/lib/auth-input";

export const recoveryActions: Record<string, string[]> = {
  "recovery-issue": ["studentId", "verificationRef"],
  "recovery-reconcile": ["studentId", "verificationRef"],
  "registration-reconcile": ["studentId", "verificationRef"],
};
const ttlSeconds = 15 * 60;
const freezeDuration = "876000h";
const discardedPassword = () => `Aa9!${randomBytes(24).toString("hex")}`;
async function target(db: PoolClient, token: string, studentId: string) {
  const observed = await identity(db, token, "admin");
  await db.query(
    "select id from app_private.accounts where id=any($1::uuid[]) order by id for update",
    [[observed.id, studentId]],
  );
  const actor = await identity(db, token, "admin");
  const account = (
    await db.query(
      "select a.*,i.external_subject from app_private.accounts a join app_private.identity_links i on i.account_id=a.id and i.provider='supabase' where a.id=$1 and a.role='student'",
      [studentId],
    )
  ).rows[0];
  if (!account) denied(404, "student_not_found", "الطالب غير موجود.");
  return { actor, account };
}
function checkedUser(
  user: { id?: string; phone?: string } | null,
  account: { external_subject: string; phone: string },
) {
  if (
    !user ||
    user.id !== account.external_subject ||
    normalizePhone(user.phone) !== account.phone
  )
    throw new Error("Provider identity unconfirmed.");
}
export async function recoveryAdminCommand(
  action: string,
  body: Record<string, unknown>,
  token: string,
) {
  const studentId = uuid(body.studentId),
    verificationRef = text(body.verificationRef, 120, 3);
  // Resolve a server-owned identity only after the caller's live admin check.
  const observed = await transaction((db) => target(db, token, studentId));
  return accountOperation(`phone:${observed.account.phone}`, async () => {
    if (action === "registration-reconcile") {
      const prepared = await transaction(async (db) => {
        const { actor, account } = await target(db, token, studentId);
        const registration = (
          await db.query(
            "select * from app_private.registrations where account_id=$1 for update",
            [studentId],
          )
        ).rows[0];
        if (
          !registration ||
          registration.stage === "complete" ||
          !account.provisioning_locked ||
          account.recovery_locked
        )
          denied(409, "review_unavailable", "الحساب ده مش محتاج مراجعة تسجيل.");
        if (registration.provider_id !== account.external_subject)
          throw new Error("Registration mapping invariant failed.");
        await audit(
          db,
          actor.id,
          action + "-started",
          "account",
          studentId,
          verificationRef,
        );
        return { account, registration };
      });
      try {
        let fetched = await provider(
          "GET",
          `/admin/users/${prepared.account.external_subject}`,
        );
        if (fetched.status === 404) {
          // A verified empty provider reservation can be recreated. Its temporary
          // password is discarded; support issues the student a recovery grant next.
          fetched = await provider("POST", "/admin/users", {
            id: prepared.account.external_subject,
            phone: prepared.account.phone,
            password: discardedPassword(),
            phone_confirm: true,
            ban_duration: freezeDuration,
            app_metadata: {
              dorosna_registration: prepared.registration.request_id,
            },
          });
        }
        if (!fetched.ok)
          throw new Error("Provider registration not confirmed.");
        checkedUser(fetched.data, prepared.account);
        if (
          fetched.data?.app_metadata?.dorosna_registration !==
          prepared.registration.request_id
        )
          throw new Error("Registration marker mismatch.");
        const updated = await provider(
          "PUT",
          `/admin/users/${prepared.account.external_subject}`,
          {
            phone: prepared.account.phone,
            phone_confirm: true,
            ban_duration:
              prepared.account.status === "active" ? "none" : freezeDuration,
          },
        );
        if (!updated.ok)
          throw new Error("Provider registration finalization unconfirmed.");
        checkedUser(updated.data, prepared.account);
        await transaction(async (db) => {
          const { actor, account } = await target(db, token, studentId);
          if (!account.provisioning_locked || account.recovery_locked)
            throw new Error("Registration state changed.");
          await db.query(
            "update app_private.accounts set provisioning_locked=false where id=$1",
            [studentId],
          );
          await db.query(
            "update app_private.registrations set stage='complete' where account_id=$1",
            [studentId],
          );
          await audit(
            db,
            actor.id,
            action + "-complete",
            "account",
            studentId,
            verificationRef,
          );
        });
        return {
          message:
            "التسجيل اتراجع واكتمل. لو الطالب مش عارف كلمة سره، أصدر له كود استعادة بعد التحقق من هويته.",
        };
      } catch {
        await database().query(
          "update app_private.registrations set stage='review' where account_id=$1 and stage<>'complete'",
          [studentId],
        );
        denied(
          503,
          "review_required",
          "تعذر تأكيد التسجيل. الحساب لسه مقفول للمراجعة؛ جرّب مراجعة العملية تاني.",
        );
      }
    }
    const secret = randomBytes(32).toString("base64url");
    const prepared = await transaction(async (db) => {
      const { actor, account } = await target(db, token, studentId);
      if (account.provisioning_locked)
        denied(
          409,
          "registration_pending",
          "راجع التسجيل قبل استعادة كلمة السر.",
        );
      const pending = (
        await db.query(
          "select * from app_private.recoveries where account_id=$1 and stage in ('preparing','issued','claimed','review') for update",
          [studentId],
        )
      ).rows;
      if (
        action !== "recovery-reconcile" &&
        pending.some((r) => r.stage !== "issued")
      )
        denied(
          409,
          "review_required",
          "الاستعادة السابقة محتاجة مراجعة. استخدم إعادة إصدار بعد المراجعة.",
        );
      for (const grant of pending) {
        await db.query(
          "update app_private.recoveries set stage='cancelled' where id=$1",
          [grant.id],
        );
        await audit(
          db,
          actor.id,
          "recovery-cancelled",
          "recovery",
          grant.id,
          verificationRef,
        );
      }
      const epoch = (
        await db.query(
          "update app_private.accounts set recovery_locked=true,auth_epoch=auth_epoch+1 where id=$1 returning auth_epoch",
          [studentId],
        )
      ).rows[0].auth_epoch;
      await db.query(
        "update app_private.sessions set revoked_at=clock_timestamp() where account_id=$1 and revoked_at is null",
        [studentId],
      );
      const grant = (
        await db.query(
          "insert into app_private.recoveries(id,account_id,actor_id,token_hash,auth_epoch,verification_ref,stage,expires_at) values($1,$2,$3,$4,$5,$6,'preparing',clock_timestamp()+$7*interval '1 second') returning id,expires_at",
          [
            randomUUID(),
            studentId,
            actor.id,
            tokenHash(secret),
            epoch,
            verificationRef,
            ttlSeconds,
          ],
        )
      ).rows[0];
      await audit(
        db,
        actor.id,
        action + "-started",
        "recovery",
        grant.id,
        verificationRef,
      );
      return { account, grant, epoch };
    });
    try {
      const frozen = await provider(
        "PUT",
        `/admin/users/${prepared.account.external_subject}`,
        {
          password: discardedPassword(),
          phone: prepared.account.phone,
          phone_confirm: true,
          ban_duration: freezeDuration,
        },
      );
      if (!frozen.ok) throw new Error("Provider freeze unconfirmed.");
      checkedUser(frozen.data, prepared.account);
      await transaction(async (db) => {
        const { actor, account } = await target(db, token, studentId);
        if (account.auth_epoch !== prepared.epoch || !account.recovery_locked)
          throw new Error("Recovery state changed.");
        const changed = await db.query(
          "update app_private.recoveries set stage='issued' where id=$1 and stage='preparing' returning id",
          [prepared.grant.id],
        );
        if (!changed.rowCount) throw new Error("Recovery issue unconfirmed.");
        await audit(
          db,
          actor.id,
          action + "-issued",
          "recovery",
          prepared.grant.id,
          verificationRef,
        );
      });
    } catch {
      await database().query(
        "update app_private.recoveries set stage='review' where id=$1 and stage<>'complete'",
        [prepared.grant.id],
      );
      denied(
        503,
        "review_required",
        "الاستعادة محتاجة مراجعة. الحساب مقفول، ومفيش كود متاح لحد إعادة الإصدار بعد المراجعة.",
      );
    }
    return {
      recoveryCode: secret,
      expiresAt: prepared.grant.expires_at,
      message:
        "سلّم الكود للطالب بعد التحقق حضوريًا. صالح ١٥ دقيقة ولمرة واحدة، واتقفلت جلساته القديمة.",
    };
  });
}
export async function recoverPassword(body: Record<string, unknown>) {
  const secret = typeof body.code === "string" ? body.code.trim() : "";
  const invalid = () =>
    denied(
      400,
      "invalid_recovery",
      "كود الاستعادة غير صالح أو انتهى. ارجع للسنتر لإصدار كود جديد.",
    );
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) invalid();
  if (!validPassword(body.password))
    denied(400, "invalid_password", passwordHint);
  const found = (
    await database().query(
      "select a.phone from app_private.recoveries r join app_private.accounts a on a.id=r.account_id where r.token_hash=$1",
      [tokenHash(secret)],
    )
  ).rows[0];
  if (!found) invalid();
  return accountOperation(`phone:${found.phone}`, async () => {
    const prepared = await transaction(async (db) => {
      const observed = (
        await db.query(
          "select account_id from app_private.recoveries where token_hash=$1",
          [tokenHash(secret)],
        )
      ).rows[0];
      const account = (
        await db.query(
          "select a.*,i.external_subject from app_private.accounts a join app_private.identity_links i on i.account_id=a.id and i.provider='supabase' where a.id=$1 for update of a",
          [observed.account_id],
        )
      ).rows[0];
      const grant = (
        await db.query(
          "select *,expires_at>clock_timestamp() as valid from app_private.recoveries where token_hash=$1 for update",
          [tokenHash(secret)],
        )
      ).rows[0];
      if (
        !account ||
        !grant ||
        grant.stage !== "issued" ||
        !grant.valid ||
        grant.auth_epoch !== account.auth_epoch ||
        !account.recovery_locked ||
        account.provisioning_locked
      )
        invalid();
      await db.query(
        "update app_private.recoveries set stage='claimed' where id=$1",
        [grant.id],
      );
      await audit(db, account.id, "recovery-claimed", "recovery", grant.id);
      return { account, grant };
    });
    try {
      const changed = await provider(
        "PUT",
        `/admin/users/${prepared.account.external_subject}`,
        {
          password: body.password,
          phone: prepared.account.phone,
          phone_confirm: true,
          ban_duration:
            prepared.account.status === "active" ? "none" : freezeDuration,
        },
      );
      if (!changed.ok) throw new Error("Password change unconfirmed.");
      checkedUser(changed.data, prepared.account);
      await transaction(async (db) => {
        const account = (
          await db.query(
            "select * from app_private.accounts where id=$1 for update",
            [prepared.account.id],
          )
        ).rows[0];
        if (
          account.auth_epoch !== prepared.grant.auth_epoch ||
          !account.recovery_locked ||
          account.status !== prepared.account.status
        )
          throw new Error("Recovery finalization changed.");
        const completed = await db.query(
          "update app_private.recoveries set stage='complete' where id=$1 and stage='claimed' returning id",
          [prepared.grant.id],
        );
        if (!completed.rowCount)
          throw new Error("Recovery completion unconfirmed.");
        await db.query(
          "update app_private.accounts set recovery_locked=false where id=$1",
          [account.id],
        );
        await audit(
          db,
          account.id,
          "recovery-complete",
          "recovery",
          prepared.grant.id,
        );
      });
    } catch {
      await provider(
        "PUT",
        `/admin/users/${prepared.account.external_subject}`,
        { password: discardedPassword(), ban_duration: freezeDuration },
      ).catch(() => {});
      await database().query(
        "update app_private.recoveries set stage='review' where id=$1 and stage<>'complete'",
        [prepared.grant.id],
      );
      denied(
        503,
        "review_required",
        "تعذر تأكيد تغيير كلمة السر. ارجع للسنتر لمراجعة الاستعادة؛ الحساب لسه مقفول.",
      );
    }
    return {
      message:
        "كلمة السر اتغيّرت. سجّل دخولك بالكلمة الجديدة. لو حسابك معطّل، تنشيطه يحتاج السنتر.",
      next: "/login",
    };
  });
}
