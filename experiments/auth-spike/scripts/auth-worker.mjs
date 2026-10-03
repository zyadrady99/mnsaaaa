import pg from 'pg';
import { provider } from './local-runtime.mjs';
import { createRecoveryGateway } from './recovery-gateway.mjs';

// Credentials are delivered through private IPC, never CLI args or stdout.
process.once('message', async input => {
  try {
    const pool = new pg.Pool({ connectionString: input.dbUrl, max: 6, connectionTimeoutMillis: 5000 });
    const raw = provider(input.settings);
    const auth = (method, route, body, options) => raw(method, route, body, { server: true, ...options });
    const gateway = await createRecoveryGateway({ pool, auth, runId: input.runId, limits: input.limits ? { ...input.limits, key: Buffer.from(input.limits.keyHex, 'hex') } : false,
      checkpoint: async stage => {
        if (stage === input.pauseAt) {
          process.send({ type: 'checkpoint', stage });
          await new Promise(() => {});
        }
      },
    });
    process.send({ type: 'ready', origin: gateway.origin });
  } catch {
    process.send({ type: 'failed' }); process.exitCode = 1;
  }
});
