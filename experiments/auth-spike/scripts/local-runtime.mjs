import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export function localSettings() {
  const require = createRequire(import.meta.url);
  const binary = path.join(path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')), 'bin', 'supabase.exe');
  const docker = path.join(process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe');
  const status = spawnSync(binary, ['status', '--workdir', projectRoot, '--output', 'json', '--agent', 'no'], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, PATH: `${path.dirname(docker)};${process.env.PATH ?? ''}` },
  });
  if (status.error || status.status !== 0) throw new Error('Local stack status unavailable.');
  let settings, db;
  try { settings = JSON.parse(status.stdout); db = new URL(settings.DB_URL); }
  catch { throw new Error('Local settings could not be parsed; credentials were not printed.'); }
  if (settings.API_URL !== 'http://127.0.0.1:54321' || db.hostname !== '127.0.0.1' || db.port !== '54322' || db.pathname !== '/postgres') {
    throw new Error('Only the isolated localhost stack is permitted.');
  }
  if (!settings.ANON_KEY || !settings.SERVICE_ROLE_KEY) throw new Error('Local Auth credentials unavailable.');
  return settings;
}

export function provider(settings, requests = []) {
  return async (method, route, body, { token = settings.ANON_KEY, admin = false, server = false } = {}) => {
    const response = await fetch(`${settings.API_URL}/auth/v1${route}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { apikey: admin || server ? settings.SERVICE_ROLE_KEY : settings.ANON_KEY,
        Authorization: `Bearer ${admin ? settings.SERVICE_ROLE_KEY : token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : null;
    requests.push({ method, route: route.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, '[test-user]'),
      status: response.status, errorCode: typeof data?.error_code === 'string' && /^[a-z0-9_]{1,80}$/.test(data.error_code) ? data.error_code : null });
    return { status: response.status, ok: response.ok, data };
  };
}
