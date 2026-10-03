import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { localSettings, projectRoot } from './local-runtime.mjs';

const report = { scope: 'post-recovery-local-state', checkedAt: new Date().toISOString() };
let pool;
try {
  const settings = localSettings();
  pool = new pg.Pool({ connectionString: settings.DB_URL, max: 1, connectionTimeoutMillis: 5000 });
  report.rows = (await pool.query(`select
    (select count(*)::int from auth_spike_private.accounts) as accounts,
    (select count(*)::int from auth_spike_private.sessions) as sessions,
    (select count(*)::int from auth_spike_private.recoveries) as recoveries,
    (select count(*)::int from auth_spike_private.audit) as audit,
    (select count(*)::int from auth.users where raw_user_meta_data ? 'spike_run_id') as synthetic_auth_users,
    (select count(*)::int from pg_roles where rolname like 'dorosna_auth_spike_runtime_%') as temporary_runtime_roles`)).rows[0];
  assert.ok(Object.values(report.rows).every(count => count === 0));
  const docker = path.join(process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe');
  const inspected = spawnSync(docker, ['inspect', 'supabase_db_dorosna-auth-spike', 'supabase_auth_dorosna-auth-spike', 'supabase_kong_dorosna-auth-spike'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (inspected.status !== 0) throw new Error('Local container inspection unavailable.');
  report.containers = JSON.parse(inspected.stdout).map(container => ({
    name: container.Name.substring(1), health: container.State.Health?.Status,
    publishedPorts: Object.entries(container.NetworkSettings.Ports).flatMap(([port, entries]) => (entries ?? []).map(entry => ({ port, host: entry.HostIp, hostPort: entry.HostPort }))),
  }));
  assert.ok(report.containers.every(container => container.health === 'healthy' && container.publishedPorts.every(port => port.host === '127.0.0.1')));
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')), 'bin', 'supabase.exe');
  const advisor = spawnSync(cli, ['db', 'advisors', '--local', '--type', 'all', '--level', 'info', '--fail-on', 'error', '--output', 'json', '--workdir', projectRoot, '--agent', 'no'], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, PATH: `${path.dirname(docker)};${process.env.PATH ?? ''}` },
  });
  report.advisors = { exitCode: advisor.status, noIssuesReported: /No issues found/.test(`${advisor.stdout}\n${advisor.stderr}`), jsonReturned: Boolean(advisor.stdout.trim()) };
  assert.equal(advisor.status, 0); assert.equal(report.advisors.noIssuesReported, true);
  // This CLI currently reports an empty lint result on stderr with no JSON body.
  // Save that precise fact; permissions and RLS were also tested independently.
  for (const filename of ['F01-recovery-results.json', 'F01-provider-revocation-results.json']) {
    const saved = JSON.parse(await readFile(new URL(`../../../docs/phase-2/${filename}`, import.meta.url), 'utf8'));
    assert.equal(saved.passed, true); assert.ok(saved.checks.every(check => check.passed));
  }
  report.passed = true;
  console.log('Verified empty synthetic data, removed temporary roles, healthy loopback containers and local advisor result.');
} catch {
  report.passed = false; process.exitCode = 1;
  console.error('Post-recovery verification failed; only safe facts were saved.');
} finally {
  if (pool) await pool.end().catch(() => {});
  await writeFile(new URL('../../../docs/phase-2/F01-recovery-verification.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
}
