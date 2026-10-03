import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError, normalizePhone, uuid, registrationService, rateLimiter } from './registration-service.mjs';

// Isolated F01 feasibility server. No production UI, data, or routes.
// Auth's privileged key and provider JWTs never enter an HTTP response or cookie.
export const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const freezeDuration = '876000h'; // Local fail-closed stand-in; not a product policy.
const schema = 'auth_spike_private';
class Denied extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const deny = (status = 400, code = 'invalid_recovery') => { throw new Denied(status, code); };
const strongPassword = value => typeof value === 'string' && Buffer.byteLength(value) <= 72
  && value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
const only = (body, keys) => body && typeof body === 'object' && !Array.isArray(body)
  && Object.keys(body).every(key => keys.includes(key));

export async function createRecoveryGateway({ pool, auth, recoveryTtlSeconds = 900, afterProviderApply = async () => {}, afterProviderFreeze = async () => {}, checkpoint = async () => {}, runId = randomUUID(), limits = {} }) {
  if (recoveryTtlSeconds < 1 || recoveryTtlSeconds > 900) throw new Error('Invalid experiment TTL.');
  let origin;
  const providerSessions = new Map(); // Ephemeral test-only server memory; never a route.
  const operationContext = new AsyncLocalStorage();
  if (limits !== false && (!Buffer.isBuffer(limits.key) || limits.key.length < 32 || !limits.scope)) throw new Error('A shared limiter key and stable scope are required.');
  const limit = limits === false ? async () => {} : rateLimiter(pool, limits);

  async function operation(accountId, work, status = 409, code = 'operation_busy') {
    const db = await pool.connect();
    let held = false;
    try {
      held = (await db.query('select pg_try_advisory_lock(hashtextextended($1, 0)) as held', [`f01-account:${accountId}`])).rows[0].held;
      if (!held) deny(status, code);
      return await operationContext.run(db, work);
    } finally {
      if (held) await db.query('select pg_advisory_unlock(hashtextextended($1, 0))', [`f01-account:${accountId}`]).catch(() => {});
      db.release();
    }
  }

  async function tx(work) {
    const reserved = operationContext.getStore();
    const db = reserved ?? await pool.connect();
    try {
      await db.query('begin');
      await db.query("set local statement_timeout = '5s'");
      await db.query("set local lock_timeout = '3s'");
      const result = await work(db);
      await db.query('commit');
      return result;
    } catch (error) {
      await db.query('rollback').catch(() => {});
      throw error;
    } finally { if (!reserved) db.release(); }
  }
  async function audit(db, grant, event) {
    await db.query(`insert into ${schema}.audit(id, recovery_id, actor_id, account_id, event, reason, verification_ref)
      values ($1, $2, $3, $4, $5, 'in_person_verified', $6)`,
    [randomUUID(), grant.id, grant.actor_id, grant.account_id, event, grant.verification_ref]);
  }
  const cookieValue = (request, name) => {
    const pairs = (request.headers.cookie ?? '').split(';').map(value => value.trim().split('='));
    const matches = pairs.filter(([key]) => key === name);
    const value = matches.length === 1 ? matches[0][1] : '';
    return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
  };
  async function identity(db, request, admin = false) {
    const token = cookieValue(request, 'spike_session');
    if (!token) deny(401, 'unauthorized');
    const result = await db.query(`select a.* from ${schema}.sessions s
      join ${schema}.accounts a on a.id = s.account_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
      and s.auth_epoch = a.auth_epoch and a.status = 'active' and not a.recovery_locked and not a.provisioning_locked`, [digest(token)]);
    const account = result.rows[0];
    if (!account) deny(401, 'unauthorized');
    if (admin && account.role !== 'admin') deny(403, 'forbidden');
    return account;
  }
  async function lockGrant(db, hash, column) {
    // Account first, grant second: same order for issue, exchange, claim and finalize.
    const found = await db.query(`select account_id from ${schema}.recoveries where ${column} = $1`, [hash]);
    if (!found.rows[0]) deny();
    const account = (await db.query(`select * from ${schema}.accounts where id = $1 for update`, [found.rows[0].account_id])).rows[0];
    const grant = (await db.query(`select *, expires_at > now() as unexpired from ${schema}.recoveries where ${column} = $1 for update`, [hash])).rows[0];
    if (!account || !grant || !account.recovery_locked || account.auth_epoch !== grant.auth_epoch) deny();
    return { account, grant };
  }
  async function review(grant) {
    await tx(async db => {
      await db.query(`select id from ${schema}.accounts where id = $1 for update`, [grant.account_id]);
      const updated = await db.query(`update ${schema}.recoveries set stage = 'review_uncertain'
        where id = $1 and stage in ('preparing', 'claimed', 'applied', 'reconciling') returning *`, [grant.id]);
      if (updated.rows[0]) await audit(db, updated.rows[0], 'review_required');
    });
  }
  async function login(request, body) {
    const phone = normalizePhone(body?.phone);
    if (!only(body, ['phone', 'password']) || !phone
      || typeof body.password !== 'string') deny(401, 'invalid_credentials');
    const observed = (await pool.query(`select * from ${schema}.accounts where phone = $1`, [phone])).rows[0];
    if (!observed || observed.status !== 'active' || observed.recovery_locked || observed.provisioning_locked) deny(401, 'invalid_credentials');
    const signed = await auth('POST', '/token?grant_type=password', { phone, password: body.password });
    if (!signed.ok || signed.data?.user?.id !== observed.id) deny(401, 'invalid_credentials');
    const token = secret();
    await tx(async db => {
      const account = (await db.query(`select * from ${schema}.accounts where id = $1 for update`, [observed.id])).rows[0];
      if (account.status !== 'active' || account.recovery_locked || account.provisioning_locked || account.auth_epoch !== observed.auth_epoch) deny(401, 'invalid_credentials');
      await db.query(`insert into ${schema}.sessions(token_hash, account_id, auth_epoch, expires_at)
        values ($1, $2, $3, now() + interval '15 minutes')`, [digest(token), account.id, account.auth_epoch]);
    });
    providerSessions.set(digest(token), { access: signed.data.access_token, refresh: signed.data.refresh_token });
    return { status: 200, data: { signedIn: true }, cookie: `spike_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900` };
  }
  async function issue(request, body) {
    if (!only(body, ['student_id', 'reason', 'verification_ref']) || !uuid(body.student_id)
      || body.reason !== 'in_person_verified' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.verification_ref ?? '')) deny(400, 'invalid_request');
    return operation(body.student_id, () => issueInner(request, body), 409, 'review_required');
  }
  async function issueInner(request, body) {
    const token = secret();
    const grant = await tx(async db => {
      const observedActor = await identity(db, request, true);
      // Consistent ordering also covers the trusted admin's live role and status.
      await db.query(`select id from ${schema}.accounts where id = any($1::uuid[]) order by id for update`, [[observedActor.id, body.student_id]]);
      const actor = await identity(db, request, true);
      const account = (await db.query(`select * from ${schema}.accounts where id = $1`, [body.student_id])).rows[0];
      if (!account || account.role !== 'student' || account.provisioning_locked) deny(404, 'student_not_found');
      const pending = (await db.query(`select * from ${schema}.recoveries where account_id = $1
        and stage in ('preparing', 'issued', 'exchanged', 'claimed', 'applied', 'review_uncertain', 'reconciling') for update`, [account.id])).rows;
      if (pending.some(g => ['preparing', 'claimed', 'applied', 'review_uncertain', 'reconciling'].includes(g.stage))) deny(409, 'review_required');
      for (const old of pending) {
        await db.query(`update ${schema}.recoveries set stage = 'cancelled' where id = $1`, [old.id]);
        await audit(db, old, 'recovery_cancelled');
      }
      const updated = (await db.query(`update ${schema}.accounts set auth_epoch = auth_epoch + 1,
        recovery_locked = true where id = $1 returning *`, [account.id])).rows[0];
      await db.query(`update ${schema}.sessions set revoked_at = now() where account_id = $1 and revoked_at is null`, [account.id]);
      const created = (await db.query(`insert into ${schema}.recoveries(id, account_id, actor_id, auth_epoch, verification_ref, token_hash, stage, expires_at)
        values ($1, $2, $3, $4, $5, $6, 'preparing', now() + $7 * interval '1 second') returning *`,
      [randomUUID(), account.id, actor.id, updated.auth_epoch, body.verification_ref, digest(token), recoveryTtlSeconds])).rows[0];
      await audit(db, created, 'recovery_started');
      return created;
    });
    try {
      await checkpoint('recovery_prepared', grant);
      // Password rotation clears ALL Auth sessions through its supported admin API.
      // The random password is discarded; banning also blocks provider sign-in.
      const frozen = await auth('PUT', `/admin/users/${grant.account_id}`,
        { password: `Aa1!${randomBytes(24).toString('hex')}`, ban_duration: freezeDuration,
          phone: (await pool.query(`select phone from ${schema}.accounts where id = $1`, [grant.account_id])).rows[0].phone, phone_confirm: true }, { admin: true });
      if (!frozen.ok) throw new Error('Provider freeze unconfirmed.');
      await afterProviderFreeze(grant); // Test-only callback, never an HTTP option.
      await checkpoint('recovery_frozen', grant);
      await tx(async db => {
        await db.query(`select id from ${schema}.accounts where id = $1 for update`, [grant.account_id]);
        const updated = await db.query(`update ${schema}.recoveries set stage = 'issued' where id = $1 and stage = 'preparing' returning *`, [grant.id]);
        if (!updated.rows[0]) throw new Error('Issue finalization unconfirmed.');
        await audit(db, updated.rows[0], 'auth_frozen');
      });
    } catch {
      await review(grant);
      deny(503, 'review_required');
    }
    return { status: 201, data: { token, expiresInSeconds: recoveryTtlSeconds } };
  }
  async function exchange(request, body) {
    if (!only(body, ['token']) || !/^[A-Za-z0-9_-]{43}$/.test(body.token ?? '')) deny();
    const token = secret();
    await tx(async db => {
      const { grant } = await lockGrant(db, digest(body.token), 'token_hash');
      if (grant.stage !== 'issued' || !grant.unexpired) deny();
      const updated = (await db.query(`update ${schema}.recoveries set stage = 'exchanged', recovery_session_hash = $1 where id = $2 returning *`, [digest(token), grant.id])).rows[0];
      await audit(db, updated, 'token_exchanged');
    });
    return { status: 200, data: { passwordSettingOnly: true }, cookie: `spike_recovery=${token}; Path=/recovery; HttpOnly; SameSite=Strict; Max-Age=${recoveryTtlSeconds}` };
  }
  async function applyPassword(request, body) {
    if (!only(body, ['password']) || !strongPassword(body.password)) deny(400, 'invalid_password');
    const token = cookieValue(request, 'spike_recovery');
    if (!token) deny();
    const found = (await pool.query(`select account_id from ${schema}.recoveries where recovery_session_hash = $1`, [digest(token)])).rows[0];
    if (!found) deny();
    return operation(found.account_id, () => applyPasswordInner(request, body, token), 400, 'invalid_recovery');
  }
  async function applyPasswordInner(request, body, token) {
    const operation = randomUUID();
    const grant = await tx(async db => {
      const { grant: observed } = await lockGrant(db, digest(token), 'recovery_session_hash');
      if (observed.stage !== 'exchanged' || !observed.unexpired) deny();
      const claimed = (await db.query(`update ${schema}.recoveries set stage = 'claimed', operation_id = $1 where id = $2 returning *`, [operation, observed.id])).rows[0];
      await audit(db, claimed, 'password_claimed');
      return claimed;
    });
    let attemptedUnfreeze = false;
    try {
      await checkpoint('recovery_claimed', grant);
      const changed = await auth('PUT', `/admin/users/${grant.account_id}`, { password: body.password,
        phone: (await pool.query(`select phone from ${schema}.accounts where id = $1`, [grant.account_id])).rows[0].phone, phone_confirm: true }, { admin: true });
      if (!changed.ok) throw new Error('Provider password change unconfirmed.');
      await checkpoint('recovery_password_set', grant);
      await afterProviderApply(grant);
      const status = await tx(async db => {
        const account = (await db.query(`select * from ${schema}.accounts where id = $1 for update`, [grant.account_id])).rows[0];
        const updated = await db.query(`update ${schema}.recoveries set stage = 'applied' where id = $1 and stage = 'claimed' and operation_id = $2 returning *`, [grant.id, operation]);
        if (!updated.rows[0]) throw new Error('Password finalization unconfirmed.');
        await audit(db, updated.rows[0], 'password_applied');
        return account.status;
      });
      await checkpoint('recovery_applied', grant);
      if (status === 'active') {
        attemptedUnfreeze = true;
        const unfrozen = await auth('PUT', `/admin/users/${grant.account_id}`, { ban_duration: 'none' }, { admin: true });
        if (!unfrozen.ok) throw new Error('Provider unfreeze unconfirmed.');
        await checkpoint('recovery_unfrozen', grant);
      }
      await tx(async db => {
        const account = (await db.query(`select * from ${schema}.accounts where id = $1 for update`, [grant.account_id])).rows[0];
        if (account.auth_epoch !== grant.auth_epoch || !account.recovery_locked) throw new Error('Recovery epoch changed.');
        const completed = await db.query(`update ${schema}.recoveries set stage = 'consumed', consumed_at = now()
          where id = $1 and stage = 'applied' and operation_id = $2 returning *`, [grant.id, operation]);
        if (!completed.rows[0]) throw new Error('Completion unconfirmed.');
        await db.query(`update ${schema}.accounts set recovery_locked = false where id = $1`, [grant.account_id]);
        await audit(db, completed.rows[0], 'recovery_completed');
      });
    } catch {
      if (attemptedUnfreeze) {
        // Best effort when an unfreeze response/DB completion is uncertain. The
        // private account remains locked even if the provider is unavailable.
        await auth('PUT', `/admin/users/${grant.account_id}`, { password: `Aa1!${randomBytes(24).toString('hex')}`, ban_duration: freezeDuration }, { admin: true }).catch(() => {});
      }
      await review(grant);
      deny(503, 'review_required');
    }
    return { status: 200, data: { passwordChanged: true, signInRequired: true }, cookie: 'spike_recovery=; Path=/recovery; HttpOnly; SameSite=Strict; Max-Age=0' };
  }
  const registration = registrationService({ pool, tx, auth, runId, checkpoint, operation });
  async function reconcileRecovery(request, body) {
    if (!only(body, ['student_id', 'reason', 'verification_ref']) || !uuid(body.student_id)
      || body.reason !== 'in_person_verified' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.verification_ref ?? '')) deny(400, 'invalid_request');
    return operation(body.student_id, async () => {
      const target = await tx(async db => {
        const actor = await identity(db, request, true);
        await db.query(`select id from ${schema}.accounts where id = any($1::uuid[]) order by id for update`, [[actor.id, body.student_id]]);
        await identity(db, request, true);
        const account = (await db.query(`select * from ${schema}.accounts where id = $1`, [body.student_id])).rows[0];
        const grant = (await db.query(`select * from ${schema}.recoveries where account_id = $1 and stage in ('preparing', 'claimed', 'applied', 'review_uncertain', 'reconciling') for update`, [body.student_id])).rows[0];
        if (!account || account.role !== 'student' || !grant || !account.recovery_locked) deny(409, 'review_required');
        await db.query(`update ${schema}.recoveries set stage = 'reconciling' where id = $1`, [grant.id]);
        await db.query(`update ${schema}.accounts set auth_epoch = auth_epoch + 1 where id = $1`, [account.id]);
        await db.query(`update ${schema}.sessions set revoked_at = now() where account_id = $1 and revoked_at is null`, [account.id]);
        return { account, grant, actor };
      });
      const token = secret();
      try {
        const frozen = await auth('PUT', `/admin/users/${target.account.id}`, { password: `Aa1!${randomBytes(24).toString('hex')}`,
          phone: target.account.phone, phone_confirm: true, ban_duration: freezeDuration }, { admin: true });
        if (!frozen.ok) throw new Error('Reconciliation freeze unconfirmed.');
        await tx(async db => {
          const account = (await db.query(`select * from ${schema}.accounts where id = $1 for update`, [target.account.id])).rows[0];
          const cancelled = (await db.query(`update ${schema}.recoveries set stage = 'cancelled' where id = $1 and stage = 'reconciling' returning *`, [target.grant.id])).rows[0];
          if (!cancelled) throw new Error('Reconciliation completion unconfirmed.');
          await audit(db, { ...cancelled, actor_id: target.actor.id, verification_ref: body.verification_ref }, 'recovery_cancelled');
          const replacement = (await db.query(`insert into ${schema}.recoveries(id, account_id, actor_id, auth_epoch, verification_ref, token_hash, stage, expires_at)
            values ($1, $2, $3, $4, $5, $6, 'issued', now() + $7 * interval '1 second') returning *`,
          [randomUUID(), account.id, target.actor.id, account.auth_epoch, body.verification_ref, digest(token), recoveryTtlSeconds])).rows[0];
          await audit(db, replacement, 'recovery_started'); await audit(db, replacement, 'auth_frozen');
        });
      } catch { await review(target.grant); deny(503, 'review_required'); }
      return { status: 201, data: { token, expiresInSeconds: recoveryTtlSeconds, reconciled: true } };
    });
  }
  async function readBody(request) {
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') deny(415, 'json_required');
    const chunks = []; let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 8192) deny(413, 'request_too_large');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { deny(400, 'invalid_json'); }
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', 'application/json');
    try {
      if (request.headers.host !== new URL(origin).host) deny(403, 'invalid_host');
      if (request.method === 'POST' && (request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site')) deny(403, 'invalid_origin');
      const route = new URL(request.url, origin);
      if (route.search) deny(400, 'query_not_allowed');
      let result;
      if (request.method === 'GET' && route.pathname === '/me') {
        const account = await tx(db => identity(db, request));
        result = { status: 200, data: { id: account.id, role: account.role, status: account.status, full_name: account.full_name, grade_id: account.grade_id } };
      } else if (request.method === 'POST') {
        const body = await readBody(request);
        const publicKind = { '/register': 'register', '/login': 'login', '/recovery/exchange': 'exchange', '/recovery/password': 'password' }[route.pathname];
        if (publicKind) await limit(request, publicKind,
          ['register', 'login'].includes(publicKind) ? normalizePhone(body?.phone) : publicKind === 'exchange' ? body?.token : cookieValue(request, 'spike_recovery'));
        else if (route.pathname.startsWith('/admin/')) await limit(request, 'admin', cookieValue(request, 'spike_session'));
        if (route.pathname === '/register') result = await registration.register(request, body);
        else if (route.pathname === '/login') result = await login(request, body);
        else if (route.pathname === '/admin/recoveries') result = await issue(request, body);
        else if (route.pathname === '/admin/recoveries/reconcile') result = await reconcileRecovery(request, body);
        else if (route.pathname === '/admin/registrations/reconcile') {
          if (!only(body, ['operation_id', 'reason', 'verification_ref']) || body.reason !== 'in_person_verified' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.verification_ref ?? '')) deny(400, 'invalid_request');
          const actor = await tx(db => identity(db, request, true));
          result = await registration.reconcile(body, actor.id);
        }
        else if (route.pathname === '/recovery/exchange') result = await exchange(request, body);
        else if (route.pathname === '/recovery/password') result = await applyPassword(request, body);
        else deny(404, 'not_found');
      } else deny(404, 'not_found');
      if (result.cookie) response.setHeader('Set-Cookie', result.cookie);
      response.writeHead(result.status).end(JSON.stringify(result.data));
    } catch (error) {
      const known = error instanceof Denied || error instanceof ApiError;
      if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
      response.writeHead(known ? error.status : 503).end(JSON.stringify({ error: known ? error.code : 'temporarily_unavailable', ...(error.fields?.length ? { fields: error.fields } : {}) }));
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin,
    providerSessionForTest: cookie => providerSessions.get(digest(cookie.split('=')[1])),
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections();
    }),
  };
}
