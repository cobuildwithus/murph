import { describe, expect, it } from "vitest";
import { readRuntimeMigrationOperator, runRuntimeMigrationOperator } from "../scripts/runtime-migration.cli.ts";
import { readHostedWebCallbackSigningEnvironment, verifyHostedWebCallbackSignatureHeaders } from "../src/web-callback-auth.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

const source = { ...createHostedExecutionTestEnv(), GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "cobuildwithus/murph-cloud",
  GITHUB_REF: "refs/heads/main", CF_PUBLIC_BASE_URL: "https://worker.example.test", CF_WORKER_NAME: "synthetic-worker",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "synthetic-token", MURPH_RUNTIME_MIGRATION_WORKER_VERSION: "synthetic-version" };

describe("protected hosted migration entrypoint", () => {
  it("refuses local, public-repository and non-main invocations", () => {
    for (const overrides of [{ GITHUB_ACTIONS: "false" }, { GITHUB_REPOSITORY: "cobuildwithus/murph" }, { GITHUB_REF: "refs/heads/synthetic" }]) {
      expect(() => readRuntimeMigrationOperator({ ...source, ...overrides })).toThrow("protected Murph Cloud main");
    }
  });

  it("defaults to read-only inventory and refuses unbounded or ambiguous options", () => {
    expect(readRuntimeMigrationOperator(source)).toMatchObject({ mode: "inventory", activate: false, maxSteps: 1000, maxObjects: 1 });
    for (const overrides of [{ MURPH_RUNTIME_MIGRATION_MAX_STEPS: "0" }, { MURPH_RUNTIME_MIGRATION_MAX_STEPS: "1001" },
      { MURPH_RUNTIME_MIGRATION_MAX_OBJECTS: "0" }, { MURPH_RUNTIME_MIGRATION_MAX_OBJECTS: "1001" },
      { MURPH_RUNTIME_MIGRATION_FINALIZE: "yes" }, { MURPH_RUNTIME_MIGRATION_FINALIZE: "true" }, { MURPH_RUNTIME_MIGRATION_MODE: "activate" }, { CF_PUBLIC_BASE_URL: "http://worker.example.test" }]) {
      expect(() => readRuntimeMigrationOperator({ ...source, ...overrides })).toThrow();
    }
  });

  it("signs the exact command with a fresh nonce on each call", async () => {
    const { input } = readRuntimeMigrationOperator(source);
    const request = { method: "POST" as const, path: "/internal/runtime-migration", payload: JSON.stringify({ operation: "status" }) };
    const first = await input.workerAuthorization(request);
    const second = await input.workerAuthorization(request);
    const environment = readHostedWebCallbackSigningEnvironment(source);
    expect(await verifyHostedWebCallbackSignatureHeaders({ environment, ...request, request: new Request(`https://worker.example.test${request.path}`, { method: "POST", headers: first }) })).toBe(true);
    expect(await verifyHostedWebCallbackSignatureHeaders({ environment, ...request, request: new Request(`https://worker.example.test${request.path}`, { method: "POST", headers: second }) })).toBe(true);
    expect(await verifyHostedWebCallbackSignatureHeaders({ environment, ...request, request: new Request(`https://worker.example.test${request.path}`, { method: "POST", headers: first }) })).toBe(false);
  });

  it("accepts an explicit member only for a one-object migration", () => {
    const target = { ...source, MURPH_RUNTIME_MIGRATION_MODE: "migrate", MURPH_RUNTIME_MIGRATION_MEMBER_ID: "synthetic-member" };
    expect(readRuntimeMigrationOperator(target)).toMatchObject({ memberId: "synthetic-member", maxObjects: 1 });
    for (const overrides of [{ MURPH_RUNTIME_MIGRATION_MAX_OBJECTS: "2" }, { MURPH_RUNTIME_MIGRATION_MODE: "inventory" },
      { MURPH_RUNTIME_MIGRATION_MEMBER_ID: "invalid\nmember" }]) {
      expect(() => readRuntimeMigrationOperator({ ...target, ...overrides })).toThrow("Targeted migration requires");
    }
  });

  it("prints aggregate inventory only and does not need a signing key for read-only discovery", async () => {
    const result = await runRuntimeMigrationOperator({ ...source, HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: undefined }, async request => {
      const url = new URL(String(request));
      expect(url.hostname).toBe("api.cloudflare.com");
      if (url.pathname.endsWith("/deployments")) return Response.json({ success: true, result: { deployments: [{ versions: [{ percentage: 100, version_id: "synthetic-version" }] }] } });
      if (url.pathname.endsWith("/namespaces")) return Response.json({ success: true, result: [{ id: "c".repeat(32), script: "synthetic-worker", class: "UserRunnerDurableObject", use_sqlite: true }], result_info: { total_pages: 1 } });
      return Response.json({ success: true, result: [{ id: "b".repeat(64), hasStoredData: false }], result_info: {} });
    });
    expect(result).toMatchObject({ phase: "inventory", objectCount: 1 });
    expect(JSON.stringify(result)).not.toContain("b".repeat(64));
    expect(JSON.stringify(result)).not.toContain("synthetic-token");
  });
});
