import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { localSettings, provider } from './local-runtime.mjs';
import { createRecoveryGateway, digest } from './recovery-gateway.mjs';
import { normalizePhone, rateLimiter } from './registration-service.mjs';

const report = { scope: 'local-registration-faults-limits-and-direct-access', startedAt: new Date().toISOString(),
  nodeVersion: process.version, checks: [], requests: [], cleanup: {}, limitations: [
    'Local Kong guard only; managed Supabase equivalent not proven', 'HTTP loopback only; production HTTPS and browser checks pending',
    'No Storage, product data, subscriptions, UI or final F03 schema', 'Requests admitted before an Auth boundary change need a separate deployment drain policy',
    'Ambiguous missing provider user stays locked for review; no automatic retry of an unknown create request',
    'Rate thresholds and grade fixtures are experiment values, not approved production policy',
  ] };
const runId = randomUUID(), role = `dorosna_auth_spike_runtime_${runId.replaceAll('-', '')}`;
const dbPassword = randomBytes(32).toString('hex'), limiterKey = randomBytes(32);
const sensitive = [dbPassword];
const password = () => { const value = `Aa1!${randomBytes(24).toString('hex')}`; sensitive.push(value); return value; };
const createdIds = new Set(), children = new Set(), gateways = new Set();
let settings, adminDb, runtimeDb, runtimeUrl, auth, rawAuth, gateway, adminCookie, activeCheck;
let failAfterCreatePhone;
let rateWorker;
const authCalls = [];
const expect = (r, status, code) => { assert.equal(r.status, status); if (code) assert.equal(r.data?.error ?? r.data?.error_code ?? r.data?.code, code); };
async function check(id, description, work) {
  activeCheck = id; const start = Date.now();
  try { const evidence = await work(); report.checks.push({ id, description, passed: true, durationMs: Date.now() - start, evidence }); console.log(`PASS ${id}: ${description}`); }
  catch { report.checks.push({ id, description, passed: false }); throw new Error('Check failed.'); }
}
async function http(server, method, route, body, cookie = '', extra = {}) {
  const response = await fetch(`${server.origin}${route}`, { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { ...(method === 'POST' ? { Origin: server.origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json(), pair = response.headers.get('set-cookie')?.split(';')[0];
  if (pair) sensitive.push(pair.split('=')[1]); if (data.token) sensitive.push(data.token);
  report.requests.push({ source: 'gateway', method, route: route.split('?')[0], status: response.status, code: data.error ?? null });
  return { status: response.status, data, cookie: pair, retryAfter: response.headers.get('retry-after') };
}
const post = (route, body, cookie, headers) => http(gateway, 'POST', route, body, cookie, headers);
const register = (body, key = randomUUID(), server = gateway) => http(server, 'POST', '/register', body, '', { 'Idempotency-Key': key });
const login = (phone, value, server = gateway) => http(server, 'POST', '/login', { phone, password: value });
const recoveryBody = target => ({ student_id: target.id, reason: 'in_person_verified', verification_ref: 'LOCAL_CENTER_CHECK' });
const reconcileRegistration = operationId => post('/admin/registrations/reconcile', { operation_id: operationId, reason: 'in_person_verified', verification_ref: 'LOCAL_REGISTRATION_REVIEW' }, adminCookie);
const reconcileRecovery = target => post('/admin/recoveries/reconcile', { ...recoveryBody(target), verification_ref: 'LOCAL_RECOVERY_REVIEW' }, adminCookie);
async function makeGateway(options = {}) {
  const instance = await createRecoveryGateway({ pool: runtimeDb, auth, runId, limits: false,
    checkpoint: async (stage, row) => { if (stage === 'registration_auth_created' && row.phone === failAfterCreatePhone) throw new Error('Injected failure after real Auth create.'); }, ...options });
  gateways.add(instance); return instance;
}
async function fixture(accountRole = 'student', index = randomInt(120, 170)) {
  const phone = `+12025550${index}`, pw = password();
  const response = await auth('POST', '/admin/users', { phone, password: pw, phone_confirm: true, user_metadata: { spike_run_id: runId } }, { admin: true });
  expect(response, 200); const id = response.data.id; createdIds.add(id);
  await adminDb.query(`insert into auth_spike_private.accounts(id, run_id, phone, role, full_name, grade_id) values ($1, $2, $3, $4, 'F01 fixture', 'f01_grade_1')`, [id, runId, phone, accountRole]);
  return { id, phone, pw };
}
async function registrationRow(phone) { return (await adminDb.query('select * from auth_spike_private.registrations where run_id = $1 and phone = $2 order by created_at desc limit 1', [runId, phone])).rows[0]; }
async function snapshot(id) { return (await adminDb.query('select * from auth_spike_private.accounts where id = $1', [id])).rows[0]; }
async function providerCount() { return (await adminDb.query("select count(*)::int as count from auth.users where raw_user_meta_data ->> 'spike_run_id' = $1", [runId])).rows[0].count; }
async function worker(pauseAt, { limits } = {}) {
  const child = fork(fileURLToPath(new URL('./auth-worker.mjs', import.meta.url)), [], { execPath: 'C:\\Program Files\\nodejs\\node.exe', execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  children.add(child); const messages = [];
  child.once('exit', () => children.delete(child));
  child.on('message', message => messages.push(message));
  child.send({ settings, dbUrl: runtimeUrl.href, runId, pauseAt, ...(limits ? { limits: { ...limits, key: undefined, keyHex: limits.key.toString('hex') } } : {}) });
  async function wait(type) {
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const message = messages.find(m => m.type === type); if (message) return message;
      if (child.exitCode !== null || messages.some(m => m.type === 'failed')) throw new Error('Worker failed.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Worker checkpoint timeout.');
  }
  const ready = await wait('ready');
  return { origin: ready.origin, checkpoint: () => wait('checkpoint'), kill: () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker kill timeout.')), 5000);
    child.once('exit', () => { clearTimeout(timer); children.delete(child); resolve(); }); child.kill();
  }) };
}
try {
  settings = localSettings(); sensitive.push(settings.SERVICE_ROLE_KEY, settings.ANON_KEY);
  rawAuth = provider(settings, report.requests);
  auth = async (method, route, body, options) => {
    if (method === 'POST' && route === '/admin/users') authCalls.push({ type: 'create', id: body.id });
    const result = await rawAuth(method, route, body, { server: true, ...options });
    if (result.data?.access_token) sensitive.push(result.data.access_token); if (result.data?.refresh_token) sensitive.push(result.data.refresh_token);
    return result;
  };
  adminDb = new pg.Pool({ connectionString: settings.DB_URL, max: 3 });
  await adminDb.query(`create role ${role} login password '${dbPassword}' nosuperuser nocreatedb nocreaterole inherit nobypassrls`);
  await adminDb.query(`grant dorosna_auth_spike_server to ${role}`);
  runtimeUrl = new URL(settings.DB_URL); runtimeUrl.username = role; runtimeUrl.password = dbPassword;
  runtimeDb = new pg.Pool({ connectionString: runtimeUrl.href, max: 10, connectionTimeoutMillis: 5000 });
  gateway = await makeGateway();
  const admin = await fixture('admin', 110);
  adminCookie = (await login(admin.phone, admin.pw)).cookie; assert.ok(adminCookie);
  const phone = `+2010555${randomInt(10000, 99999)}`, local = `0${phone.slice(3)}`;
  const originalPassword = password(), firstKey = randomUUID();
  const payload = { full_name: '  طالب   تجربة  ', grade_id: 'f01_grade_1', phone: local, password: originalPassword };
  let student, studentCookie, userJwt;
  await check('S01', 'validate required fields and normalize Arabic Persian Egyptian and international phone forms', async () => {
    const arabic = local.replace(/[0-9]/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
    const persian = local.replace(/[0-9]/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
    for (const value of [local, arabic, persian, phone, phone.slice(1), `00${phone.slice(1)}`, `${local.slice(0, 3)} ${local.slice(3, 6)}-${local.slice(6)}`]) assert.equal(normalizePhone(value), phone);
    for (const value of ['01312345678', '+201312345678', '011abc12345', '', '+0201234']) assert.equal(normalizePhone(value), null);
    const missing = await register({}); expect(missing, 422, 'invalid_fields'); assert.deepEqual(missing.data.fields.sort(), ['full_name', 'grade_id', 'password', 'phone']);
    expect(await register({ ...payload, grade_id: 'unknown' }), 422, 'invalid_fields');
    expect(await register({ ...payload, role: 'admin' }), 422, 'invalid_fields');
    expect(await register({ ...payload, password: 'weak' }), 422, 'invalid_fields');
    assert.throws(() => rateLimiter({}, { scope: runId }));
    return { equivalentFormats: 7, requiredFields: 4, unknownGradeRejected: true, roleFieldRejected: true, weakPasswordRejected: true };
  });
  await check('S02', 'full registration creates one confirmed phone identity and a trusted student profile', async () => {
    const received = await register(payload, firstKey); expect(received, 202); assert.deepEqual(received.data, { registrationReceived: true });
    student = await registrationRow(phone); assert.equal(student.stage, 'complete'); createdIds.add(student.auth_user_id);
    const profile = await snapshot(student.auth_user_id); assert.equal(profile.full_name, 'طالب تجربة'); assert.equal(profile.grade_id, 'f01_grade_1'); assert.equal(profile.role, 'student'); assert.equal(profile.provisioning_locked, false);
    const signed = await login(local.replace(/[0-9]/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]), originalPassword); expect(signed, 200); studentCookie = signed.cookie;
    const me = await http(gateway, 'GET', '/me', null, studentCookie); expect(me, 200); assert.equal(me.data.full_name, 'طالب تجربة');
    const actual = await auth('GET', `/admin/users/${student.auth_user_id}`, null, { admin: true }); assert.equal(actual.data.phone, phone.slice(1)); assert.equal(actual.data.email ?? '', '');
    userJwt = gateway.providerSessionForTest(studentCookie).access;
    return { trustedRole: 'student', nameAndGradeStored: true, canonicalPhone: true, emailRequired: false, otpRequests: 0, opaqueSession: true };
  });
  await check('S03', 'concurrent phone aliases and idempotent retries cannot create or overwrite a second identity', async () => {
    const racePhone = `+2011555${randomInt(10000, 99999)}`, raceLocal = `0${racePhone.slice(3)}`;
    const values = [password(), password()], bodies = values.map((pw, index) => ({ ...payload, full_name: `F01 candidate ${index}`, phone: index ? `00${racePhone.slice(1)}` : raceLocal, password: pw }));
    const keys = [randomUUID(), randomUUID()], before = authCalls.length;
    const results = await Promise.all(bodies.map((body, index) => register(body, keys[index]))); assert.ok(results.every(r => r.status === 202));
    assert.equal(authCalls.length - before, 1);
    const row = await registrationRow(racePhone); createdIds.add(row.auth_user_id);
    const winner = bodies.findIndex(body => body.full_name === row.full_name);
    expect(await login(raceLocal, values[winner]), 200); expect(await login(racePhone, values[1 - winner]), 401, 'invalid_credentials');
    expect(await register({ ...bodies[winner], password: values[1 - winner] }, keys[winner]), 202);
    assert.equal(authCalls.length - before, 1); expect(await login(racePhone, values[winner]), 200);
    expect(await register({ ...bodies[winner], full_name: 'changed' }, keys[winner]), 409, 'request_conflict');
    const duplicate = await register({ ...payload, password: password() }); expect(duplicate, 202); assert.deepEqual(duplicate.data, { registrationReceived: true });
    // Hold only a fixture table lock until both real requests have read no key
    // and reached INSERT. This forces the previously missed key-conflict race.
    const sharedKey = randomUUID(), sharedPhone = `+2010555${randomInt(10000, 99999)}`;
    const lock = await adminDb.connect(); let competing;
    try {
      await lock.query('begin'); await lock.query('lock table auth_spike_private.registrations in share mode');
      competing = Promise.all([0, 1].map(index => register({ ...payload, phone: sharedPhone, full_name: `F01 same key ${index}`, password: password() }, sharedKey)));
      const until = Date.now() + 1500; let waiting = 0;
      while (Date.now() < until && waiting < 2) {
        waiting = (await adminDb.query("select count(*)::int as count from pg_stat_activity where usename=$1 and wait_event_type='Lock' and query like 'insert into auth_spike_private.registrations%'", [role])).rows[0].count;
        if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, 2);
    } finally { await lock.query('rollback'); lock.release(); }
    const collided = await competing; assert.deepEqual(collided.map(r => r.status).sort(), [202, 409]);
    const sameKeyRow = await registrationRow(sharedPhone); createdIds.add(sameKeyRow.auth_user_id);
    assert.equal(authCalls.length - before, 2);
    return { competingRequests: 2, providerCreates: 1, winnerPasswordPreserved: true, retryPasswordIgnored: true, changedRequestRejected: true, genericDuplicateResponse: true, forcedConcurrentKeyConflictRejected: true };
  });
  await check('S04', 'public native Auth endpoints reject clients including leaked JWT and forged headers', async () => {
    for (const [method, route, body] of [['POST', '/token?grant_type=password', { phone, password: originalPassword }], ['PUT', '/user', { phone: '+12025550191' }], ['PUT', '/user', { password: password() }], ['PUT', '/user', { data: { role: 'admin' } }], ['POST', '/otp', { phone }], ['POST', '/signup', { phone, password: password() }], ['POST', '/verify', { type: 'sms', phone, token: '000000' }], ['GET', '/authorize', null]]) {
      expect(await rawAuth(method, route, body, { token: userJwt }), 401);
    }
    const spoofed = await fetch(`${settings.API_URL}/auth/v1/user`, { headers: { apikey: settings.ANON_KEY, Authorization: `Bearer ${userJwt}`, 'X-Consumer-Groups': 'f01_auth_server', 'X-Consumer-Username': 'f01_server_auth' } }); assert.equal(spoofed.status, 401);
    expect(await auth('GET', '/health'), 200);
    const finding = JSON.parse(await readFile(new URL('../../../docs/phase-2/F01-inflight-auth-finding.json', import.meta.url), 'utf8')); assert.equal(finding.finding.reproduced, true); assert.equal(finding.cleanup, true);
    return { deniedPublicAuthRequests: 9, status: 401, spoofedConsumerHeadersRejected: true, serverAuthHealthy: true, priorInFlightCounterexampleRecorded: true, boundary: 'owned local Kong, four Auth services' };
  });
  await check('S05', 'gateway binds the current profile and rejects student admin routes and foreign identifiers', async () => {
    expect(await post('/admin/recoveries', recoveryBody({ id: admin.id }), studentCookie), 403, 'forbidden');
    expect(await http(gateway, 'GET', `/me?student_id=${admin.id}`, null, studentCookie), 400, 'query_not_allowed');
    const me = await http(gateway, 'GET', '/me', null, studentCookie); assert.equal(me.data.id, student.auth_user_id); assert.equal(me.data.role, 'student');
    expect(await post('/admin/registrations/reconcile', { operation_id: student.operation_id, reason: 'in_person_verified', verification_ref: 'LOCAL' }, studentCookie), 403, 'forbidden');
    return { profileBoundToSession: true, foreignIdentifierRejected: true, studentAdminDenied: true };
  });
  await check('S06', 'real Data API denies private own foreign write and RPC access with a valid JWT', async () => {
    const root = await fetch(`${settings.API_URL}/rest/v1/`, { headers: { apikey: settings.ANON_KEY } }); assert.equal(root.status, 200);
    let denied = 0;
    for (const [method, route, body] of [['GET', `/accounts?id=eq.${student.auth_user_id}&select=id,full_name`, null], ['GET', `/accounts?id=eq.${admin.id}&select=id,full_name`, null], ['PATCH', `/accounts?id=eq.${student.auth_user_id}`, { role: 'admin' }], ['GET', '/registrations?select=auth_user_id', null], ['POST', '/rpc/f01_rpc_probe', {}]]) {
      const response = await fetch(`${settings.API_URL}/rest/v1${route}`, { method, headers: { apikey: settings.ANON_KEY, Authorization: `Bearer ${userJwt}`, 'Accept-Profile': 'auth_spike_private', 'Content-Profile': 'auth_spike_private', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); report.requests.push({ source: 'data-api', method, route: route.split('?')[0], status: response.status, code: data.code });
      assert.equal(response.status, 403); assert.equal(data.code, '42501'); denied++;
    }
    return { dataApiReady: true, privateSchemaDeliberatelyExposedForNegativeProbe: true, actualPermissionDenials: denied, status: 403, postgresCode: '42501', jwtValidAtProbe: true };
  });
  await check('S07', 'login limits are atomic shared across processes restart persistent and ignore spoofed IP', async () => {
    const limits = { key: limiterKey, scope: runId, windowSeconds: 60, caps: { login: [3, 3], register: [3, 3], exchange: [3, 3], password: [3, 3] } };
    const a = await worker(null, { limits }), b = await worker(null, { limits });
    const answers = await Promise.all(Array.from({ length: 6 }, (_, index) => login(index % 2 ? phone : local, password(), index % 2 ? a : b)));
    assert.equal(answers.filter(r => r.status === 401).length, 3); assert.equal(answers.filter(r => r.status === 429).length, 3);
    await a.kill(); const restarted = await worker(null, { limits });
    const limited = await http(restarted, 'POST', '/login', { phone, password: originalPassword }, '', { 'X-Forwarded-For': '203.0.113.111' }); expect(limited, 429, 'rate_limited'); assert.ok(Number(limited.retryAfter) >= 1);
    await adminDb.query("update auth_spike_private.request_limits set reset_at = now() - interval '1 second' where scope_hash = $1", [digest(runId)]);
    expect(await login(local, originalPassword, restarted), 200);
    const wrong = await login(phone, password(), restarted), unknown = await login('+12025550199', password(), restarted);
    expect(wrong, 401, 'invalid_credentials'); expect(unknown, 401, 'invalid_credentials'); assert.deepEqual(wrong.data, unknown.data);
    rateWorker = b;
    await restarted.kill();
    return { distinctWorkerProcesses: 2, actualProcessRestart: true, concurrentAttempts: 6, admitted: 3, denied: 3, restartPreservedLimit: true, forwardedIpIgnored: true, retryAfterPresent: true, windowResetRestoresLogin: true, wrongAndUnknownSameBody: true };
  });
  await check('S08', 'registration and recovery guessing limits cannot be bypassed by changing request keys', async () => {
    const rated = rateWorker;
    await adminDb.query("update auth_spike_private.request_limits set reset_at = now() - interval '1 second' where scope_hash = $1", [digest(runId)]);
    const answers = await Promise.all(Array.from({ length: 6 }, () => register(payload, randomUUID(), rated)));
    assert.equal(answers.filter(r => r.status === 202).length, 3); assert.equal(answers.filter(r => r.status === 429).length, 3);
    for (const route of ['/recovery/exchange', '/recovery/password']) {
      const results = [];
      for (let n = 0; n < 4; n++) results.push(await http(rated, 'POST', route, route.endsWith('exchange') ? { token: randomBytes(32).toString('base64url') } : { password: password() }, `spike_recovery=${randomBytes(32).toString('base64url')}`, { 'X-Forwarded-For': `203.0.113.${n}` }));
      assert.ok(results.slice(0, 3).every(r => r.status === 400)); expect(results[3], 429, 'rate_limited');
    }
    const columns = (await adminDb.query("select column_name from information_schema.columns where table_schema = 'auth_spike_private' and table_name = 'request_limits'")).rows.map(row => row.column_name);
    assert.ok(columns.every(column => !/phone|ip|token|password/.test(column)));
    await rated.kill();
    return { registrationAdmitted: 3, registrationDenied: 3, exchangeGuessingBounded: true, passwordGuessingBounded: true, countersContainNoRawIdentifiers: true };
  });
  await check('S09', 'real Auth create followed by profile failure is reconciled without repeating password or creation', async () => {
    const failedPhone = `+2012555${randomInt(10000, 99999)}`, key = randomUUID(), pw = password(); failAfterCreatePhone = failedPhone;
    const body = { ...payload, phone: failedPhone, password: pw };
    expect(await register(body, key), 202); const row = await registrationRow(failedPhone); createdIds.add(row.auth_user_id); assert.equal(row.stage, 'review_uncertain'); assert.equal(await snapshot(row.auth_user_id), undefined);
    expect(await login(failedPhone, pw), 401, 'invalid_credentials'); expect(await auth('POST', '/token?grant_type=password', { phone: failedPhone, password: pw }), 400, 'user_banned');
    const creates = authCalls.length; expect(await register({ ...body, password: password() }, key), 202); assert.equal(authCalls.length, creates);
    expect(await reconcileRegistration(row.operation_id), 200); assert.equal((await registrationRow(failedPhone)).stage, 'complete');
    expect(await login(failedPhone, pw), 200); assert.equal(authCalls.length, creates);
    const audited = await registrationRow(failedPhone); assert.equal(audited.reconciled_by, admin.id); assert.equal(audited.reconciliation_ref, 'LOCAL_REGISTRATION_REVIEW');
    const providerRequests = report.requests.filter(r => !r.source).length;
    expect(await reconcileRegistration(row.operation_id), 200);
    assert.equal(report.requests.filter(r => !r.source).length, providerRequests);
    failAfterCreatePhone = null;
    return { realProviderCreation: true, failedProfileBlockedLogin: true, providerFrozenUntilReconciliation: true, repeatCreates: 0, originalPasswordPreserved: true, adminReconciliationRecorded: true, completedReviewDoesNotTouchProvider: true };
  });
  await check('S10', 'actual process termination at four registration phases remains recoverable and rejects a live-worker takeover', async () => {
    const evidence = [];
    for (const pauseAt of ['registration_reserved', 'registration_auth_created', 'registration_profiled', 'registration_unfrozen']) {
      const workerPhone = `+2015555${randomInt(10000, 99999)}`, pw = password(), body = { ...payload, phone: workerPhone, password: pw }, key = randomUUID();
      const child = await worker(pauseAt);
      const inflight = register(body, key, child).catch(() => ({ connectionClosed: true }));
      await child.checkpoint(); const row = await registrationRow(workerPhone);
      expect(await reconcileRegistration(row.operation_id), 409, 'operation_busy');
      await child.kill(); assert.equal((await inflight).connectionClosed, true);
      expect(await login(workerPhone, pw), 401, 'invalid_credentials');
      const result = await reconcileRegistration(row.operation_id); expect(result, 200);
      if (pauseAt === 'registration_reserved') {
        assert.equal(result.data.retryWithNewRequest, true); assert.equal((await registrationRow(workerPhone)).stage, 'cancelled');
        const providerRequests = report.requests.filter(r => !r.source).length;
        const replay = await reconcileRegistration(row.operation_id); expect(replay, 200); assert.equal(replay.data.retryWithNewRequest, true);
        assert.equal(report.requests.filter(r => !r.source).length, providerRequests);
        expect(await register(body, randomUUID()), 202);
      }
      const current = await registrationRow(workerPhone); createdIds.add(current.auth_user_id);
      assert.equal(current.stage, 'complete'); expect(await login(workerPhone, pw), 200);
      evidence.push({ phase: pauseAt, processTerminated: true, liveTakeoverDenied: true, recovered: true });
    }
    return { phases: evidence, passwordsWrittenToDisk: false, unknownProviderCreateAutomaticallyRetried: false };
  });
  await check('S11', 'actual process termination at six recovery phases is fenced and an audited fresh grant restores access', async () => {
    const evidence = [];
    const phases = ['recovery_prepared', 'recovery_frozen', 'recovery_claimed', 'recovery_password_set', 'recovery_applied', 'recovery_unfrozen'];
    for (let index = 0; index < phases.length; index++) {
      const target = await fixture('student', 140 + index), old = await login(target.phone, target.pw); expect(old, 200);
      const pauseAt = phases[index], child = await worker(pauseAt);
      let oldLimited, request;
      if (index < 2) request = http(child, 'POST', '/admin/recoveries', recoveryBody(target), adminCookie).catch(() => ({ connectionClosed: true }));
      else {
        const issued = await post('/admin/recoveries', recoveryBody(target), adminCookie); expect(issued, 201);
        const exchanged = await post('/recovery/exchange', { token: issued.data.token }); expect(exchanged, 200); oldLimited = exchanged.cookie;
        request = http(child, 'POST', '/recovery/password', { password: password() }, oldLimited).catch(() => ({ connectionClosed: true }));
      }
      await child.checkpoint(); expect(await reconcileRecovery(target), 409, 'operation_busy');
      await child.kill(); assert.equal((await request).connectionClosed, true);
      expect(await http(gateway, 'GET', '/me', null, old.cookie), 401, 'unauthorized'); assert.equal((await snapshot(target.id)).recovery_locked, true);
      if (oldLimited) expect(await post('/recovery/password', { password: password() }, oldLimited), 400, 'invalid_recovery');
      const replacement = await reconcileRecovery(target); expect(replacement, 201); assert.equal(replacement.data.reconciled, true);
      const exchanged = await post('/recovery/exchange', { token: replacement.data.token }); expect(exchanged, 200);
      const newPw = password(); expect(await post('/recovery/password', { password: newPw }, exchanged.cookie), 200);
      expect(await login(target.phone, newPw), 200); expect(await login(target.phone, target.pw), 401, 'invalid_credentials');
      if (oldLimited) expect(await post('/recovery/password', { password: password() }, oldLimited), 400, 'invalid_recovery');
      const audit = (await adminDb.query("select count(*)::int as count from auth_spike_private.audit where account_id = $1 and verification_ref = 'LOCAL_RECOVERY_REVIEW'", [target.id])).rows[0]; assert.ok(audit.count >= 3);
      evidence.push({ phase: pauseAt, processTerminated: true, concurrentReconcileDenied: true, staleAppSessionDenied: true, freshGrantRestoredLogin: true });
    }
    return { phases: evidence, actualWorkerKills: 6, providerUpdatesReal: true, reconciliationAuditRecorded: true };
  });
  await check('S12', 'revoked JWT still cannot read private data and all seven private tables enforce RLS', async () => {
    const target = { id: student.auth_user_id };
    const issued = await post('/admin/recoveries', recoveryBody(target), adminCookie); expect(issued, 201);
    const data = await fetch(`${settings.API_URL}/rest/v1/accounts?select=id`, { headers: { apikey: settings.ANON_KEY, Authorization: `Bearer ${userJwt}`, 'Accept-Profile': 'auth_spike_private' } }); assert.equal(data.status, 403); assert.equal((await data.json()).code, '42501');
    const tables = (await adminDb.query("select relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'auth_spike_private'::regnamespace and relkind = 'r'")).rows;
    assert.equal(tables.length, 7); assert.ok(tables.every(table => table.relrowsecurity && table.relforcerowsecurity));
    await assert.rejects(runtimeDb.query('select id from auth.users limit 1'), e => e.code === '42501');
    const audit = JSON.stringify((await adminDb.query('select e.* from auth_spike_private.audit e join auth_spike_private.accounts a on a.id=e.account_id where a.run_id=$1', [runId])).rows);
    assert.ok(sensitive.filter(Boolean).every(value => !audit.includes(value)));
    return { revokedJwtDataDenied: true, actualPermissionCode: '42501', privateTables: 7, forcedRls: true, runtimeAuthReadDenied: true, credentialFreeAudit: true };
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.failedAt = activeCheck ?? 'setup'; report.failureCode = /^[A-Z0-9_]{1,30}$/.test(error.code ?? '') ? error.code : null;
  console.error(`Registration experiment failed at ${report.failedAt}; raw errors and credentials withheld.`); process.exitCode = 1;
} finally {
  await Promise.all([...children].map(child => new Promise(resolve => { child.once('exit', resolve); child.kill(); })));
  for (const server of gateways) await server.close().catch(() => {});
  if (runtimeDb) await runtimeDb.end().catch(() => {});
  if (adminDb) {
    const rows = (await adminDb.query('select auth_user_id from auth_spike_private.registrations where run_id = $1', [runId]).catch(() => ({ rows: [] }))).rows;
    for (const row of rows) createdIds.add(row.auth_user_id);
    try {
      await adminDb.query('begin');
      for (const table of ['registrations', 'audit', 'recoveries', 'sessions']) {
        const column = table === 'registrations' ? 'run_id' : 'account_id';
        await adminDb.query(`delete from auth_spike_private.${table} where ${column} ${table === 'registrations' ? '= $1' : 'in (select id from auth_spike_private.accounts where run_id = $1)'}`, [runId]);
      }
      await adminDb.query('delete from auth_spike_private.accounts where run_id = $1', [runId]);
      await adminDb.query('delete from auth_spike_private.request_limits where scope_hash = $1', [digest(runId)]);
      await adminDb.query('commit'); report.cleanup.rowsDeleted = true;
    } catch { await adminDb.query('rollback').catch(() => {}); report.cleanup.rowsDeleted = false; }
  }
  let deleted = true, deletedCount = 0;
  if (auth) for (const id of createdIds) {
    try {
      const actual = await auth('GET', `/admin/users/${id}`, null, { admin: true });
      if (actual.status === 404) continue;
      assert.equal(actual.data?.user_metadata?.spike_run_id, runId); expect(await auth('DELETE', `/admin/users/${id}`, null, { admin: true }), 200);
      expect(await auth('GET', `/admin/users/${id}`, null, { admin: true }), 404, 'user_not_found'); deletedCount++;
    } catch { deleted = false; }
  }
  report.cleanup.usersDeleted = deleted; report.cleanup.syntheticUsersDeleted = deletedCount;
  if (adminDb) { await adminDb.query(`drop role if exists ${role}`).then(() => { report.cleanup.runtimeRoleDropped = true; }).catch(() => { report.cleanup.runtimeRoleDropped = false; }); await adminDb.end(); }
  report.cleanup.completed = report.cleanup.rowsDeleted && report.cleanup.usersDeleted && report.cleanup.runtimeRoleDropped && children.size === 0;
  if (!report.cleanup.completed) { report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); const output = JSON.stringify(report, null, 2);
  assert.ok(sensitive.filter(Boolean).every(value => !output.includes(value)));
  await writeFile(new URL('../../../docs/phase-2/F01-registration-results.json', import.meta.url), `${output}\n`);
  console.log(`Cleanup completed: ${report.cleanup.completed}`);
}
