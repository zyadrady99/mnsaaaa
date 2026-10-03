import assert from 'node:assert/strict';
import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { localSettings, provider } from './local-runtime.mjs';
import { createRecoveryGateway, digest } from './recovery-gateway.mjs';

const report = { scope: 'local-server-gateway-and-in-person-recovery', startedAt: new Date().toISOString(),
  cliVersion: '2.119.0', authImage: 'gotrue:v2.197.0', pgVersion: '8.23.1', checks: [], requests: [],
  nodeVersion: process.version,
  cleanup: { usersDeleted: false, rowsDeleted: false, runtimeRoleDropped: false, gatewayClosed: false, completed: false },
  limitations: ['Prototype schema only; not F03', 'HTTP loopback cookies omit Secure; production HTTPS not tested',
    'No UI, Data API, Storage, video or subscription integration', 'No automatic recovery after process crash or operator reconciliation',
    'In-flight Auth mutations already authorized before freeze are not covered', 'Rate limits and full T01-T12 acceptance remain incomplete'] };
const runId = randomUUID();
const role = `dorosna_auth_spike_runtime_${runId.replaceAll('-', '')}`;
const runtimePassword = randomBytes(32).toString('hex');
const password = () => `Aa1!${randomBytes(24).toString('hex')}`;
const created = [];
const sensitive = [runtimePassword];
let adminDb, gatewayDb, gateway, settings, auth, activeCheck;
let faultTarget, pauseTarget, releaseFreeze, freezeReached;
const faults = { apply: false };
const calls = [];
function expect(result, status, code) {
  assert.equal(result.status, status);
  if (code) assert.equal(result.data?.error ?? result.data?.error_code, code);
}
async function check(id, description, work) {
  activeCheck = id;
  const started = Date.now();
  try {
    const evidence = await work();
    report.checks.push({ id, description, passed: true, durationMs: Date.now() - started, evidence });
    console.log(`PASS ${id}: ${description}`);
  } catch {
    report.checks.push({ id, description, passed: false, durationMs: Date.now() - started });
    throw new Error('Recovery check failed.');
  }
}
async function http(method, route, body, cookie = '', origin) {
  const response = await fetch(`${gateway.origin}${route}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(method === 'POST' ? { Origin: origin ?? gateway.origin, 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  const setCookie = response.headers.get('set-cookie');
  const cookiePair = setCookie?.split(';')[0];
  if (cookiePair?.includes('=')) sensitive.push(cookiePair.split('=')[1]);
  if (typeof data.token === 'string') sensitive.push(data.token);
  const status = response.status;
  report.requests.push({ source: 'gateway', method, route: route.split('?')[0], status,
    errorCode: typeof data.error === 'string' && /^[a-z_]+$/.test(data.error) ? data.error : null });
  return { status, data, cookie: cookiePair, setCookie, headers: response.headers };
}
async function fixture(name, accountRole = 'student', status = 'active') {
  const originalPassword = password(); sensitive.push(originalPassword);
  let user, phone;
  for (let attempt = 0; attempt < 5; attempt++) {
    phone = `+12025550${randomInt(500, 899)}`;
    user = await auth('POST', '/admin/users', { phone, password: originalPassword, phone_confirm: true,
      ...(status === 'disabled' ? { ban_duration: '876000h' } : {}), user_metadata: { spike_run_id: runId } }, { admin: true });
    if (user.status !== 422 || user.data?.error_code !== 'phone_exists') break;
  }
  assert.equal(user.status, 200);
  const result = { name, id: user.data.id, phone, originalPassword };
  created.push(result);
  await adminDb.query(`insert into auth_spike_private.accounts(id, run_id, phone, role, status) values ($1, $2, $3, $4, $5)`,
    [result.id, runId, phone, accountRole, status]);
  return result;
}
async function issue(target, adminCookie) {
  return http('POST', '/admin/recoveries', { student_id: target.id, reason: 'in_person_verified', verification_ref: 'LOCAL_CENTER_CHECK' }, adminCookie);
}
async function snapshot(target) {
  return (await adminDb.query('select * from auth_spike_private.accounts where id = $1', [target.id])).rows[0];
}
async function stage(target) {
  return (await adminDb.query('select * from auth_spike_private.recoveries where account_id = $1 order by created_at desc limit 1', [target.id])).rows[0];
}
const passwordCalls = target => calls.filter(call => call.target === target.id && call.password).length;
try {
  settings = localSettings();
  sensitive.push(settings.ANON_KEY, settings.SERVICE_ROLE_KEY);
  const rawAuth = provider(settings, report.requests);
  auth = async (method, route, body, options) => {
    if (method === 'PUT' && route.startsWith('/admin/users/')) calls.push({ target: route.split('/').at(-1), password: Boolean(body?.password), freeze: Boolean(body?.ban_duration) });
    const result = await rawAuth(method, route, body, options);
    if (result.data?.access_token) sensitive.push(result.data.access_token);
    if (result.data?.refresh_token) sensitive.push(result.data.refresh_token);
    return result;
  };
  adminDb = new pg.Pool({ connectionString: settings.DB_URL, max: 2, connectionTimeoutMillis: 5000, application_name: 'f01-local-fixtures' });
  // Generated identifier and hex password only. Never accept either from HTTP.
  assert.match(role, /^dorosna_auth_spike_runtime_[a-f0-9]{32}$/);
  assert.match(runtimePassword, /^[a-f0-9]{64}$/);
  await adminDb.query(`create role ${role} login password '${runtimePassword}' nosuperuser nocreatedb nocreaterole inherit nobypassrls`);
  await adminDb.query(`grant dorosna_auth_spike_server to ${role}`);
  const runtimeUrl = new URL(settings.DB_URL); runtimeUrl.username = role; runtimeUrl.password = runtimePassword;
  gatewayDb = new pg.Pool({ connectionString: runtimeUrl.href, max: 6, connectionTimeoutMillis: 5000, application_name: 'f01-local-gateway' });
  gateway = await createRecoveryGateway({ pool: gatewayDb, auth, limits: false,
    afterProviderApply: async grant => { if (faults.apply && grant.account_id === faultTarget) throw new Error('Injected lost success acknowledgement.'); },
    afterProviderFreeze: async grant => { if (grant.account_id === pauseTarget) { freezeReached(); await new Promise(resolve => { releaseFreeze = resolve; }); } },
  });
  report.gatewayHost = '127.0.0.1';
  await check('R01', 'private schema, RLS and restricted server database role', async () => {
    const actualRole = (await gatewayDb.query('select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user')).rows[0];
    assert.equal(actualRole.current_user, role); assert.equal(actualRole.rolsuper, false); assert.equal(actualRole.rolbypassrls, false);
    const policies = (await adminDb.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relnamespace = 'auth_spike_private'::regnamespace and relkind = 'r'`)).rows;
    assert.ok(policies.length >= 4); assert.ok(policies.every(p => p.relrowsecurity && p.relforcerowsecurity));
    for (const clientRole of ['anon', 'authenticated', 'service_role']) {
      const rights = (await adminDb.query(`select has_schema_privilege($1, 'auth_spike_private', 'USAGE') as schema,
        has_table_privilege($1, 'auth_spike_private.recoveries', 'SELECT') as recoveries`, [clientRole])).rows[0];
      assert.equal(rights.schema, false); assert.equal(rights.recoveries, false);
    }
    await assert.rejects(gatewayDb.query('select id from auth.users limit 1'), e => e.code === '42501');
    await assert.rejects(gatewayDb.query('delete from auth_spike_private.audit'), e => e.code === '42501');
    return { privateTables: policies.length, rlsForced: true, clientRolesDenied: 3, serverSuperuser: false, serverAuthTableDenied: true, auditDeleteDenied: true };
  });
  const admin = await fixture('admin', 'admin');
  const student = await fixture('student');
  const other = await fixture('other');
  const disabled = await fixture('disabled', 'student', 'disabled');
  const uncertain = await fixture('uncertain'); faultTarget = uncertain.id;
  let adminCookie, devices, staleProvider, phoneIdentity, studentToken, limitedCookie;
  await check('R02', 'two devices with opaque HttpOnly sessions and server-only provider tokens', async () => {
    const adminLogin = await http('POST', '/login', { phone: admin.phone, password: admin.originalPassword });
    expect(adminLogin, 200); adminCookie = adminLogin.cookie;
    const logins = await Promise.all([1, 2].map(() => http('POST', '/login', { phone: student.phone, password: student.originalPassword })));
    assert.ok(logins.every(login => login.status === 200)); devices = logins.map(login => login.cookie);
    assert.notEqual(devices[0], devices[1]);
    for (const login of logins) {
      assert.match(login.setCookie, /HttpOnly/); assert.match(login.setCookie, /SameSite=Strict/);
      assert.equal(login.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Object.keys(login.data), ['signedIn']);
      assert.match(login.cookie, /^spike_session=[A-Za-z0-9_-]{43}$/);
      expect(await http('GET', '/me', null, login.cookie), 200);
    }
    staleProvider = devices.map(cookie => gateway.providerSessionForTest(cookie));
    const details = await auth('GET', '/user', null, { token: staleProvider[0].access });
    expect(details, 200); phoneIdentity = details.data.identities.find(identity => identity.provider === 'phone').identity_id;
    return { devices: 2, opaqueCookies: true, httpOnly: true, sameSite: 'Strict', providerTokensInResponses: false, loopbackHttpSecureCookie: false };
  });
  await check('R03', 'student metadata forgery cannot gain admin recovery permission', async () => {
    expect(await auth('PUT', '/user', { data: { role: 'admin', status: 'active', auth_epoch: 999 } }, { token: staleProvider[0].access }), 200);
    const identity = await http('GET', '/me', null, devices[0]); expect(identity, 200); assert.equal(identity.data.role, 'student');
    expect(await issue(other, devices[0]), 403, 'forbidden'); expect(await issue(other, ''), 401, 'unauthorized');
    const invalid = await http('POST', '/admin/recoveries', { student_id: student.id, reason: 'not_verified', verification_ref: 'LOCAL' }, adminCookie);
    expect(invalid, 400, 'invalid_request'); assert.equal((await snapshot(student)).auth_epoch, 0);
    expect(await http('POST', '/admin/recoveries', { student_id: student.id, reason: 'in_person_verified', verification_ref: 'LOCAL' }, adminCookie, 'https://attacker.invalid'), 403, 'invalid_origin');
    return { trustedRole: 'student', metadataAdminRejected: true, unverifiedRecoveryRejected: true, crossOriginRejected: true };
  });
  await check('R04', 'admin issuance locks the account and revokes every app session', async () => {
    const issued = await issue(student, adminCookie); expect(issued, 201); studentToken = issued.data.token;
    assert.equal(issued.data.expiresInSeconds, 900);
    const account = await snapshot(student); assert.equal(account.auth_epoch, 1); assert.equal(account.recovery_locked, true); assert.equal(account.status, 'active');
    for (const cookie of devices) expect(await http('GET', '/me', null, cookie), 401, 'unauthorized');
    const grant = await stage(student); assert.equal(grant.stage, 'issued'); assert.equal(grant.token_hash, digest(studentToken));
    assert.notEqual(grant.token_hash, studentToken);
    expect(await http('POST', '/login', { phone: student.phone, password: student.originalPassword }), 401, 'invalid_credentials');
    return { authEpoch: 1, revokedDevices: 2, tokenEntropyBits: 256, storedTokenHashOnly: true, recoveryTtlSeconds: 900 };
  });
  await check('R05', 'stale Auth JWT cannot change password phone email or identity; refresh fails', async () => {
    for (const session of staleProvider) {
      for (const body of [{ password: password() }, { password: password(), current_password: student.originalPassword }, { phone: '+12025550990' }, { email: 'spike@example.invalid' }]) {
        expect(await auth('PUT', '/user', body, { token: session.access }), 403, 'session_not_found');
      }
      assert.ok(phoneIdentity);
      expect(await auth('DELETE', `/user/identities/${phoneIdentity}`, null, { token: session.access }), 403, 'session_not_found');
      const refreshed = await auth('POST', '/token?grant_type=refresh_token', { refresh_token: session.refresh });
      expect(refreshed, 400, 'refresh_token_not_found');
    }
    expect(await auth('POST', '/token?grant_type=password', { phone: student.phone, password: student.originalPassword }), 400, 'user_banned');
    return { oldProviderSessions: 2, deniedMutationsPerSession: 5, jwtError: 'session_not_found', refreshError: 'refresh_token_not_found', directLoginFrozen: true };
  });
  await check('R06', 'one token exchange succeeds under concurrent requests', async () => {
    expect(await http('POST', '/recovery/exchange', { token: randomBytes(32).toString('base64url') }), 400, 'invalid_recovery');
    const exchanges = await Promise.all([1, 2].map(() => http('POST', '/recovery/exchange', { token: studentToken })));
    assert.deepEqual(exchanges.map(r => r.status).sort(), [200, 400]); limitedCookie = exchanges.find(r => r.status === 200).cookie;
    assert.equal((await stage(student)).stage, 'exchanged');
    expect(await http('POST', '/recovery/exchange', { token: studentToken }), 400, 'invalid_recovery');
    return { concurrentRequests: 2, successes: 1, replayRejected: true, unknownTokenRejected: true };
  });
  await check('R07', 'limited recovery cookie authorizes only password setting with CSRF checks', async () => {
    expect(await http('GET', '/me', null, limitedCookie), 401, 'unauthorized');
    expect(await issue(other, limitedCookie), 401, 'unauthorized');
    expect(await http('POST', '/recovery/password', { password: password() }, limitedCookie, 'https://attacker.invalid'), 403, 'invalid_origin');
    expect(await http('POST', '/recovery/password', { password: 'weak' }, limitedCookie), 400, 'invalid_password');
    expect(await http('POST', '/recovery/password', { password: password(), student_id: other.id }, limitedCookie), 400, 'invalid_password');
    assert.equal((await stage(student)).stage, 'exchanged');
    expect(await auth('POST', '/token?grant_type=password', { phone: other.phone, password: other.originalPassword }), 200);
    return { normalSessionDenied: true, adminRouteDenied: true, crossOriginDenied: true, weakPasswordDenied: true, targetOverrideDenied: true };
  });
  await check('R08', 'one password change wins a race and only its new password signs in', async () => {
    const candidates = [password(), password()]; sensitive.push(...candidates);
    const before = passwordCalls(student);
    const changed = await Promise.all(candidates.map(value => http('POST', '/recovery/password', { password: value }, limitedCookie)));
    assert.deepEqual(changed.map(r => r.status).sort(), [200, 400]);
    const winner = candidates[changed.findIndex(r => r.status === 200)];
    const loser = candidates[changed.findIndex(r => r.status !== 200)];
    assert.equal(passwordCalls(student) - before, 1); assert.equal((await stage(student)).stage, 'consumed');
    const account = await snapshot(student); assert.equal(account.recovery_locked, false); assert.equal(account.status, 'active');
    expect(await http('POST', '/recovery/password', { password: password() }, limitedCookie), 400, 'invalid_recovery');
    expect(await http('POST', '/recovery/exchange', { token: studentToken }), 400, 'invalid_recovery');
    expect(await auth('POST', '/token?grant_type=password', { phone: student.phone, password: student.originalPassword }), 400, 'invalid_credentials');
    expect(await auth('POST', '/token?grant_type=password', { phone: student.phone, password: loser }), 400, 'invalid_credentials');
    expect(await auth('PUT', '/user', { password: password() }, { token: staleProvider[0].access }), 403, 'session_not_found');
    const fresh = await Promise.all([1, 2].map(() => http('POST', '/login', { phone: student.phone, password: winner })));
    assert.ok(fresh.every(r => r.status === 200));
    for (const login of fresh) expect(await http('GET', '/me', null, login.cookie), 200);
    const details = await auth('GET', `/admin/users/${student.id}`, null, { admin: true });
    assert.equal(details.data.phone, student.phone.replace('+', '')); assert.equal(details.data.email ?? '', '');
    return { concurrentRequests: 2, providerPasswordChanges: 1, grantConsumed: true, oldPasswordRejected: true, losingPasswordRejected: true, newPasswordDevices: 2, oldJwtStillDenied: true, contactUnchanged: true };
  });
  await check('R09', 'expired or replaced grants fail; concurrent issuance cannot overlap provider work', async () => {
    pauseTarget = other.id;
    const reached = new Promise(resolve => { freezeReached = resolve; });
    const firstPromise = issue(other, adminCookie);
    await Promise.race([reached, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Freeze hook not reached.')), 5000); timer.unref(); })]);
    try { expect(await issue(other, adminCookie), 409, 'review_required'); } finally { releaseFreeze(); pauseTarget = null; }
    const first = await firstPromise; expect(first, 201);
    await adminDb.query("update auth_spike_private.recoveries set expires_at = now() - interval '1 second' where account_id = $1 and stage = 'issued'", [other.id]);
    expect(await http('POST', '/recovery/exchange', { token: first.data.token }), 400, 'invalid_recovery');
    const second = await issue(other, adminCookie); expect(second, 201);
    expect(await http('POST', '/recovery/exchange', { token: first.data.token }), 400, 'invalid_recovery');
    const exchanged = await http('POST', '/recovery/exchange', { token: second.data.token }); expect(exchanged, 200);
    await adminDb.query("update auth_spike_private.recoveries set expires_at = now() - interval '1 second' where account_id = $1 and stage = 'exchanged'", [other.id]);
    const before = passwordCalls(other);
    expect(await http('POST', '/recovery/password', { password: password() }, exchanged.cookie), 400, 'invalid_recovery');
    assert.equal(passwordCalls(other), before); assert.equal((await snapshot(other)).recovery_locked, true);
    return { issuanceOverlapRejected: true, expiredTokenRejected: true, supersededTokenRejected: true, expiredLimitedSessionRejected: true, expiryMethod: 'database clock fixture, no wait' };
  });
  await check('R10', 'recovery preserves a disabled account and provider ban', async () => {
    const issued = await issue(disabled, adminCookie); expect(issued, 201);
    const exchanged = await http('POST', '/recovery/exchange', { token: issued.data.token }); expect(exchanged, 200);
    const value = password(); sensitive.push(value);
    expect(await http('POST', '/recovery/password', { password: value }, exchanged.cookie), 200);
    const account = await snapshot(disabled); assert.equal(account.status, 'disabled'); assert.equal(account.recovery_locked, false);
    assert.equal((await stage(disabled)).stage, 'consumed');
    expect(await http('POST', '/login', { phone: disabled.phone, password: value }), 401, 'invalid_credentials');
    expect(await auth('POST', '/token?grant_type=password', { phone: disabled.phone, password: value }), 400, 'user_banned');
    return { passwordChanged: true, status: 'disabled', appLoginDenied: true, providerLoginDenied: true };
  });
  await check('R11', 'lost acknowledgement after real password update locks recovery for review without replay', async () => {
    const login = await http('POST', '/login', { phone: uncertain.phone, password: uncertain.originalPassword }); expect(login, 200);
    const issued = await issue(uncertain, adminCookie); expect(issued, 201);
    const exchanged = await http('POST', '/recovery/exchange', { token: issued.data.token }); expect(exchanged, 200);
    faults.apply = true;
    const value = password(); sensitive.push(value);
    const before = passwordCalls(uncertain);
    expect(await http('POST', '/recovery/password', { password: value }, exchanged.cookie), 503, 'review_required');
    assert.equal(passwordCalls(uncertain) - before, 1);
    assert.equal((await stage(uncertain)).stage, 'review_uncertain'); assert.equal((await snapshot(uncertain)).recovery_locked, true);
    expect(await http('GET', '/me', null, login.cookie), 401, 'unauthorized');
    expect(await http('POST', '/recovery/password', { password: password() }, exchanged.cookie), 400, 'invalid_recovery');
    expect(await issue(uncertain, adminCookie), 409, 'review_required');
    assert.equal(passwordCalls(uncertain) - before, 1);
    expect(await auth('POST', '/token?grant_type=password', { phone: uncertain.phone, password: value }), 400, 'user_banned');
    return { actualProviderUpdate: true, faultAfterProviderSuccess: true, stage: 'review_uncertain', oldAppSessionDenied: true, providerRemainsBanned: true, secondUpdateCalls: 0, newIssuanceBlocked: true };
  });
  await check('R12', 'audit records actor target reference and time without credentials; HTTP rejects secret URLs', async () => {
    const rows = (await adminDb.query(`select e.* from auth_spike_private.audit e
      join auth_spike_private.accounts a on a.id = e.account_id where a.run_id = $1 order by created_at`, [runId])).rows;
    assert.ok(rows.length >= 20);
    assert.ok(rows.every(row => row.actor_id === admin.id && row.verification_ref === 'LOCAL_CENTER_CHECK' && row.created_at instanceof Date));
    const serialized = JSON.stringify(rows);
    for (const value of sensitive.filter(Boolean)) assert.equal(serialized.includes(value), false);
    assert.ok(rows.some(row => row.event === 'review_required')); assert.ok(rows.some(row => row.event === 'recovery_cancelled'));
    const columns = (await adminDb.query(`select column_name from information_schema.columns where table_schema = 'auth_spike_private'`)).rows.map(row => row.column_name);
    assert.equal(columns.some(column => /password|access_token|refresh_token/.test(column)), false);
    expect(await http('GET', '/recovery/exchange?token=redacted'), 400, 'query_not_allowed');
    expect(await http('GET', '/recovery/password'), 404, 'not_found');
    return { auditEvents: rows.length, actorTargetTimeAndReference: true, credentialFreeAudit: true, noPasswordOrProviderTokenColumns: true, queryTokensRejected: true, getMutationRejected: true };
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.failedAt = activeCheck ?? 'setup';
  // Even assertion errors may contain passwords or JWTs: never print the error.
  report.failureCode = typeof error?.code === 'string' && /^[A-Z0-9_]{1,30}$/.test(error.code) ? error.code : null;
  console.error(`Recovery experiment failed at ${report.failedAt}; only sanitized statuses are saved.`);
  process.exitCode = 1;
} finally {
  if (releaseFreeze) releaseFreeze();
  if (gateway) { await gateway.close().then(() => { report.cleanup.gatewayClosed = true; }).catch(() => {}); }
  if (gatewayDb) await gatewayDb.end().catch(() => {});
  if (adminDb) {
    try {
      // Delete only this run's synthetic rows, in FK order. Retain prototype schema.
      await adminDb.query('begin');
      await adminDb.query('delete from auth_spike_private.audit where account_id in (select id from auth_spike_private.accounts where run_id = $1)', [runId]);
      await adminDb.query('delete from auth_spike_private.recoveries where account_id in (select id from auth_spike_private.accounts where run_id = $1)', [runId]);
      await adminDb.query('delete from auth_spike_private.sessions where account_id in (select id from auth_spike_private.accounts where run_id = $1)', [runId]);
      await adminDb.query('delete from auth_spike_private.accounts where run_id = $1', [runId]);
      await adminDb.query('commit'); report.cleanup.rowsDeleted = true;
    } catch { await adminDb.query('rollback').catch(() => {}); }
  }
  if (auth) {
    let allDeleted = true;
    for (const user of created) {
      try {
        const actual = await auth('GET', `/admin/users/${user.id}`, null, { admin: true });
        assert.equal(actual.data?.user_metadata?.spike_run_id, runId);
        const deleted = await auth('DELETE', `/admin/users/${user.id}`, null, { admin: true });
        assert.equal(deleted.status, 200);
        expect(await auth('GET', `/admin/users/${user.id}`, null, { admin: true }), 404, 'user_not_found');
      } catch { allDeleted = false; }
    }
    report.cleanup.usersDeleted = created.length > 0 && allDeleted;
  }
  if (adminDb) {
    await adminDb.query(`drop role if exists ${role}`).then(() => { report.cleanup.runtimeRoleDropped = true; }).catch(() => {});
    await adminDb.end().catch(() => {});
  }
  report.cleanup.completed = Object.entries(report.cleanup).filter(([key]) => key !== 'completed').every(([, value]) => value);
  if (!report.cleanup.completed) { report.passed = false; process.exitCode = 1; }
  report.fixtureCount = created.length;
  report.finishedAt = new Date().toISOString();
  const serialized = JSON.stringify(report, null, 2);
  assert.ok(sensitive.filter(Boolean).every(value => !serialized.includes(value)));
  await writeFile(new URL('../../../docs/phase-2/F01-recovery-results.json', import.meta.url), `${serialized}\n`);
  console.log(`Cleanup completed: ${report.cleanup.completed}`);
}
