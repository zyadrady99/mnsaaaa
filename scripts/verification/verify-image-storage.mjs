import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import ts from "typescript";
import { projectPath } from "../shared/paths.mjs";

if (!vm.SourceTextModule)
  throw new Error("Run this verification with --experimental-vm-modules.");

// No env files, real DB, Supabase project, or existing images are accessed.
// The compiled production helper uses fake credentials and a loopback transport.
const fixtureRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "dorosna-image-test-"),
);
const cloudOrigin = "https://fakeproject.supabase.co";
const secret = "sb_secret_FAKE_IMAGE_TEST_KEY_NEVER_A_REAL_CREDENTIAL";
const legacy = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake";
const bucket = "dorosna-images";
const results = [];
async function test(name, run) {
  await run();
  results.push({ name, passed: true });
}

const requests = [];
const objects = new Map();
const behaviors = new Map();
const api = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const id = request.url.split("/").at(-1);
  const behavior = behaviors.get(id);
  requests.push({
    path: request.url,
    method: request.method,
    headers: request.headers,
    bytes,
  });
  if (behavior === "redirect") {
    response.writeHead(302, { Location: "/trap" });
    response.end();
  } else if (
    behavior === "failure" ||
    (behavior === "delete-failure" && request.method === "DELETE")
  ) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: secret }));
  } else if (request.method === "POST") {
    if (objects.has(id)) {
      response.writeHead(409);
      response.end("already exists");
    } else {
      objects.set(id, bytes);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ Key: `${bucket}/${id}` }));
    }
  } else if (request.method === "GET") {
    if (!objects.has(id)) {
      response.writeHead(404);
      response.end();
    } else if (behavior === "oversize") {
      response.writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Length": String(objects.get(id).length + 1),
      });
      response.end(Buffer.concat([objects.get(id), Buffer.from([1])]));
    } else if (behavior === "oversize-chunked") {
      response.writeHead(200, { "Content-Type": "image/webp" });
      response.write(objects.get(id));
      response.end(Buffer.from([1]));
    } else {
      response.writeHead(200, {
        "Content-Type":
          behavior === "invalid-type" ? "text/html" : "image/webp",
      });
      response.end(objects.get(id));
    }
  } else if (request.method === "DELETE") {
    const exists = objects.delete(id);
    response.writeHead(exists ? 200 : 404);
    response.end();
  } else {
    response.writeHead(404);
    response.end();
  }
});
api.listen(0, "127.0.0.1");
await once(api, "listening");
const mockOrigin = `http://127.0.0.1:${api.address().port}`;

async function storage(env = {}, options = {}) {
  const fakeEnv = {
    SUPABASE_URL: cloudOrigin,
    SUPABASE_SERVER_KEY: secret,
    SUPABASE_IMAGE_BUCKET: bucket,
    ...env,
  };
  const transport = async (url, init) => {
    assert.equal(new URL(url).origin, cloudOrigin);
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    return fetch(url.replace(cloudOrigin, mockOrigin), init);
  };
  const context = vm.createContext({
    process: { env: fakeEnv, cwd: () => fixtureRoot },
    Buffer,
    URL,
    Uint8Array,
    fetch: options.fetch ?? transport,
    AbortSignal: options.AbortSignal ?? AbortSignal,
  });
  const modules = new Map();
  function compiled(file) {
    if (modules.has(file)) return modules.get(file);
    const { outputText } = ts.transpileModule(
      readFileSync(projectPath(file), "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      },
    );
    const entry = new vm.SourceTextModule(outputText, { context });
    modules.set(file, entry);
    return entry;
  }
  const entry = compiled("src/server/media/image-storage.ts");
  await entry.link((specifier) => {
    if (specifier === "server-only")
      return new vm.SyntheticModule([], () => {}, { context });
    if (specifier === "@/lib/auth-input")
      return compiled("src/lib/auth-input.ts");
    if (specifier === "@/server/core/errors")
      return compiled("src/server/core/errors.ts");
    if (specifier === "node:path")
      return new vm.SyntheticModule(
        ["default"],
        function () {
          this.setExport("default", path);
        },
        { context },
      );
    if (specifier === "node:fs/promises")
      return new vm.SyntheticModule(
        ["mkdir", "readFile", "unlink", "writeFile"],
        function () {
          for (const name of ["mkdir", "readFile", "unlink", "writeFile"])
            this.setExport(name, fs[name]);
        },
        { context },
      );
    throw new Error("Unexpected verification module import.");
  });
  await entry.evaluate();
  return entry.namespace;
}

function sanitized(error) {
  assert.equal(error.status, 503);
  assert.equal(error.code, "image_storage_unavailable");
  assert.equal(error.message.includes(secret), false);
  assert.equal(error.message.includes(cloudOrigin), false);
  return true;
}

const image = await sharp({
  create: { width: 32, height: 18, channels: 3, background: "#0f766e" },
})
  .webp()
  .toBuffer();

try {
  await test("modern secret uploads bytes once and private reads retain the proxy contract", async () => {
    const helper = await storage();
    const id = randomUUID();
    const result = await helper.withImageWrite(id, image, async (write) => {
      await write();
      return `/media/images/${id}`;
    });
    assert.equal(result, `/media/images/${id}`);
    const upload = requests.at(-1);
    assert.equal(upload.method, "POST");
    assert.equal(upload.path, `/storage/v1/object/${bucket}/${id}.webp`);
    assert.equal(upload.headers.apikey, secret);
    assert.equal(upload.headers.authorization, undefined);
    assert.equal(upload.headers["x-upsert"], "false");
    assert.equal(upload.headers["content-type"], "image/webp");
    assert.equal(Number(upload.headers["content-length"]), image.length);
    assert.deepEqual(upload.bytes, image);
    assert.deepEqual(await helper.readImageBlob(id, image.length), image);
    assert.equal(
      requests.at(-1).path,
      `/storage/v1/object/authenticated/${bucket}/${id}.webp`,
    );
    assert.equal(requests.at(-1).headers.authorization, undefined);
    assert.equal(await helper.readImageBlob(randomUUID(), image.length), null);
  });

  await test("legacy service JWT remains supported without exposing a public storage URL", async () => {
    const helper = await storage({ SUPABASE_SERVER_KEY: legacy });
    const id = randomUUID();
    await helper.withImageWrite(id, image, async (write) => write());
    assert.equal(requests.at(-1).headers.apikey, legacy);
    assert.equal(requests.at(-1).headers.authorization, `Bearer ${legacy}`);
    await helper.readImageBlob(id, image.length);
    assert.equal(requests.at(-1).headers.authorization, `Bearer ${legacy}`);
    assert.equal(requests.at(-1).path.includes("/public/"), false);
  });

  await test("a rejected persistence callback removes only its newly uploaded image", async () => {
    const helper = await storage();
    const id = randomUUID();
    const historicalKey = `${randomUUID()}.webp`;
    objects.set(historicalKey, image);
    const original = new Error("fake-database-commit-failure");
    await assert.rejects(
      helper.withImageWrite(id, image, async (write) => {
        await write();
        throw original;
      }),
      (error) => error === original,
    );
    assert.equal(requests.at(-1).method, "DELETE");
    assert.equal(
      requests.at(-1).path,
      `/storage/v1/object/${bucket}/${id}.webp`,
    );
    assert.equal(objects.has(`${id}.webp`), false);
    assert.deepEqual(objects.get(historicalKey), image);
  });

  await test("authorization rejected before writing performs no storage mutation", async () => {
    const helper = await storage();
    const before = requests.length;
    const original = new Error("fake-revoked-admin-session");
    await assert.rejects(
      helper.withImageWrite(randomUUID(), image, async () => {
        throw original;
      }),
      (error) => error === original,
    );
    assert.equal(requests.length, before);
  });

  await test("conflicting keys are never overwritten or deleted", async () => {
    const helper = await storage();
    const id = randomUUID();
    objects.set(`${id}.webp`, image);
    const before = requests.length;
    await assert.rejects(
      helper.withImageWrite(id, image, async (write) => write()),
      sanitized,
    );
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).method, "POST");
    assert.deepEqual(objects.get(`${id}.webp`), image);
  });

  await test("cleanup failure preserves the original persistence error", async () => {
    const helper = await storage();
    const id = randomUUID();
    behaviors.set(`${id}.webp`, "delete-failure");
    const original = new Error("fake-database-commit-failure");
    await assert.rejects(
      helper.withImageWrite(id, image, async (write) => {
        await write();
        throw original;
      }),
      (error) => error === original,
    );
    assert.equal(requests.at(-1).method, "DELETE");
  });

  await test("storage errors and redirects are bounded and sanitized", async () => {
    const helper = await storage();
    for (const behavior of ["failure", "redirect"]) {
      const id = randomUUID();
      behaviors.set(`${id}.webp`, behavior);
      await assert.rejects(helper.readImageBlob(id, image.length), sanitized);
      await assert.rejects(
        helper.withImageWrite(id, image, async (write) => write()),
        sanitized,
      );
    }
    assert.equal(
      requests.some((request) => request.path === "/trap"),
      false,
    );
  });

  await test("timeout uses a fifteen-second abort signal without leaking transport errors", async () => {
    const durations = [];
    const helper = await storage(
      {},
      {
        AbortSignal: {
          timeout(ms) {
            durations.push(ms);
            return AbortSignal.abort(new Error("fake-secret-transport-error"));
          },
        },
        fetch: async (_url, init) => {
          init.signal.throwIfAborted();
        },
      },
    );
    await assert.rejects(
      helper.readImageBlob(randomUUID(), image.length),
      sanitized,
    );
    assert.deepEqual(durations, [15_000]);
  });

  await test("reads reject oversized, corrupt or mismatched storage bodies", async () => {
    const helper = await storage();
    for (const behavior of ["oversize", "oversize-chunked", "invalid-type"]) {
      const id = randomUUID();
      objects.set(`${id}.webp`, image);
      behaviors.set(`${id}.webp`, behavior);
      await assert.rejects(helper.readImageBlob(id, image.length), sanitized);
    }
    const corrupt = randomUUID();
    objects.set(`${corrupt}.webp`, Buffer.alloc(image.length));
    await assert.rejects(
      helper.readImageBlob(corrupt, image.length),
      sanitized,
    );
    const mismatch = randomUUID();
    objects.set(`${mismatch}.webp`, image);
    await assert.rejects(
      helper.readImageBlob(mismatch, image.length + 1),
      sanitized,
    );
  });

  await test("bad configuration, UUIDs and byte limits fail without disk or HTTP fallback", async () => {
    const before = requests.length;
    for (const env of [
      { SUPABASE_IMAGE_BUCKET: undefined },
      { SUPABASE_IMAGE_BUCKET: "../other-bucket" },
      { SUPABASE_IMAGE_BUCKET: "public/images" },
      { SUPABASE_SERVER_KEY: "sb_publishable_FAKE_TEST_KEY" },
      { SUPABASE_URL: "http://fakeproject.supabase.co" },
      { SUPABASE_URL: "https://fakeproject.supabase.co/other" },
      { SUPABASE_URL: "https://other.invalid" },
    ]) {
      const helper = await storage(env);
      await assert.rejects(
        helper.withImageWrite(randomUUID(), image, async (write) => write()),
        sanitized,
      );
    }
    const helper = await storage();
    for (const id of ["../other", "file.webp", `${randomUUID()}/other`])
      await assert.rejects(
        helper.readImageBlob(id, image.length),
        (error) => error.code === "invalid_image",
      );
    for (const bytes of [0, -1, 1.5, 5 * 1024 * 1024 + 1])
      await assert.rejects(
        helper.readImageBlob(randomUUID(), bytes),
        sanitized,
      );
    await assert.rejects(
      helper.withImageWrite(
        randomUUID(),
        Buffer.alloc(4 * 1024 * 1024 + 1),
        async (write) => write(),
      ),
      sanitized,
    );
    assert.equal(requests.length, before);
    assert.equal((await fs.readdir(fixtureRoot)).length, 0);
  });

  await test("local disk is explicit and rollback preserves older images", async () => {
    const helper = await storage({ DOROSNA_LOCAL_ONLY: "1" });
    const before = requests.length;
    const kept = randomUUID();
    await helper.withImageWrite(kept, image, async (write) => write());
    assert.deepEqual(
      await helper.readImageBlob(kept.toUpperCase(), image.length),
      image,
    );
    assert.equal(await helper.readImageBlob(randomUUID(), image.length), null);
    const aborted = randomUUID();
    await assert.rejects(
      helper.withImageWrite(aborted, image, async (write) => {
        await write();
        throw new Error("fake-local-commit-failure");
      }),
    );
    assert.equal(await helper.readImageBlob(aborted, image.length), null);
    assert.deepEqual(await helper.readImageBlob(kept, image.length), image);
    await assert.rejects(
      helper.withImageWrite(kept, image, async (write) => write()),
      sanitized,
    );
    assert.deepEqual(await helper.readImageBlob(kept, image.length), image);
    assert.equal(requests.length, before);
  });

  console.log(JSON.stringify({ passed: results.length, results }, null, 2));
} finally {
  api.closeAllConnections();
  await new Promise((resolve) => api.close(resolve));
  // Only this newly-created, verified temporary fixture directory is removed.
  const resolved = path.resolve(fixtureRoot);
  const parent = path.resolve(os.tmpdir());
  if (
    path.dirname(resolved) !== parent ||
    !path.basename(resolved).startsWith("dorosna-image-test-")
  )
    throw new Error("Unexpected verification cleanup target.");
  await fs.rm(resolved, { recursive: true, force: true });
}
