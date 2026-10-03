import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Scoped launcher adapter for the four containers in this local experiment.
// It does not modify the installed CLI, Docker settings, or any other project.
const args = process.argv.slice(2);
const originalDocker = path.join(
  process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe',
);
const containerNames = new Set([
  'supabase_db_dorosna-auth-spike',
  'supabase_auth_dorosna-auth-spike',
  'supabase_kong_dorosna-auth-spike',
  'supabase_rest_dorosna-auth-spike',
]);
const nameIndex = args.indexOf('--name');
const containerName = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
const env = { ...process.env };

if (args[0] === 'create' && containerNames.has(containerName)) {
  const ports = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '-p' || args[index] === '--publish') {
      const mapping = args[index + 1];
      if (!/^\d+:\d+(?:\/(?:tcp|udp))?$/.test(mapping)) {
        console.error('Unexpected experiment port mapping; container creation refused.');
        process.exit(1);
      }
      args[index + 1] = `127.0.0.1:${mapping}`;
      ports.push(args[index + 1]);
      index++;
    }
  }
  const auth = containerName === 'supabase_auth_dorosna-auth-spike';
  if (containerName === 'supabase_kong_dorosna-auth-spike') {
    env.KONG_PLUGINS = [...new Set([...(env.KONG_PLUGINS ?? 'cors,request-transformer').split(','), 'key-auth', 'acl'])].join(',');
  }
  if (containerName === 'supabase_rest_dorosna-auth-spike' && env.DOROSNA_DATA_API_PROBE === '1') {
    // Deliberately include the private schema for a negative HTTP permission probe.
    // Client roles still have no USAGE or table grants. This is not an API design.
    env.PGRST_DB_SCHEMAS = 'public,graphql_public,auth_spike_private';
  }
  if (auth) {
    if (env.GOTRUE_SMS_PROVIDER) {
      console.error('An SMS provider was configured unexpectedly; Auth creation refused.');
      process.exit(1);
    }
    // CLI 2.119.0 disables the phone provider without an SMS provider. GoTrue's
    // phone/password setting is independent of delivery: enable it explicitly,
    // keep SMS providers absent, and verify the running API in the experiment.
    env.GOTRUE_EXTERNAL_PHONE_ENABLED = 'true';
  }
  appendFileSync(fileURLToPath(new URL('../.local/launcher-events.ndjson', import.meta.url)),
    `${JSON.stringify({ container: containerName, ports, phoneEnabled: auth, smsProviderConfigured: false })}\n`,
    'utf8');
}

const child = spawn(originalDocker, args, {
  env, stdio: 'inherit', windowsHide: true, shell: false,
});
child.on('error', () => {
  console.error('The local Docker launcher could not start Docker.');
  process.exitCode = 1;
});
child.on('exit', code => { process.exitCode = code ?? 1; });
