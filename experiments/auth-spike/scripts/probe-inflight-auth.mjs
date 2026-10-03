import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { localSettings, provider } from './local-runtime.mjs';

const settings = localSettings();
const report = { scope: 'inflight-auth-mutation-before-freeze', startedAt: new Date().toISOString(), requests: [], cleanup: false };
const auth = provider(settings, report.requests);
const pool = new pg.Pool({ connectionString: settings.DB_URL, max: 2 });
let lock, id;
const password = () => `Aa1!${randomBytes(24).toString('hex')}`;
async function queued(count) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    const row = (await pool.query("select count(*)::int as count from pg_stat_activity where usename = 'supabase_auth_admin' and wait_event_type = 'Lock' and query ilike '%users%' ")).rows[0];
    if (row.count >= count) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Expected Auth lock queue not observed.');
}
try {
  const pw = password();
  const phone = '+12025550190', changedPhone = '+12025550191';
  const user = await auth('POST', '/admin/users', { phone, password: pw, phone_confirm: true, user_metadata: { spike_run_id: randomUUID() } }, { admin: true });
  assert.equal(user.status, 200); id = user.data.id;
  const signed = await auth('POST', '/token?grant_type=password', { phone, password: pw }); assert.equal(signed.status, 200);
  lock = await pool.connect(); await lock.query('begin');
  await lock.query('select id from auth.users where id = $1 for update', [id]);
  const freezing = auth('PUT', `/admin/users/${id}`, { password: password(), ban_duration: '876000h' }, { admin: true });
  await queued(1);
  const inflight = auth('PUT', '/user', { phone: changedPhone }, { token: signed.data.access_token });
  await queued(2);
  await lock.query('commit'); lock.release(); lock = null;
  const frozen = await freezing, late = await inflight;
  assert.equal(frozen.status, 200); assert.equal(late.status, 200);
  const actual = await auth('GET', `/admin/users/${id}`, null, { admin: true });
  assert.equal(actual.data.phone, changedPhone.slice(1));
  const later = await auth('PUT', '/user', { phone }, { token: signed.data.access_token });
  assert.equal(later.status, 403); assert.equal(later.data.error_code, 'session_not_found');
  report.finding = { reproduced: true, freezeStatus: 200, alreadyAuthorizedMutationStatus: 200,
    contactChangedAfterFreeze: true, newlyStartedMutationStatus: 403,
    conclusion: 'Session revocation alone does not fence a request authorized before revocation. A server-only Auth API boundary is required for this architecture.' };
  report.probeCompleted = true;
  console.log('Reproduced: an already-authorized Auth phone update can complete after admin freeze; later requests are rejected.');
} catch {
  report.probeCompleted = false; process.exitCode = 1; console.error('In-flight probe failed; see sanitized statuses.');
} finally {
  if (lock) { await lock.query('rollback').catch(() => {}); lock.release(); }
  if (id) report.cleanup = (await auth('DELETE', `/admin/users/${id}`, null, { admin: true })).status === 200;
  await pool.end(); report.finishedAt = new Date().toISOString();
  await writeFile(new URL('../../../docs/phase-2/F01-inflight-auth-finding.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
}
