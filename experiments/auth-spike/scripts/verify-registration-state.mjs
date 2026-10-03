import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { localSettings, provider, projectRoot } from './local-runtime.mjs';

const report = { scope: 'post-registration-local-state', checkedAt: new Date().toISOString() };
let pool, stage = 'settings';
try {
  const settings = localSettings();
  pool = new pg.Pool({ connectionString: settings.DB_URL, max: 1, connectionTimeoutMillis: 5000 });
  stage = 'synthetic-data';
  report.rows = (await pool.query(`select
    (select count(*)::int from auth_spike_private.accounts) as accounts,
    (select count(*)::int from auth_spike_private.sessions) as sessions,
    (select count(*)::int from auth_spike_private.recoveries) as recoveries,
    (select count(*)::int from auth_spike_private.audit) as audit,
    (select count(*)::int from auth_spike_private.registrations) as registrations,
    (select count(*)::int from auth_spike_private.request_limits) as request_limits,
    (select count(*)::int from auth.users where raw_user_meta_data ? 'spike_run_id') as synthetic_auth_users,
    (select count(*)::int from pg_roles where rolname like 'dorosna_auth_spike_runtime_%') as temporary_runtime_roles`)).rows[0];
  assert.ok(Object.values(report.rows).every(count => count === 0));
  report.gradeConfigurationRows = (await pool.query('select count(*)::int as count from auth_spike_private.grades')).rows[0].count;
  assert.equal(report.gradeConfigurationRows, 2);
  const tables = (await pool.query("select relrowsecurity, relforcerowsecurity from pg_class where relnamespace='auth_spike_private'::regnamespace and relkind='r'")).rows;
  report.privateTables = { count: tables.length, allRlsEnabledAndForced: tables.every(t => t.relrowsecurity && t.relforcerowsecurity) };
  assert.equal(tables.length, 7); assert.equal(report.privateTables.allRlsEnabledAndForced, true);
  report.clientSchemaUsage = (await pool.query("select r as role, has_schema_privilege(r, 'auth_spike_private', 'USAGE') as allowed from unnest(array['anon','authenticated','service_role']) r")).rows;
  assert.ok(report.clientSchemaUsage.every(r => !r.allowed));
  const serviceRole = (await pool.query("select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname='dorosna_auth_spike_server'")).rows[0];
  assert.ok(serviceRole && !serviceRole.rolcanlogin && !serviceRole.rolsuper && !serviceRole.rolbypassrls);
  report.serverRole = { exists: true, canLogin: false, superuser: false, bypassRls: false };

  stage = 'containers';
  const docker = path.join(process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe');
  const names = ['db', 'auth', 'kong', 'rest'].map(name => `supabase_${name}_dorosna-auth-spike`);
  const inspected = spawnSync(docker, ['inspect', ...names], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (inspected.status !== 0) throw new Error('Local container inspection unavailable.');
  const containers = JSON.parse(inspected.stdout);
  report.containers = containers.map(container => ({
    name: container.Name.substring(1), image: container.Config.Image, running: container.State.Running,
    health: container.State.Health?.Status ?? null,
    publishedPorts: Object.entries(container.NetworkSettings.Ports).flatMap(([port, entries]) => (entries ?? []).map(entry => ({ port, host: entry.HostIp, hostPort: entry.HostPort }))),
  }));
  assert.ok(report.containers.every(container => container.running && (container.health === 'healthy' || container.name.includes('_rest_') && container.health === null) && container.publishedPorts.every(port => port.host === '127.0.0.1')));
  assert.ok(report.containers.filter(c => /_(auth|rest)_/.test(c.name)).every(c => c.publishedPorts.length === 0));
  const authEnvironment = containers.find(c => c.Name.includes('_auth_')).Config.Env;
  report.phoneProvider = { enabled: authEnvironment.includes('GOTRUE_EXTERNAL_PHONE_ENABLED=true'), smsProviderConfigured: authEnvironment.some(e => /^GOTRUE_SMS_PROVIDER=.+/.test(e)) };
  assert.equal(report.phoneProvider.enabled, true); assert.equal(report.phoneProvider.smsProviderConfigured, false);

  stage = 'http-boundaries';
  const auth = provider(settings);
  const denied = await auth('POST', '/token?grant_type=password', { phone: '+12025550199', password: 'invalid-fixture' });
  const server = await auth('GET', '/health', null, { server: true });
  const rest = await fetch(`${settings.API_URL}/rest/v1/`, { headers: { apikey: settings.ANON_KEY }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  await rest.text();
  const privateData = await fetch(`${settings.API_URL}/rest/v1/accounts?select=id`, {
    headers: { apikey: settings.SERVICE_ROLE_KEY, Authorization: `Bearer ${settings.SERVICE_ROLE_KEY}`, 'Accept-Profile': 'auth_spike_private' },
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  const privateCode = (await privateData.json()).code;
  report.http = { publicAuthTokenStatus: denied.status, serverAuthHealthStatus: server.status, dataApiRootStatus: rest.status,
    privateDataServiceRoleStatus: privateData.status, privateDataPermissionCode: privateCode };
  assert.equal(denied.status, 401); assert.equal(server.status, 200); assert.equal(rest.status, 200);
  assert.equal(privateData.status, 403); assert.equal(privateCode, '42501');

  stage = 'advisors';
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')), 'bin', 'supabase.exe');
  const advisor = spawnSync(cli, ['db', 'advisors', '--local', '--type', 'all', '--level', 'info', '--fail-on', 'error', '--output', 'json', '--workdir', projectRoot, '--agent', 'no'], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000, env: { ...process.env, PATH: `${path.dirname(docker)};${process.env.PATH ?? ''}` },
  });
  const advisorItems = advisor.stdout.trim() ? JSON.parse(advisor.stdout) : [];
  assert.ok(Array.isArray(advisorItems));
  report.advisors = { exitCode: advisor.status, noIssuesReported: /No issues found/.test(`${advisor.stdout}\n${advisor.stderr}`),
    jsonReturned: Boolean(advisor.stdout.trim()), findings: advisorItems.map(item => ({ name: item.name, level: item.level,
      categories: item.categories, schema: item.metadata?.schema, table: item.metadata?.name })) };
  assert.equal(advisor.status, 0);
  if (advisorItems.length === 0) assert.equal(report.advisors.noIssuesReported, true);
  // New fixture indexes can be reported as unused after a short run. Preserve
  // this INFO result instead of claiming an empty advisor response.
  assert.ok(advisorItems.every(item => item.name === 'unused_index' && item.level === 'INFO'
    && item.metadata?.schema === 'auth_spike_private' && item.metadata?.name === 'registrations'));
  stage = 'saved-evidence';
  const saved = JSON.parse(await readFile(new URL('../../../docs/phase-2/F01-registration-results.json', import.meta.url), 'utf8'));
  assert.equal(saved.passed, true); assert.equal(saved.checks.length, 12); assert.ok(saved.checks.every(c => c.passed)); assert.equal(saved.cleanup.completed, true);
  const finding = JSON.parse(await readFile(new URL('../../../docs/phase-2/F01-inflight-auth-finding.json', import.meta.url), 'utf8'));
  assert.equal(finding.probeCompleted, true); assert.equal(finding.finding.reproduced, true); assert.equal(finding.cleanup, true);
  report.resultChecksPassed = 12; report.preGuardCounterexamplePreserved = true; report.passed = true;
  console.log('Verified empty synthetic data, 7 forced-RLS tables, 4 loopback containers, guarded Auth, live Data API and local advisors.');
} catch {
  report.passed = false; report.failedAt = stage; process.exitCode = 1;
  console.error(`Post-registration verification failed at ${stage}; only safe facts were saved.`);
} finally {
  if (pool) await pool.end().catch(() => {});
  await writeFile(new URL('../../../docs/phase-2/F01-registration-verification.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
}
