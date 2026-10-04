import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { rootCertificates } from "node:tls";
import vm from "node:vm";
import pg from "pg";
import ts from "typescript";
import { projectPath } from "../shared/paths.mjs";

// Compile only the exercised server modules. Never load .env files or connect
// to Supabase: all HTTP and PostgreSQL protocol traffic stays on loopback.
if (!vm.SourceTextModule)
  throw new Error("Run this verification with --experimental-vm-modules.");

const results = [];
async function test(name, run) {
  await run();
  results.push({ name, passed: true });
}

async function serverModule(relativePath, env, send = fetch) {
  const context = vm.createContext({
    process: { env },
    URL,
    fetch: send,
    AbortSignal,
  });
  const modules = new Map();
  function compiled(file) {
    if (modules.has(file)) return modules.get(file);
    const source = readFileSync(projectPath(file), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    });
    const compiledModule = new vm.SourceTextModule(outputText, {
      context,
      identifier: file,
    });
    modules.set(file, compiledModule);
    return compiledModule;
  }
  const entry = compiled(relativePath);
  await entry.link((specifier) => {
    if (specifier === "server-only")
      return new vm.SyntheticModule([], () => {}, { context });
    if (specifier === "node:crypto")
      return new vm.SyntheticModule(
        ["X509Certificate"],
        function () {
          this.setExport("X509Certificate", X509Certificate);
        },
        { context },
      );
    if (specifier === "@/server/core/errors")
      return compiled("src/server/core/errors.ts");
    throw new Error("Unexpected verification module import.");
  });
  await entry.evaluate();
  return entry.namespace;
}

const requests = [];
const api = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  requests.push({
    path: request.url,
    method: request.method,
    headers: request.headers,
    body: Buffer.concat(chunks).toString("utf8"),
  });
  if (request.url === "/auth/v1/redirect") {
    response.writeHead(302, { Location: "/trap" });
    response.end();
  } else if (request.url === "/auth/v1/invalid-json") {
    response.end("fake-secret-in-an-invalid-provider-response");
  } else {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "fake-provider-user" }));
  }
});
api.listen(0, "127.0.0.1");
await once(api, "listening");
const mockOrigin = `http://127.0.0.1:${api.address().port}`;
const secret = "sb_secret_FAKE_TEST_KEY_NEVER_A_REAL_CREDENTIAL";
const legacy = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake";
const userToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLXVzZXIifQ.fake";

async function providerFor(key, accessEnv = {}, send) {
  const { provider } = await serverModule(
    "src/server/auth/provider.ts",
    {
      SUPABASE_URL: mockOrigin,
      SUPABASE_SERVER_KEY: key,
      ...accessEnv,
    },
    send,
  );
  return provider;
}

try {
  await test("secret API key reaches HTTP without a bearer token", async () => {
    const provider = await providerFor(secret);
    const body = { phone: "+201000000001", password: "fake-test-password" };
    const result = await provider("POST", "/admin/users", body);
    assert.equal(result.ok, true);
    assert.equal(result.data.id, "fake-provider-user");
    const request = requests.at(-1);
    assert.equal(request.path, "/auth/v1/admin/users");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.apikey, secret);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(request.body), body);
  });

  await test("user JWT takes bearer precedence with either server key", async () => {
    for (const key of [secret, legacy]) {
      const provider = await providerFor(key);
      await provider("GET", "/user", undefined, userToken);
      const request = requests.at(-1);
      assert.equal(request.headers.apikey, key);
      assert.equal(request.headers.authorization, `Bearer ${userToken}`);
    }
  });

  await test("local legacy JWT keeps both headers and the exact local guard", async () => {
    const provider = await providerFor(
      legacy,
      { SUPABASE_URL: "http://127.0.0.1:54321", DOROSNA_LOCAL_ONLY: "1" },
      (url, options) =>
        fetch(url.replace("http://127.0.0.1:54321", mockOrigin), options),
    );
    await provider("POST", "/token?grant_type=password", {
      phone: "+201000000001",
      password: "fake-test-password",
    });
    assert.equal(requests.at(-1).headers.apikey, legacy);
    assert.equal(requests.at(-1).headers.authorization, `Bearer ${legacy}`);

    const refused = await providerFor(legacy, { DOROSNA_LOCAL_ONLY: "1" });
    const before = requests.length;
    await assert.rejects(refused("GET", "/user"), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "auth_unavailable");
      return true;
    });
    assert.equal(requests.length, before);
  });

  await test("non-JWT API keys are never sent as bearer JWTs", async () => {
    for (const key of ["sb_publishable_FAKE_TEST_KEY", "fake-opaque-key"]) {
      const provider = await providerFor(key);
      await provider("GET", "/user");
      assert.equal(requests.at(-1).headers.apikey, key);
      assert.equal(requests.at(-1).headers.authorization, undefined);
    }
  });

  await test("redirects are refused and provider parse failures are sanitized", async () => {
    const provider = await providerFor(secret);
    for (const path of ["/redirect", "/invalid-json"]) {
      await assert.rejects(provider("GET", path), (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, "auth_unavailable");
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.message.includes("fake-secret-in"), false);
        return true;
      });
    }
    assert.equal(
      requests.some((request) => request.path === "/trap"),
      false,
    );
  });

  const { databasePoolConfig } = await serverModule(
    "src/server/core/database-config.ts",
    {},
  );
  const localEnv = {
    DATABASE_URL: "postgresql://dorosna_server:fake@127.0.0.1:54322/postgres",
    DOROSNA_LOCAL_ONLY: "1",
  };
  const remoteEnv = {
    DATABASE_URL:
      "postgresql://dorosna_server.fakeproject:fake@fake.pooler.supabase.com:6543/postgres",
  };

  await test("local pool keeps ten connections, no TLS and exact loopback", () => {
    const config = databasePoolConfig({
      ...localEnv,
      DATABASE_POOL_MAX: "2",
      DATABASE_SSL_CA: "ignored-in-local-mode",
    });
    assert.equal(config.max, 10);
    assert.equal(config.ssl, false);
    const client = new pg.Client(config);
    assert.equal(client.connectionParameters.host, "127.0.0.1");
    assert.equal(client.connectionParameters.port, 54322);
    assert.equal(client.connectionParameters.user, "dorosna_server");
    for (const target of [
      "postgresql://dorosna_server:fake@localhost:54322/postgres",
      "postgresql://postgres:fake@127.0.0.1:54322/postgres",
      remoteEnv.DATABASE_URL,
    ])
      assert.throws(() =>
        databasePoolConfig({ ...localEnv, DATABASE_URL: target }),
      );
  });

  await test("remote pg client retains required certificate verification", () => {
    const config = databasePoolConfig(remoteEnv);
    assert.equal(config.max, 1);
    const client = new pg.Client(config);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(
      client.connectionParameters.ssl.checkServerIdentity,
      undefined,
    );
    assert.equal(client.connectionParameters.port, 6543);
    assert.equal(
      client.connectionParameters.user,
      "dorosna_server.fakeproject",
    );
    const configured = databasePoolConfig({
      ...remoteEnv,
      DATABASE_POOL_MAX: "10",
    });
    assert.equal(configured.max, 10);
  });

  await test("CA normalization survives pg parsing and rejects invalid PEM", () => {
    const ca = rootCertificates[0].trim();
    const config = databasePoolConfig({
      ...remoteEnv,
      DATABASE_SSL_CA: ca.replaceAll("\n", "\\n"),
    });
    const client = new pg.Client(config);
    assert.equal(client.connectionParameters.ssl.ca, ca);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    assert.throws(
      () =>
        databasePoolConfig({
          ...remoteEnv,
          DATABASE_SSL_CA: "not-a-certificate",
        }),
      /DATABASE_SSL_CA must contain a valid PEM certificate/,
    );
  });

  await test("invalid pool sizes and URL overrides fail before connecting", () => {
    for (const max of ["", "0", "11", "-1", "2.5", "3e0", " 2 "])
      assert.throws(
        () => databasePoolConfig({ ...remoteEnv, DATABASE_POOL_MAX: max }),
        /DATABASE_POOL_MAX must be an integer from 1 to 10/,
      );
    for (const query of [
      "ssl=0",
      "sslmode=disable",
      "sslmode=no-verify",
      "sslrootcert=fake",
      "sslcert=fake",
      "sslkey=fake",
      "sslnegotiation=direct",
      "uselibpqcompat=true",
      "%73slmode=require",
      "host=other.invalid",
      "port=5432",
      "user=postgres",
      "password=another-fake-password",
    ])
      assert.throws(() =>
        databasePoolConfig({
          ...remoteEnv,
          DATABASE_URL: `${remoteEnv.DATABASE_URL}?${query}`,
        }),
      );
    for (const target of [
      "not-a-url-with-fake-password",
      "https://fake:secret@fake.invalid/postgres",
      "postgres://fake:%XX@fake.invalid/postgres",
      "postgres://fake:secret@fake.invalid/postgres#fragment",
    ])
      assert.throws(
        () => databasePoolConfig({ DATABASE_URL: target }),
        (error) => {
          assert.equal(error.message.includes("secret"), false);
          assert.equal(error.message.includes(target), false);
          return true;
        },
      );
  });

  await test("remote pg refuses a server that offers no TLS", async () => {
    const packets = [];
    const wire = net.createServer((socket) => {
      socket.once("data", (packet) => {
        packets.push(packet);
        socket.end("N");
      });
    });
    wire.listen(0, "127.0.0.1");
    await once(wire, "listening");
    const client = new pg.Client(
      databasePoolConfig({
        DATABASE_URL: `postgresql://dorosna_server:fake@127.0.0.1:${wire.address().port}/postgres`,
      }),
    );
    try {
      await assert.rejects(
        client.connect(),
        /does not support SSL connections/,
      );
      assert.equal(packets.length, 1);
      assert.equal(packets[0].toString("hex"), "0000000804d2162f");
    } finally {
      await client.end();
      await new Promise((resolve) => wire.close(resolve));
    }
  });

  console.log(JSON.stringify({ passed: results.length, results }, null, 2));
} finally {
  api.closeAllConnections();
  await new Promise((resolve) => api.close(resolve));
}
