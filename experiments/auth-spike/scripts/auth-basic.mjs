import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This is a local provider experiment, not the platform's auth implementation.
// Credentials and user identifiers stay in memory; reports contain safe facts only.
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const resultPath = fileURLToPath(
  new URL('../../../docs/phase-2/F01-basic-auth-results.json', import.meta.url),
);
const report = {
  scope: 'local-phone-password-provider',
  startedAt: new Date().toISOString(),
  cliVersion: '2.119.0',
  checks: [],
  requests: [],
  cleanup: { attempted: false, sessionsRevoked: false, userDeleted: false, completed: false },
};

const require = createRequire(import.meta.url);
const binaryPackage = path.dirname(
  require.resolve('@supabase/cli-windows-x64/package.json'),
);
const cliPath = path.join(binaryPackage, 'bin', 'supabase.exe');
let apiUrl;
let publicKey;
let adminKey;
let createdUserId;
let lastAccessToken;

function safeErrorCode(body) {
  const code = body?.error_code;
  return typeof code === 'string' && /^[a-z0-9_]{1,80}$/.test(code)
    ? code
    : null;
}

async function request(method, route, body, token = publicKey, privileged = false) {
  const response = await fetch(`${apiUrl}/auth/v1${route}`, {
    method,
    redirect: 'error',
    headers: {
      apikey: privileged ? adminKey : publicKey,
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('The local Auth API returned a non-JSON response.');
    }
  }
  report.requests.push({
    method,
    route: route.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, '[test-user]'),
    status: response.status,
    errorCode: safeErrorCode(data),
  });
  return { status: response.status, ok: response.ok, data };
}

async function check(id, description, work) {
  const startedAt = Date.now();
  try {
    const evidence = await work();
    report.checks.push({ id, description, passed: true, durationMs: Date.now() - startedAt, evidence });
    console.log(`PASS ${id}: ${description}`);
  } catch {
    // Do not stringify provider bodies or assertion values: they can hold tokens.
    report.checks.push({ id, description, passed: false, durationMs: Date.now() - startedAt });
    throw new Error(`Check ${id} failed; inspect sanitized HTTP statuses in the result file.`);
  }
}

function expectRejected(result, errorCode, status) {
  assert.equal(result.ok, false);
  assert.equal(safeErrorCode(result.data), errorCode);
  if (status !== undefined) assert.equal(result.status, status);
  assert.equal(Boolean(result.data?.access_token), false);
  assert.equal(Boolean(result.data?.refresh_token), false);
}

function expectSession(result, expectedUserId) {
  assert.equal(result.status, 200);
  assert.equal(result.data?.user?.id, expectedUserId);
  assert.equal(result.data?.user?.role, 'authenticated');
  assert.equal(typeof result.data?.access_token, 'string');
  assert.ok(result.data.access_token.length > 30);
  assert.equal(typeof result.data?.refresh_token, 'string');
  assert.ok(result.data.refresh_token.length > 10);
  assert.equal(result.data.user.email ?? '', '');
  lastAccessToken = result.data.access_token;
}

try {
  const dockerPath = path.join(
    process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe',
  );
  const status = spawnSync(cliPath, [
    'status', '--workdir', projectRoot, '--output', 'json', '--agent', 'no',
  ], {
    cwd: projectRoot, encoding: 'utf8', timeout: 30_000, windowsHide: true,
    env: { ...process.env, PATH: `${path.dirname(dockerPath)};${process.env.PATH ?? ''}` },
  });
  if (status.error || status.status !== 0) {
    throw new Error('Local CLI status is unavailable; no Auth requests were sent.');
  }
  let settings;
  try {
    settings = JSON.parse(status.stdout);
  } catch {
    throw new Error('Local CLI status could not be parsed; no credentials were printed.');
  }
  apiUrl = settings.API_URL;
  publicKey = settings.ANON_KEY;
  adminKey = settings.SERVICE_ROLE_KEY;
  if (apiUrl !== 'http://127.0.0.1:54321' || !publicKey || !adminKey) {
    throw new Error('This experiment requires its local API and server-only local keys.');
  }
  report.apiOrigin = apiUrl;

  // Refuse a raw CLI launch that publishes the local default keys on all interfaces.
  const inspection = spawnSync(dockerPath, [
    'inspect', 'supabase_db_dorosna-auth-spike',
    'supabase_auth_dorosna-auth-spike', 'supabase_kong_dorosna-auth-spike',
  ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  if (inspection.error || inspection.status !== 0) {
    throw new Error('Local Auth container inspection is unavailable.');
  }
  const containers = JSON.parse(inspection.stdout);
  const runtimeEvidence = [];
  for (const container of containers) {
    assert.equal(container.State.Health.Status, 'healthy');
    const bindings = Object.entries(container.NetworkSettings.Ports).flatMap(
      ([containerPort, values]) => (values ?? []).map(binding => {
        assert.equal(binding.HostIp, '127.0.0.1');
        return { containerPort, hostIp: binding.HostIp, hostPort: binding.HostPort };
      }),
    );
    runtimeEvidence.push({
      name: container.Name, image: container.Config.Image,
      imageId: container.Image, health: 'healthy', bindings,
    });
    if (container.Name === '/supabase_auth_dorosna-auth-spike') {
      assert.ok(container.Config.Env.includes('GOTRUE_EXTERNAL_PHONE_ENABLED=true'));
      assert.ok(!container.Config.Env.some(value => /^GOTRUE_SMS_PROVIDER=.+/.test(value)));
    }
  }
  report.runtime = { localOnly: true, smsProviderConfigured: false, containers: runtimeEvidence };

  await check('B01', 'Auth health endpoint is ready', async () => {
    const result = await request('GET', '/health');
    assert.equal(result.status, 200);
    report.authVersion = result.data?.version;
    return { status: result.status, version: result.data?.version };
  });

  await check('B02', 'Phone provider enabled and public signup disabled', async () => {
    const result = await request('GET', '/settings');
    assert.equal(result.status, 200);
    assert.equal(result.data?.disable_signup, true);
    assert.equal(result.data?.external?.phone, true);
    assert.equal(result.data?.external?.email, false);
    assert.equal(result.data?.phone_autoconfirm, true);
    return { disableSignup: true, phoneProvider: true, emailProvider: false, phoneAutoconfirm: true };
  });

  // The US 202-555-0100..0199 range is fictional. It is never contacted.
  const suffix = randomInt(100);
  const phone = `+120255501${String(suffix).padStart(2, '0')}`;
  const otherPhone = `+120255501${String((suffix + 1) % 100).padStart(2, '0')}`;
  const signupPhone = `+120255501${String((suffix + 2) % 100).padStart(2, '0')}`;
  const password = `Aa1!${randomBytes(24).toString('base64url')}`;
  const otherPassword = `Bb2!${randomBytes(24).toString('base64url')}`;
  const runId = randomUUID();
  let firstRefreshToken;

  await check('B03', 'Server admin creates a phone account without email or OTP', async () => {
    const result = await request('POST', '/admin/users', {
      phone, password, phone_confirm: true,
      user_metadata: { experiment: 'dorosna-auth-basic', spike_run_id: runId },
    }, adminKey, true);
    assert.ok(result.ok);
    // Retain only the exact created identity for cleanup, never a phone lookup.
    if (typeof result.data?.id === 'string' && result.data?.user_metadata?.spike_run_id === runId) {
      createdUserId = result.data.id;
    }
    assert.ok(createdUserId);
    assert.equal(result.data.phone, phone.slice(1));
    assert.equal(result.data.email ?? '', '');
    assert.ok(result.data.phone_confirmed_at);
    assert.equal(result.data.role, 'authenticated');
    return { status: result.status, noEmail: true, phoneAcceptedByAdmin: true };
  });

  await check('B04', 'Password sign-in returns the created identity and a session', async () => {
    const result = await request('POST', '/token?grant_type=password', { phone, password });
    expectSession(result, createdUserId);
    firstRefreshToken = result.data.refresh_token;
    return { status: result.status, correctIdentity: true, hasSession: true };
  });

  await check('B05', 'The signed-in token retrieves the same Auth user', async () => {
    const result = await request('GET', '/user', undefined, lastAccessToken);
    assert.equal(result.status, 200);
    assert.equal(result.data.id, createdUserId);
    return { status: result.status, correctIdentity: true };
  });

  await check('B06', 'Wrong password and unknown phone produce the same error', async () => {
    const wrong = await request('POST', '/token?grant_type=password', { phone, password: otherPassword });
    const unknown = await request('POST', '/token?grant_type=password', { phone: otherPhone, password });
    expectRejected(wrong, 'invalid_credentials', 400);
    expectRejected(unknown, 'invalid_credentials', 400);
    assert.equal(wrong.data?.msg, unknown.data?.msg);
    return { wrongStatus: wrong.status, unknownStatus: unknown.status, errorCode: 'invalid_credentials', sameMessage: true };
  });

  await check('B07', 'Duplicate admin creation is rejected without replacing credentials', async () => {
    const duplicate = await request('POST', '/admin/users', {
      phone, password: otherPassword, phone_confirm: true,
    }, adminKey, true);
    expectRejected(duplicate, 'phone_exists');
    const replacement = await request('POST', '/token?grant_type=password', { phone, password: otherPassword });
    expectRejected(replacement, 'invalid_credentials', 400);
    const original = await request('POST', '/token?grant_type=password', { phone, password });
    expectSession(original, createdUserId);
    const users = await request('GET', '/admin/users?page=1&per_page=1000', undefined, adminKey, true);
    assert.equal(users.status, 200);
    assert.equal(users.data.users.filter(user => user.phone === phone.slice(1)).length, 1);
    return { duplicateStatus: duplicate.status, errorCode: 'phone_exists', originalPasswordPreserved: true, matchingAccounts: 1 };
  });

  await check('B08', 'Public phone and email signup are blocked', async () => {
    const phoneResult = await request('POST', '/signup', { phone: signupPhone, password });
    const emailResult = await request('POST', '/signup', { email: `${runId}@example.invalid`, password });
    expectRejected(phoneResult, 'signup_disabled');
    expectRejected(emailResult, 'signup_disabled');
    return { phoneStatus: phoneResult.status, emailStatus: emailResult.status, errorCode: 'signup_disabled' };
  });

  await check('B09', 'The public key cannot call admin create-user', async () => {
    const result = await request('POST', '/admin/users', { phone: signupPhone, password, phone_confirm: true });
    expectRejected(result, 'not_admin', 403);
    return { status: result.status, errorCode: 'not_admin' };
  });

  await check('B10', 'Local logout revokes its refresh token', async () => {
    // firstRefreshToken belongs to B04; use its own access token below.
    const firstSession = await request('POST', '/token?grant_type=refresh_token', { refresh_token: firstRefreshToken });
    expectSession(firstSession, createdUserId);
    const refreshToken = firstSession.data.refresh_token;
    const result = await request('POST', '/logout?scope=local', undefined, firstSession.data.access_token);
    assert.equal(result.status, 204);
    const refresh = await request('POST', '/token?grant_type=refresh_token', { refresh_token: refreshToken });
    expectRejected(refresh, 'refresh_token_not_found', 400);
    return { logoutStatus: result.status, refreshStatus: refresh.status, errorCode: 'refresh_token_not_found', accessJwtRevocationNotTested: true };
  });

  await check('B11', 'Password sign-in works again after logout', async () => {
    const result = await request('POST', '/token?grant_type=password', { phone, password });
    expectSession(result, createdUserId);
    assert.notEqual(result.data.refresh_token, firstRefreshToken);
    return { status: result.status, correctIdentity: true, newSession: true };
  });
} catch (error) {
  report.failure = error instanceof Error && /^(Check B\d\d failed|Local CLI|Local Auth|This experiment)/.test(error.message)
    ? error.message
    : 'Experiment failed; sensitive error details were suppressed.';
  console.error(report.failure);
} finally {
  if (createdUserId) {
    report.cleanup.attempted = true;
    try {
      if (lastAccessToken) {
        const logout = await request('POST', '/logout?scope=global', undefined, lastAccessToken);
        assert.equal(logout.status, 204);
      }
      report.cleanup.sessionsRevoked = true;
    } catch {
      report.failure ??= 'Test session cleanup needs attention; credentials were not printed.';
    }
    try {
      const deleted = await request('DELETE', `/admin/users/${createdUserId}`, undefined, adminKey, true);
      assert.ok(deleted.ok);
      const missing = await request('GET', `/admin/users/${createdUserId}`, undefined, adminKey, true);
      assert.equal(missing.status, 404);
      report.cleanup.userDeleted = true;
    } catch {
      report.failure ??= 'Test account cleanup needs attention; credentials were not printed.';
    }
    report.cleanup.completed = report.cleanup.sessionsRevoked && report.cleanup.userDeleted;
    console.log(report.cleanup.completed
      ? 'PASS cleanup: test sessions revoked and the created test account removed'
      : 'Test account or session cleanup needs attention.');
  }
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.filter(check => check.passed).length;
  report.failed = report.checks.filter(check => !check.passed).length;
  report.success = report.passed === 11 && report.failed === 0 && report.cleanup.completed && !report.failure;
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Result: ${report.passed} passed, ${report.failed} failed; cleanup=${report.cleanup.completed}`);
  process.exitCode = report.success ? 0 : 1;
}
