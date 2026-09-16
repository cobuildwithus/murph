import { migrateHostedLegacyRuntime, type RuntimeMigrationOperator } from "../scripts/runtime-migration.ts";
import { runtimeMigrationRoutes } from "../src/worker/route-handlers/runtime-migration.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appendHostedExecutionWakeForTest, createHostedRuntimeMigrationRehearsalForTest } from "#hosted-web-testing";
import { buildHostedExecutionDeviceSyncWake } from "@murphai/hosted-execution";
import { HOSTED_RUNTIME_NAMESPACE_PROBE_NAME, type HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";
import type { HostedRuntimeOwnerCommand } from "@murphai/hosted-execution/runtime-owner";
import { handleUserDataDeleteRoute } from "../src/worker/route-handlers/user-data-delete.ts";
import { UserRunnerDurableObject } from "../src/worker/user-runner-durable-object.ts";
import { advanceRuntimeMemberMigration } from "../src/worker/route-handlers/runtime-member-migration.ts";
import { progressRuntimeMigrationForMember } from "../src/runtime-migration-progress.ts";
import { readRuntimeMigrationCompatibility } from "../src/runtime-migration-compatibility.ts";
import { ensureRunnerStateSchema } from "../src/user-runner/runner-state-schema.ts";
import type { DurableObjectStateLike } from "../src/user-runner/types.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

const transport = vi.hoisted(() => ({ command: vi.fn(), owner: vi.fn() }));
vi.mock("../src/runtime-migration-client.ts", () => ({ commandHostedRuntimeMigration: transport.command }));
vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: transport.owner }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const ids = ["selected", "unrelated", "new", "deleted"].map(role => `synthetic_composed_${role}_${randomUUID()}`);
const objects = ["a", "b", "c", "d"].map(c => c.repeat(64));
const campaign = { namespaceId: "e".repeat(32), workerVersion: "synthetic_release_1" };
let web: Awaited<ReturnType<typeof createHostedRuntimeMigrationRehearsalForTest>>;
const sources = new Map<string, UserRunnerDurableObject>();
const unused = async (): Promise<never> => { throw new Error("Unexpected external runtime effect in the protocol rehearsal."); };
const supports = vi.fn(async () => true);
const checkpoint = vi.fn(async () => "accepted" as const);
const getContainer = vi.fn(() => ({ supportsMigrationCheckpoint: supports, requestMigrationCheckpoint: checkpoint,
  destroyInstance: unused, invoke: unused, smokeHealth: unused }));
function objectIdForName(name: string) {
  if (name === HOSTED_RUNTIME_NAMESPACE_PROBE_NAME) return "9".repeat(64);
  const id = objects[ids.indexOf(name)]; if (!id) throw new Error("Unowned rehearsal identity."); return id;
}
function requireSource(id: string) { const source = sources.get(id); if (!source) throw new Error("Missing rehearsal source."); return source; }
const source: WorkerEnvironmentSource = { ...createHostedExecutionTestEnv(), HOSTED_RUNTIME_POSTGRES_ENABLED: "true",
  CF_VERSION_METADATA: { id: campaign.workerVersion }, BUNDLES: { put: unused, get: unused },
  RUNNER_CONTAINER: { getByName: getContainer }, RUNNER_CONTAINER_SMOKE: { getByName: getContainer },
  USER_RUNNER: { idFromName: name => ({ toString: () => objectIdForName(name) }),
    idFromString: id => ({ toString: () => id }), get: id => requireSource(String(id)),
    getByName: name => requireSource(objectIdForName(name)) } };
const command = (input: HostedRuntimeMigrationCommand) => web.command(input.operation === "status" ? input
  : { ...input, compatibility: readRuntimeMigrationCompatibility(source) });

function legacySource(index: number, busy: boolean) {
  const sql = createTestSqlStorage(); ensureRunnerStateSchema(sql);
  sql.exec("INSERT INTO runner_meta (singleton, user_id, active_generation, active_attempt_id, active_runner_container_name, active_workspace_version) VALUES (1, ?, 7, ?, ?, '3')",
    ids[index]!, busy ? "synthetic_attempt" : null, busy ? "synthetic_target" : null);
  const values = new Map<string, unknown>();
  const state: DurableObjectStateLike = { id: { toString: () => objects[index]! }, storage: { sql,
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async (key, value) => { values.set(key, value); }, delete: async key => values.delete(key),
    getAlarm: async () => null, deleteAlarm: vi.fn(async () => {}), setAlarm: vi.fn(async () => {}),
    list: async <T>(options: { prefix?: string; startAfter?: string; limit?: number } = {}) => new Map(
      [...values].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(options.prefix ?? "") && key > (options.startAfter ?? ""))
        .slice(0, options.limit).map(([key, value]) => [key, value as T])),
  }, waitUntil: vi.fn() };
  const stop = vi.fn(async () => { sql.exec("UPDATE runner_meta SET active_attempt_id = NULL, active_runner_container_name = NULL"); });
  const runner = { stopLegacyRuntimeForMigration: stop, legacyRuntimeUploadsDrained: async () => true };
  const reload = () => { const object = new UserRunnerDurableObject(state, source, runner as never); sources.set(objects[index]!, object); return object; };
  return { sql, values, state, stop, reload, object: reload() };
}
function configureLocalCrypto() {
  const authority = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const automation = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const cryptoEnv = {
    HOSTED_CRYPTO_ENV: "test", HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: JSON.stringify(authority.privateKey.export({ format: "jwk" })),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/1",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: String(authority.publicKey.export({ format: "pem", type: "spki" })),
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME: "projects/example/locations/global/keyRings/hosted/cryptoKeys/rehearsal",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK: JSON.stringify(automation.publicKey.export({ format: "jwk" })),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "synthetic-automation",
    HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: "", HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON: "",
    HOSTED_CRYPTO_RECOVERY_KEY_ID: "", HOSTED_CRYPTO_RECOVERY_PUBLIC_JWK: "",
    HOSTED_CRYPTO_TEE_RUNTIME_KEY_ID: "", HOSTED_CRYPTO_TEE_RUNTIME_PUBLIC_JWK: "", HOSTED_CRYPTO_TEE_RUNTIME_POLICY_ID: "",
  };
  for (const [key, value] of Object.entries(cryptoEnv)) vi.stubEnv(key, value);
}

describe.skipIf(!enabled)("composed SQLite source to Postgres member handoff", () => {
  beforeAll(async () => {
    configureLocalCrypto();
    web = await createHostedRuntimeMigrationRehearsalForTest({ databaseUrl: process.env.DATABASE_URL ?? "", userIds: ids, objectIds: objects });
    await web.seed(ids[0]!); await web.seed(ids[1]!);
    transport.owner.mockImplementation(({ userId, command }: { userId: string; command: HostedRuntimeOwnerCommand }) => web.ownerCommand(userId, command));
    transport.command.mockImplementation(({ command: input }: { command: HostedRuntimeMigrationCommand }) => command(input));
  });
  afterAll(async () => { await web?.close(); vi.unstubAllEnvs(); });

  it("retains one selection across a busy checkpoint, lost import reply and release reload while another member stays live", async () => {
    const legacy = legacySource(0, true);
    const identity = { ...campaign, objectId: objects[0]!, userId: ids[0]!, migrationId: "synthetic_composed_handoff" };
    await command({ operation: "begin_rolling", ...campaign });
    await command({ operation: "enroll_sources", ...campaign, bindings: ids.slice(0, 2).map((userId, i) => ({ userId, objectId: objects[i]! })) });
    await command({ operation: "discover", ...campaign, objectIds: objects.slice(0, 2), complete: true });
    await command({ operation: "close_legacy_creation", ...campaign });
    await command({ operation: "inventory", ...campaign, objectIds: objects.slice(0, 2), after: "", complete: true });
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: objects[0] });
    const advance = (workerVersion = campaign.workerVersion) => advanceRuntimeMemberMigration({ source, stub: requireSource(objects[0]!), identity: { ...identity, workerVersion } });
    supports.mockResolvedValueOnce(false);
    expect(await advance()).toEqual({ pending: "readiness" });
    expect(legacy.values.has("runtime-migration-freeze:v1")).toBe(false);
    expect(await web.callback(ids[1]!)).toBe("legacy");
    expect(await advance()).toMatchObject({ pending: "checkpoint", checkpointStatus: "accepted" });
    expect(checkpoint).toHaveBeenCalledExactlyOnceWith({ userId: ids[0], attemptId: "synthetic_attempt", generation: "7" });
    expect(legacy.stop).not.toHaveBeenCalled();
    expect(await web.backend(ids[0]!)).toBe("legacy");
    expect(await web.callback(ids[1]!)).toBe("legacy");
    const wake = buildHostedExecutionDeviceSyncWake({ eventId: `synthetic_accepted_${ids[0]}`, occurredAt: new Date().toISOString(), reason: "webhook_hint", userId: ids[0]! });
    await appendHostedExecutionWakeForTest({ wake });
    const acceptedBefore = await web.prisma.hostedMailboxItem.findUniqueOrThrow({ where: { userId_dedupeKey: { userId: ids[0]!, dedupeKey: wake.eventId } } });
    // The external checkpoint owner is simulated. The actual source and Web
    // freeze/export/import/activation implementations below run unchanged.
    legacy.sql.exec("UPDATE runner_meta SET active_attempt_id = NULL");
    let loseImport = true;
    transport.command.mockImplementation(async ({ command: input }: { command: HostedRuntimeMigrationCommand }) => {
      const result = await command(input);
      if (input.operation === "import_member" && loseImport) { loseImport = false; throw new Error("synthetic lost committed import reply"); }
      return result;
    });
    await expect(advance()).rejects.toThrow("lost committed import reply");
    expect(await web.backend(ids[0]!)).toBe("draining");
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: objects[0] });
    expect(await web.callback(ids[1]!)).toBe("legacy");
    source.CF_VERSION_METADATA = { id: "synthetic_release_2" }; legacy.reload();
    for (let page = 0; page < 4; page++) {
      await advance("synthetic_release_2");
      expect(await web.callback(ids[1]!)).toBe("legacy");
    }
    expect(await web.backend(ids[0]!)).toBe("postgres");
    expect(await web.prisma.hostedRuntimeOwner.findUnique({ where: { userId: ids[0]! } })).toMatchObject({ generation: 7n, migrationId: identity.migrationId });
    const acceptedAfter = await web.prisma.hostedMailboxItem.findUniqueOrThrow({ where: { id: acceptedBefore.id } });
    expect(acceptedAfter).toEqual(acceptedBefore);
    expect(acceptedAfter.payloadInlineCiphertext).not.toBeNull();
    expect(await appendHostedExecutionWakeForTest({ wake })).toMatchObject({ duplicate: true, inserted: false });
    await advance("synthetic_release_2");
    expect(await web.prisma.hostedMailboxItem.count({ where: { userId: ids[0]! } })).toBe(2);
    await expect(requireSource(objects[0]!).bindUser(ids[0]!)).rejects.toThrow("frozen");
    const sealed = await web.prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
    expect(sealed.workerVersion).toBe(campaign.workerVersion);
    // A new member can progress automatically after the canary. The remaining
    // ordinary baseline member is never selected by these first-use retries.
    await web.seed(ids[2]!);
    const empty = legacySource(2, false); empty.sql.exec("DELETE FROM runner_meta");
    for (let page = 0; page < 5; page++) {
      await progressRuntimeMigrationForMember({ source, userId: ids[2]!, budget: { deadlineAtMs: Date.now() + 10_000 } });
      expect(await web.backend(ids[1]!)).toBe("legacy");
    }
    expect(await web.backend(ids[2]!)).toBe("postgres");
    expect(await web.prisma.hostedMailboxItem.count({ where: { userId: ids[2]! } })).toBe(1);
    expect(await web.prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).toMatchObject({ inventoryHash: sealed.inventoryHash, inventoryCount: sealed.inventoryCount });
    // Deletion removes the processing wake owner, so its existing cleanup HTTP
    // retries must finish pending first use without an operator or new scheduler.
    await web.seed(ids[3]!); await web.prisma.hostedMember.delete({ where: { id: ids[3]! } });
    const deleted = legacySource(3, false); deleted.sql.exec("DELETE FROM runner_meta");
    for (let page = 0; page < 5; page++) {
      const response = await handleUserDataDeleteRoute({ env: source,
        request: new Request("https://worker.example.test/internal/users/synthetic/data", { method: "DELETE", body: "{}" }),
      } as never, ids[3]!);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "runtime_migration_pending" });
      expect(await web.backend(ids[1]!)).toBe("legacy");
    }
    expect(await web.backend(ids[3]!)).toBe("postgres");
    expect(await web.prisma.hostedMailboxItem.count({ where: { userId: ids[3]! } })).toBe(0);
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: objects[1] });
  }, 30_000);
});


function canaryOperator(): RuntimeMigrationOperator {
  return {
    accountId: "f".repeat(32), scriptName: "synthetic-worker", workerVersion: campaign.workerVersion,
    cloudflareToken: "synthetic-token", workerBaseUrl: "https://worker.example.test",
    workerAuthorization: async () => new Headers(),
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "api.cloudflare.com") {
        if (url.pathname.endsWith("/deployments")) return Response.json({ success: true, result: { deployments: [{ versions: [{ percentage: 100, version_id: campaign.workerVersion }] }] } });
        if (url.pathname.endsWith("/namespaces")) return Response.json({ success: true, result: [{ id: campaign.namespaceId, script: "synthetic-worker", class: "UserRunnerDurableObject", use_sqlite: true }], result_info: { total_pages: 1 } });
        throw new Error("Sealed canary must not need a new provider census.");
      }
      return runtimeMigrationRoutes[0]!.handle({ env: source, environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
        url, request: new Request(url, init) }, {});
    },
  };
}

describe.skipIf(!enabled)("bounded operator with canonical selection and first-use recovery", () => {
  beforeEach(async () => {
    configureLocalCrypto();
    sources.clear(); source.CF_VERSION_METADATA = { id: campaign.workerVersion };
    web = await createHostedRuntimeMigrationRehearsalForTest({ databaseUrl: process.env.DATABASE_URL ?? "", userIds: ids, objectIds: objects });
    transport.owner.mockImplementation(({ userId, command }: { userId: string; command: HostedRuntimeOwnerCommand }) => web.ownerCommand(userId, command));
    transport.command.mockImplementation(({ command: input }: { command: HostedRuntimeMigrationCommand }) => command(input));
  });
  afterEach(async () => { await web?.close(); vi.unstubAllEnvs(); });

  it.each(["member", "bound-empty", "physical-empty"] as const)("keeps the next baseline member live after a one-object %s canary", async kind => {
    await proveCanaryBoundary(kind, null);
  });
  it.each(["member", "bound-empty", "physical-empty"] as const)("recovers lost import replies within the same %s canary", async kind => {
    await proveCanaryBoundary(kind, "import");
  });
  it.each(["member", "bound-empty", "physical-empty"] as const)("keeps baseline selection closed after a lost %s activation reply", async kind => {
    await proveCanaryBoundary(kind, "activation");
  });

  it.each([null, "select_member", "import_member", "activate_member"] as const)("targets a later member and retries safely after %s", async fault => {
    const first = await prepareTargetedCanary();
    const prepare = vi.spyOn(first.object, "preparePostgresMemberMigration");
    let loseReply = fault !== null;
    transport.command.mockImplementation(async ({ command: input }: { command: HostedRuntimeMigrationCommand }) => {
      const result = await command(input);
      if (loseReply && input.operation === fault) { loseReply = false; throw new Error("synthetic lost targeted reply"); }
      return result;
    });
    const run = () => migrateHostedLegacyRuntime({ ...canaryOperator(), activate: false, memberId: ids[1]!, maxObjects: 1 });
    if (fault) await expect(run()).rejects.toThrow("lost targeted reply");
    expect(await run()).toMatchObject({ phase: fault === "activate_member" ? "member_migrated" : "rolling" });
    expect(await run()).toEqual({ phase: "member_migrated", steps: 0 });
    expect(await web.backend(ids[1]!)).toBe("postgres");
    expect(await web.backend(ids[0]!)).toBe("legacy");
    expect(prepare).not.toHaveBeenCalled();
    expect(first.values.has("runtime-migration-freeze:v1")).toBe(false);
    expect(await web.prisma.hostedMailboxItem.count({ where: { userId: ids[1]! } })).toBe(1);
  });

  it("refuses to replace another unfinished handoff for a requested member", async () => {
    await prepareTargetedCanary();
    expect(await command({ operation: "next_object", ...campaign })).toEqual({ objectId: objects[0] });
    await expect(command({ operation: "select_member", ...campaign, userId: ids[1]! })).rejects.toThrow("unfinished handoff");
    expect(await command({ operation: "select_member", ...campaign, userId: ids[0]! })).toEqual({ objectId: objects[0] });
    expect(await web.backend(ids[1]!)).toBe("legacy");
  });

  it.each(["missing", "ambiguous", "contradictory"] as const)("rejects a %s requested-member binding before selection", async kind => {
    await prepareTargetedCanary();
    if (kind === "ambiguous") await web.prisma.hostedRuntimeLegacyImport.create({ data: { objectId: objects[2]!, userId: ids[1]!, nextCursor: { section: 0, after: "" } } });
    if (kind === "contradictory") await web.prisma.hostedRuntimeLegacyImport.update({ where: { objectId: objects[1]! }, data: { userId: ids[0]! } });
    await expect(command({ operation: "select_member", ...campaign, userId: ids[kind === "missing" ? 2 : 1]! })).rejects.toThrow("one consistent enrolled source");
    expect((await web.prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } })).selectedObjectId).toBeNull();
    expect(await web.backend(ids[0]!)).toBe("legacy");
    expect(await web.backend(ids[1]!)).toBe("legacy");
  });
});

async function prepareTargetedCanary() {
  await web.seed(ids[0]!); await web.seed(ids[1]!);
  const first = legacySource(0, false); legacySource(1, false);
  await command({ operation: "begin_rolling", ...campaign });
  await command({ operation: "enroll_sources", ...campaign, bindings: ids.slice(0, 2).map((userId, index) => ({ userId, objectId: objects[index]! })) });
  await command({ operation: "discover", ...campaign, objectIds: objects.slice(0, 2), complete: true });
  await command({ operation: "close_legacy_creation", ...campaign });
  await command({ operation: "inventory", ...campaign, objectIds: objects.slice(0, 2), after: "", complete: true });
  return first;
}

async function proveCanaryBoundary(kind: "member" | "bound-empty" | "physical-empty", fault: "import" | "activation" | null) {
  if (kind !== "physical-empty") await web.seed(ids[0]!);
  await web.seed(ids[1]!);
  const first = legacySource(0, false);
  if (kind !== "member") first.sql.exec("DELETE FROM runner_meta");
  const unrelated = legacySource(1, false);
  const preparation = vi.spyOn(unrelated.object, "preparePostgresMemberMigration");
  await command({ operation: "begin_rolling", ...campaign });
  await command({ operation: "enroll_sources", ...campaign, bindings: ids.slice(kind === "physical-empty" ? 1 : 0, 2)
    .map(userId => ({ userId, objectId: objects[ids.indexOf(userId)]! })) });
  await command({ operation: "discover", ...campaign, objectIds: objects.slice(0, 2), complete: true });
  await command({ operation: "close_legacy_creation", ...campaign });
  await command({ operation: "inventory", ...campaign, objectIds: objects.slice(0, 2), after: "", complete: true });
  let loseReply = fault !== null;
  transport.command.mockImplementation(async ({ command: input }: { command: HostedRuntimeMigrationCommand }) => {
    const result = await command(input);
    const operation = `${fault === "import" ? "import" : "activate"}_${kind === "member" ? "member" : "empty"}`;
    if (loseReply && input.operation === operation) { loseReply = false; throw new Error("synthetic lost committed canary reply"); }
    return result;
  });
  const run = () => migrateHostedLegacyRuntime({ ...canaryOperator(), activate: false, maxObjects: 1 });
  if (fault) await expect(run()).rejects.toThrow("lost committed canary reply");
  if (fault !== "activation") expect(await run()).toMatchObject({ phase: "rolling", pending: "object_budget" });
  if (kind !== "physical-empty") expect(await web.backend(ids[0]!)).toBe("postgres");
  const afterCanary = await web.prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
  await web.seed(ids[2]!);
  const empty = legacySource(2, false); empty.sql.exec("DELETE FROM runner_meta");
  for (let page = 0; page < 5; page++) {
    await progressRuntimeMigrationForMember({ source, userId: ids[2]!, budget: { deadlineAtMs: Date.now() + 10_000 } });
  }
  expect({ selectedAfterCanary: afterCanary.selectedObjectId, unrelatedBackend: await web.backend(ids[1]!),
    firstUseBackend: await web.backend(ids[2]!) }).toEqual({
    selectedAfterCanary: objects[0], unrelatedBackend: "legacy", firstUseBackend: "postgres",
  });
  expect(preparation).not.toHaveBeenCalled();
  expect(unrelated.values.has("runtime-migration-freeze:v1")).toBe(false);
  if (kind !== "physical-empty") expect(await web.prisma.hostedMailboxItem.count({ where: { userId: ids[0]! } })).toBe(1);
}
