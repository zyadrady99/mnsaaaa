import { createHash, createHmac, randomUUID } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, fields = [], retryAfter) { super(code); Object.assign(this, { status, code, fields, retryAfter }); }
}
const fail = (status, code, fields) => { throw new ApiError(status, code, fields); };
const digest = value => createHash('sha256').update(value).digest('hex');
export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  let phone = value.normalize('NFKC').replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - 0x6f0)).replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (/^01[0125][0-9]{8}$/.test(phone)) phone = `+20${phone.slice(1)}`;
  if (/^201[0125][0-9]{8}$/.test(phone)) phone = `+${phone}`;
  if (phone.startsWith('+20') && !/^\+201[0125][0-9]{8}$/.test(phone)) return null;
  return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null;
}
export const validPassword = value => typeof value === 'string' && Buffer.byteLength(value) <= 72 && value.length >= 12
  && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function rateLimiter(pool, { key, scope, windowSeconds = 60, caps = {} } = {}) {
  if (!Buffer.isBuffer(key) || key.length < 32 || !scope) throw new Error('A shared limiter key and stable scope are required.');
  const defaults = { register: [15, 5], login: [30, 10], exchange: [30, 10], password: [30, 10], admin: [60, 30] };
  return async (request, route, identifier) => {
    const [ipCap, identifierCap] = caps[route] ?? defaults[route];
    const ip = request.socket.remoteAddress; // Never trust client X-Forwarded-For.
    for (const [kind, value, cap] of [['ip', ip, ipCap], ['identifier', identifier, identifierCap]]) {
      if (!value) continue;
      const hash = createHmac('sha256', key).update(`${scope}:${route}:${kind}:${value}`).digest('hex');
      const row = (await pool.query(`insert into auth_spike_private.request_limits(bucket_hash, scope_hash, attempts, reset_at)
        values ($1, $3, 1, now() + $2 * interval '1 second') on conflict (bucket_hash) do update set
        attempts = case when request_limits.reset_at <= now() then 1 else request_limits.attempts + 1 end,
        reset_at = case when request_limits.reset_at <= now() then now() + $2 * interval '1 second' else request_limits.reset_at end
        returning attempts, greatest(1, ceil(extract(epoch from reset_at - now())))::int as retry_after`, [hash, windowSeconds, digest(scope)])).rows[0];
      if (row.attempts > cap) throw new ApiError(429, 'rate_limited', [], row.retry_after);
    }
  };
}

export function registrationService({ pool, tx, auth, runId, checkpoint = async () => {}, operation }) {
  const received = () => ({ status: 202, data: { registrationReceived: true } });
  const uncertain = row => pool.query("update auth_spike_private.registrations set stage = 'review_uncertain', updated_at = now() where key_hash = $1 and stage <> 'complete'", [row.key_hash]);
  async function finish(row) {
    await tx(async db => {
      const current = (await db.query('select * from auth_spike_private.registrations where key_hash = $1 for update', [row.key_hash])).rows[0];
      if (current.stage === 'complete') return;
      await db.query(`insert into auth_spike_private.accounts(id, run_id, phone, role, full_name, grade_id, provisioning_locked)
        values ($1, $2, $3, 'student', $4, $5, true) on conflict (id) do nothing`, [row.auth_user_id, row.run_id, row.phone, row.full_name, row.grade_id]);
      const account = (await db.query('select * from auth_spike_private.accounts where id = $1 for update', [row.auth_user_id])).rows[0];
      if (!account || account.phone !== row.phone || account.run_id !== row.run_id || account.role !== 'student') throw new Error('Profile conflict.');
      await db.query("update auth_spike_private.registrations set stage = 'profiled', updated_at = now() where key_hash = $1", [row.key_hash]);
    });
    await checkpoint('registration_profiled', row);
    const opened = await auth('PUT', `/admin/users/${row.auth_user_id}`, { ban_duration: 'none' }, { admin: true });
    if (!opened.ok) throw new Error('Registration unfreeze unconfirmed.');
    await checkpoint('registration_unfrozen', row);
    await tx(async db => {
      const current = (await db.query('select * from auth_spike_private.registrations where key_hash = $1 for update', [row.key_hash])).rows[0];
      if (current.stage === 'complete') return;
      await db.query('update auth_spike_private.accounts set provisioning_locked = false where id = $1', [row.auth_user_id]);
      await db.query("update auth_spike_private.registrations set stage = 'complete', updated_at = now() where key_hash = $1", [row.key_hash]);
    });
  }
  async function register(request, body) {
    const fields = [];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['full_name', 'grade_id', 'phone', 'password'].includes(key))) fail(422, 'invalid_fields', ['request']);
    const name = typeof body.full_name === 'string' ? body.full_name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 80 || /[\p{C}]/u.test(name)) fields.push('full_name');
    const phone = normalizePhone(body.phone); if (!phone) fields.push('phone');
    const grade = typeof body.grade_id === 'string' && body.grade_id.length <= 64
      ? (await pool.query('select id from auth_spike_private.grades where id = $1 and enabled', [body.grade_id])).rows[0] : null;
    if (!grade) fields.push('grade_id');
    if (!validPassword(body.password)) fields.push('password');
    if (!uuid(request.headers['idempotency-key'])) fields.push('idempotency_key');
    if (fields.length) fail(422, 'invalid_fields', fields);
    const keyHash = digest(request.headers['idempotency-key'].toLowerCase());
    const row = await tx(async db => {
      const existing = (await db.query('select * from auth_spike_private.registrations where key_hash = $1 for update', [keyHash])).rows[0];
      if (existing) {
        if (existing.phone !== phone || existing.full_name !== name || existing.grade_id !== grade.id) fail(409, 'request_conflict');
        return null; // Never repeat a provider operation, even with another password.
      }
      if ((await db.query('select id from auth_spike_private.accounts where phone = $1', [phone])).rows[0]) return null;
      const inserted = (await db.query(`insert into auth_spike_private.registrations(key_hash, operation_id, auth_user_id, run_id, phone, full_name, grade_id, stage)
        values ($1, $2, $3, $4, $5, $6, $7, 'reserved') on conflict do nothing returning *`,
      [keyHash, randomUUID(), randomUUID(), runId, phone, name, grade.id])).rows[0] ?? null;
      if (!inserted) {
        // A concurrent transaction may have inserted this key after our read.
        const raced = (await db.query('select * from auth_spike_private.registrations where key_hash = $1 for update', [keyHash])).rows[0];
        if (raced && (raced.phone !== phone || raced.full_name !== name || raced.grade_id !== grade.id)) fail(409, 'request_conflict');
      }
      return inserted;
    });
    if (!row) return received();
    return operation(row.auth_user_id, async () => { try {
      await checkpoint('registration_reserved', row);
      await pool.query("update auth_spike_private.registrations set stage = 'creating', updated_at = now() where key_hash = $1 and stage = 'reserved'", [row.key_hash]);
      const user = await auth('POST', '/admin/users', { id: row.auth_user_id, phone, password: body.password, phone_confirm: true,
        ban_duration: '876000h', app_metadata: { f01_registration: row.operation_id }, user_metadata: { spike_run_id: runId } }, { admin: true });
      if (!user.ok || user.data?.id !== row.auth_user_id) throw new Error('Auth creation unconfirmed.');
      await checkpoint('registration_auth_created', row);
      await finish(row);
    } catch { await uncertain(row); }
    return received(); });
  }
  async function reconcile(body, actorId) {
    if (!uuid(body?.operation_id)) fail(400, 'invalid_request');
    const observed = (await pool.query('select * from auth_spike_private.registrations where operation_id = $1', [body.operation_id])).rows[0];
    if (!observed) fail(404, 'not_found');
    return operation(observed.auth_user_id, async () => {
    // Re-read under the process-wide guard: a worker may have finished since
    // the initial lookup. Replaying a completed review must never unban Auth.
    const row = (await pool.query('select * from auth_spike_private.registrations where operation_id = $1', [body.operation_id])).rows[0];
    if (!row) fail(404, 'not_found');
    if (row.stage === 'complete') return { status: 200, data: { reconciled: true } };
    if (row.stage === 'cancelled') return { status: 200, data: { reconciled: true, retryWithNewRequest: true } };
    const actual = await auth('GET', `/admin/users/${row.auth_user_id}`, null, { admin: true });
    if (row.stage === 'reserved' && actual.status === 404) {
      // This durable phase is written before any provider request. The session
      // advisory lock proves the original worker is no longer executing here.
      await pool.query("update auth_spike_private.registrations set stage = 'cancelled', reconciled_by = $2, reconciliation_ref = $3, reconciled_at = now() where key_hash = $1 and stage = 'reserved'", [row.key_hash, actorId, body.verification_ref]);
      return { status: 200, data: { reconciled: true, retryWithNewRequest: true } };
    }
    if (!actual.ok || actual.data.id !== row.auth_user_id || actual.data.phone !== row.phone.slice(1)
      || actual.data.app_metadata?.f01_registration !== row.operation_id || actual.data.role !== 'authenticated' || (actual.data.email ?? '') !== '') fail(409, 'review_required');
    try { await finish(row); } catch { await uncertain(row); fail(503, 'review_required'); }
    await pool.query('update auth_spike_private.registrations set reconciled_by = $2, reconciliation_ref = $3, reconciled_at = now() where key_hash = $1', [row.key_hash, actorId, body.verification_ref]);
    return { status: 200, data: { reconciled: true } };
    });
  }
  return { register, reconcile };
}
