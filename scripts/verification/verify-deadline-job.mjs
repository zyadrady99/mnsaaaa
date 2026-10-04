import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { projectPath } from "../shared/paths.mjs";

if (!vm.SourceTextModule)
  throw new Error("Run this verification with --experimental-vm-modules.");

// Exercise the actual job/route with a bounded runner contract. No real DB,
// env files, secrets, network, or clock scheduling are involved.
const secret = "a1".repeat(32);
const results = [];
async function test(name, run) {
  await run();
  results.push({ name, passed: true });
}

async function job(env = { APP_JOB_SECRET: secret }, runner = async () => 1) {
  const calls = [];
  let comparisons = 0;
  const context = vm.createContext({ process: { env }, Buffer, Response });
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
  const entry = compiled("src/app/api/internal/deadlines/route.ts");
  await entry.link((specifier) => {
    if (specifier === "server-only")
      return new vm.SyntheticModule([], () => {}, { context });
    if (specifier === "@/server/jobs/deadlines")
      return compiled("src/server/jobs/deadlines.ts");
    if (specifier === "node:crypto")
      return new vm.SyntheticModule(
        ["timingSafeEqual"],
        function () {
          this.setExport("timingSafeEqual", (left, right) => {
            comparisons++;
            return timingSafeEqual(left, right);
          });
        },
        { context },
      );
    if (specifier === "@/server/assessments/service")
      return new vm.SyntheticModule(
        ["runDueAttempts"],
        function () {
          this.setExport("runDueAttempts", async (...args) => {
            calls.push(args);
            return runner(...args);
          });
        },
        { context },
      );
    throw new Error("Unexpected deadline verification import.");
  });
  await entry.evaluate();
  return {
    route: entry.namespace,
    calls,
    comparisonCount: () => comparisons,
  };
}

function request({
  method = "POST",
  authorization = `Bearer ${secret}`,
  headers = {},
  body,
  url,
} = {}) {
  return new Request(url ?? "https://fake.netlify.app/api/internal/deadlines", {
    method,
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  });
}

async function payload(response, status, expected) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.equal(response.headers.get("content-type"), "application/json");
  const text = await response.text();
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("fake-private-error"), false);
  assert.deepEqual(JSON.parse(text), expected);
}

await test("route is Node POST only with a declarative duration hint", async () => {
  const handler = await job();
  assert.equal(handler.route.runtime, "nodejs");
  assert.equal(handler.route.maxDuration, 30);
  assert.equal(typeof handler.route.POST, "function");
  assert.equal(handler.route.GET, undefined);
  for (const method of ["GET", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const response = await handler.route.POST(request({ method }));
    assert.equal(response.headers.get("allow"), "POST");
    await payload(response, 405, { error: "method_not_allowed" });
  }
  assert.equal(handler.calls.length, 0);
});

await test("missing or malformed job secret fails closed before running", async () => {
  for (const expected of [
    undefined,
    "",
    "a1".repeat(31),
    "a1".repeat(33),
    "z".repeat(64),
    ` ${secret}`,
  ]) {
    const handler = await job({ APP_JOB_SECRET: expected });
    await payload(await handler.route.POST(request()), 503, {
      error: "deadline_job_unavailable",
    });
    assert.equal(handler.calls.length, 0);
    assert.equal(handler.comparisonCount(), 0);
  }
});

await test("wrong, absent and malformed bearer tokens cannot invoke the grader", async () => {
  const handler = await job();
  for (const authorization of [
    "",
    "Bearer bad-token",
    `Basic ${secret}`,
    `Bearer ${"b2".repeat(32)}`,
    `Bearer ${"b2".repeat(31)}`,
    `Bearer ${"b2".repeat(33)}`,
    `Bearer ${secret}, Bearer ${secret}`,
    `Bearer ${secret} trailing`,
  ])
    await payload(await handler.route.POST(request({ authorization })), 403, {
      error: "job_access_denied",
    });
  assert.equal(handler.calls.length, 0);
  assert.equal(handler.comparisonCount(), 1);
});

await test("valid bearer invokes exactly one fixed batch with the job statement bound", async () => {
  const handler = await job();
  await payload(await handler.route.POST(request()), 200, { finalized: 1 });
  assert.deepEqual(handler.calls, [[1, 10_000]]);
  assert.equal(handler.comparisonCount(), 1);
});

await test("no due attempt returns only an aggregate count", async () => {
  const handler = await job(undefined, async () => 0);
  await payload(await handler.route.POST(request()), 200, { finalized: 0 });
  assert.deepEqual(handler.calls, [[1, 10_000]]);
});

await test("cookies and Origin provide no privilege and are not required", async () => {
  const handler = await job();
  await payload(
    await handler.route.POST(
      request({
        authorization: "",
        headers: {
          Cookie: "fake-admin-session",
          Origin: "https://fake.netlify.app",
        },
      }),
    ),
    403,
    { error: "job_access_denied" },
  );
  await payload(
    await handler.route.POST(
      request({
        authorization: `bearer ${secret}`,
        headers: {
          Cookie: "fake-invalid-cookie",
          Origin: "https://other.invalid",
        },
      }),
    ),
    200,
    { finalized: 1 },
  );
  assert.deepEqual(handler.calls, [[1, 10_000]]);
});

await test("request body and query parameters cannot expand or redirect the batch", async () => {
  const handler = await job();
  const incoming = request({
    url: "https://fake.netlify.app/api/internal/deadlines?limit=100000&attemptId=fake-private-id",
    body: "this is not valid JSON; do not parse it",
  });
  incoming.json = async () => {
    throw new Error("Request body must not be read.");
  };
  incoming.text = async () => {
    throw new Error("Request body must not be read.");
  };
  await payload(await handler.route.POST(incoming), 200, { finalized: 1 });
  assert.equal(incoming.bodyUsed, false);
  assert.deepEqual(handler.calls, [[1, 10_000]]);
});

await test("runner failure returns a fixed private error with no details", async () => {
  const handler = await job(undefined, async () => {
    const error = new Error(`fake-private-error ${secret}`);
    error.code = "fake-private-database-error";
    throw error;
  });
  await payload(await handler.route.POST(request()), 503, {
    error: "deadline_job_unavailable",
  });
  assert.deepEqual(handler.calls, [[1, 10_000]]);
});

await test("unexpected runner payloads never expose IDs or expand the reported batch", async () => {
  for (const result of [
    { finalized: 1, attemptId: "fake-private-id" },
    -1,
    2,
    0.5,
    NaN,
    "1",
  ]) {
    const handler = await job(undefined, async () => result);
    await payload(await handler.route.POST(request()), 503, {
      error: "deadline_job_unavailable",
    });
    assert.deepEqual(handler.calls, [[1, 10_000]]);
  }
});

console.log(JSON.stringify({ passed: results.length, results }, null, 2));
