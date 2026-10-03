import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { localSettings, provider } from './local-runtime.mjs';

const report = { scope: 'local-provider-recovery-freeze', startedAt: new Date().toISOString(), requests: [], checks: [], cleanup: false };
const auth = provider(localSettings(), report.requests);
const password = () => `Aa1!${randomBytes(24).toString('hex')}`;
const oldPassword = password();
const newPassword = password();
const phone = `+12025550${randomInt(300, 499)}`;
let id;
async function check(name, work) {
  await work(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`);
}
try {
  const user = await auth('POST', '/admin/users', { phone, password: oldPassword, phone_confirm: true, user_metadata: { spike_run_id: randomUUID() } }, { admin: true });
  assert.equal(user.status, 200); id = user.data.id;
  const sessions = await Promise.all([1, 2].map(() => auth('POST', '/token?grant_type=password', { phone, password: oldPassword })));
  assert.ok(sessions.every(s => s.status === 200));
  await check('admin freeze and password rotation', async () => {
    assert.equal((await auth('PUT', `/admin/users/${id}`, { password: password(), ban_duration: '876000h' }, { admin: true })).status, 200);
  });
  await check('old JWT rejects password phone and email mutations', async () => {
    for (const session of sessions) {
      for (const body of [{ password: password() }, { phone: '+12025550990' }, { email: 'spike@example.invalid' }]) {
        const r = await auth('PUT', '/user', body, { token: session.data.access_token });
        assert.equal(r.status, 403); assert.equal(r.data.error_code, 'session_not_found');
      }
      const refresh = await auth('POST', '/token?grant_type=refresh_token', { refresh_token: session.data.refresh_token });
      assert.equal(refresh.status, 400);
    }
  });
  await check('provider login remains frozen while applying new password', async () => {
    assert.equal((await auth('POST', '/token?grant_type=password', { phone, password: oldPassword })).ok, false);
    assert.equal((await auth('PUT', `/admin/users/${id}`, { password: newPassword }, { admin: true })).status, 200);
    const r = await auth('POST', '/token?grant_type=password', { phone, password: newPassword });
    assert.equal(r.ok, false); assert.equal(r.data.error_code, 'user_banned');
  });
  await check('new password login after explicit unfreeze; old JWT still rejected', async () => {
    assert.equal((await auth('PUT', `/admin/users/${id}`, { ban_duration: 'none' }, { admin: true })).status, 200);
    assert.equal((await auth('POST', '/token?grant_type=password', { phone, password: newPassword })).status, 200);
    assert.equal((await auth('POST', '/token?grant_type=password', { phone, password: oldPassword })).ok, false);
    assert.equal((await auth('PUT', '/user', { password: password() }, { token: sessions[0].data.access_token })).status, 403);
    const actual = await auth('GET', `/admin/users/${id}`, null, { admin: true });
    assert.equal(actual.data.phone, phone.replace('+', '')); assert.equal(actual.data.email ?? '', '');
  });
  report.passed = true;
} catch {
  report.passed = false; console.error('Provider revocation probe failed; see sanitized statuses.'); process.exitCode = 1;
} finally {
  if (id) report.cleanup = (await auth('DELETE', `/admin/users/${id}`, null, { admin: true })).status === 200;
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('../../../docs/phase-2/F01-provider-revocation-results.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
}
