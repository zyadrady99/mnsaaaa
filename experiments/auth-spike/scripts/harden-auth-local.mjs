import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localSettings, projectRoot } from './local-runtime.mjs';

// Local-only Kong boundary, not a claim about managed Supabase configuration.
const docker = path.join(process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe');
const container = 'supabase_kong_dorosna-auth-spike';
let stage = 'settings';
function call(args, input) {
  const result = spawnSync(docker, args, { encoding: 'utf8', input, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) {
    const diagnostic = { stage, exitCode: result.status, connectionRefused: /refused/i.test(result.stderr),
      unsupportedOption: /unrecognized|usage:/i.test(result.stderr), httpStatus: result.stderr.match(/HTTP\/\S+\s+(\d{3})/)?.[1] ?? null };
    console.error(JSON.stringify(diagnostic));
    throw new Error('Local gateway operation failed; raw output withheld.');
  }
  return result.stdout;
}
try {
  const settings = localSettings();
  stage = 'inspect';
  const inspected = JSON.parse(call(['inspect', container]))[0];
  const configPath = inspected.Config.Env.find(entry => entry.startsWith('KONG_DECLARATIVE_CONFIG='))?.split('=')[1];
  if (configPath !== '/home/kong/kong.yml') throw new Error('Unexpected local config path.');
  let config = call(['exec', container, 'cat', configPath]);
  stage = 'shape';
  if (!config.includes('username: f01_server_auth')) {
    let guardedServices = 0;
    const chunks = config.split(/\n(?=  - name: )/);
    config = chunks.map(chunk => {
      if (!/^  - name: auth-v1(?:\s|[-])/.test(chunk)) return chunk;
      if (!chunk.includes('    plugins:')) throw new Error('Unknown Auth service shape.');
      guardedServices++;
      return chunk.replace('    plugins:', `    plugins:\n      - name: key-auth\n        config:\n          key_names: [apikey]\n          key_in_query: false\n          key_in_body: false\n          key_in_header: true\n          hide_credentials: false\n      - name: acl\n        config:\n          allow: [f01_auth_server]\n          hide_groups_header: true`);
    }).join('\n');
    if (guardedServices !== 4) throw new Error('Unexpected Auth service count.');
    const consumer = `\n  - username: f01_server_auth\n    keyauth_credentials:\n      - key: ${JSON.stringify(settings.SERVICE_ROLE_KEY)}\n    acls:\n      - group: f01_auth_server\n`;
    if (/^consumers:\s*$/m.test(config)) config = config.replace(/^consumers:\s*$/m, `consumers:${consumer}`);
    else config += `\nconsumers:${consumer}`;
    await mkdir(path.join(projectRoot, '.local'), { recursive: true });
    await writeFile(path.join(projectRoot, '.local', 'kong-before-auth-guard.yml'), call(['exec', container, 'cat', configPath]));
    await writeFile(path.join(projectRoot, '.local', 'kong-auth-guard.yml'), config);
    stage = 'write'; call(['exec', '-i', '--user', 'root', container, 'sh', '-c', 'cat > /home/kong/kong.yml'], config);
    stage = 'parse';
    call(['exec', container, 'kong', 'config', 'parse', configPath]);
  }
  // DB-less entities must be loaded through /config. An nginx reload alone
  // does not prove that the new route plugins are active.
  stage = 'load';
  call(['exec', '-i', '--user', 'root', container, 'sh', '-c', 'cat > /tmp/f01-config-load.json'], JSON.stringify({ config }));
  call(['exec', container, 'wget', '-S', '-O', '-', '--header=Content-Type: application/json', '--post-file=/tmp/f01-config-load.json', 'http://127.0.0.1:8001/config']);
  call(['exec', '--user', 'root', container, 'rm', '/tmp/f01-config-load.json']);
  let verified = false;
  stage = 'http';
  for (let attempt = 0; attempt < 25; attempt++) {
    const client = await fetch(`${settings.API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: settings.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+12025550190', password: 'Invalid1!Password' }), signal: AbortSignal.timeout(5000) });
    const server = await fetch(`${settings.API_URL}/auth/v1/health`, { headers: { apikey: settings.SERVICE_ROLE_KEY }, signal: AbortSignal.timeout(5000) });
    if (client.status === 401 && server.status === 200) { verified = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!verified) throw new Error('Auth boundary unconfirmed.');
  console.log('Verified: localhost Auth requires the server key; four existing Auth services protected; server health remains available.');
} catch {
  console.error(`Local Auth guard failed at ${stage}; no config or credentials printed.`); process.exitCode = 1;
}
