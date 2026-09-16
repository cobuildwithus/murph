import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";

export interface RuntimeMigrationOperator {
  accountId: string;
  scriptName: string;
  workerVersion: string;
  cloudflareToken: string;
  workerBaseUrl: string;
  /** Fresh hosted signature or OIDC for each bounded call; never persist it. */
  workerAuthorization: (request: { method: "POST"; path: string; payload: string }) => Promise<Headers>;
  fetchImpl?: typeof fetch;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const MAX_OBJECTS = 100_000;

/** Read-only provider inventory. Includes every object returned by the namespace
 * API, even hasStoredData=false and objects absent from the member database. */
export async function inventoryHostedLegacyRuntime(input: RuntimeMigrationOperator) {
  const get = cloudflareReader(input);
  const deployments = record((await get(`workers/scripts/${encodeURIComponent(input.scriptName)}/deployments`)).result);
  const latest = Array.isArray(deployments.deployments) ? record(deployments.deployments[0]) : {};
  const versions = Array.isArray(latest.versions) ? latest.versions.map(record) : [];
  if (versions.length !== 1 || versions[0]?.percentage !== 100 || versions[0]?.version_id !== input.workerVersion) throw new Error("Migration requires one exact Worker version serving 100% of traffic.");
  const namespaceId = await findLegacyNamespace(get, input.scriptName);
  const objectIds = await listAllObjects(get, namespaceId);
  let hash = digest("");
  for (const id of objectIds) hash = digest(`${hash}\n${id}`);
  return { namespaceId, workerVersion: input.workerVersion, objectIds, hash, count: objectIds.length };
}

/** Hosted rolling driver. Each invocation is bounded and resumes from canonical
 * receipts. A held or uncertain handoff never advances the ordered selection;
 * all other members keep their existing backend. `activate` closes the campaign
 * default only; each successfully imported member activates independently.
 */
type RollingOperator = RuntimeMigrationOperator & {
  activate: boolean; maxSteps?: number; maxObjects?: number; waitForPending?: boolean; maxDurationMs?: number;
};
export async function migrateHostedLegacyRuntime(input: RollingOperator) {
  const { maxSteps, maxObjects, deadline } = readRollingLimits(input);
  const inventory = await inventoryHostedLegacyRuntime(input);
  const identity = { namespaceId: inventory.namespaceId, workerVersion: inventory.workerVersion };
  const send = workerCommander(input);
  let gate = record((await send({ operation: "begin_rolling", ...identity })).gate);
  if (gate.phase === "postgres") return { phase: "postgres", steps: 0 };
  if (gate.phase !== "rolling") throw new Error("Rolling operator cannot continue a fleet-draining campaign.");
  gate = await prepareRollingInventory(input, send, inventory, gate);
  const selected = new Set<string>();
  for (let steps = 1; steps <= maxSteps; steps++) {
    if (Date.now() >= deadline) return { phase: "rolling", steps: steps - 1, pending: "time_budget" };
    const next = await send({ operation: "next_object", ...identity });
    if (next.objectId === null) {
      const settled = await send({ operation: "settle_unmaterialized", ...identity });
      if (settled.done === true) return finishRollingMigration(input, send, identity, gate, steps);
      if (settled.done !== false) throw new Error("Unmaterialized settlement receipt is invalid.");
      continue;
    }
    const objectId = requireObjectId(next.objectId);
    if (!selected.has(objectId) && selected.size >= maxObjects) return { phase: "rolling", steps: steps - 1, pending: "object_budget" };
    selected.add(objectId);
    const result = await advanceSelectedObject(send, identity, objectId);
    if (typeof result.pending !== "string") continue;
    if (!input.waitForPending || !["checkpoint", "freeze", "source_changed"].includes(result.pending)) {
      return { phase: "rolling", steps, pending: result.pending };
    }
    // Keep the same durable selection while a closed source drains. Returning
    // here would add workflow queue/install latency to the member's pause.
    await delay(Math.min(1_000, Math.max(0, deadline - Date.now())));
  }
  return { phase: "rolling", steps: maxSteps, pending: "step_budget" };
}

function readRollingLimits(input: RollingOperator) {
  const maxSteps = input.maxSteps ?? 25;
  const maxObjects = input.maxObjects ?? 1_000;
  const maxDurationMs = input.maxDurationMs ?? 600_000;
  for (const bound of [maxSteps, maxObjects]) {
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > 1_000) throw new TypeError("Migration step and object bounds must be between 1 and 1000.");
  }
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1_000 || maxDurationMs > 3_600_000) throw new TypeError("Migration duration bound must be between one second and one hour.");
  return { maxSteps, maxObjects, deadline: Date.now() + maxDurationMs };
}

type CampaignIdentity = { namespaceId: string; workerVersion: string };
type Commander = ReturnType<typeof workerCommander>;
async function advanceSelectedObject(send: Commander, identity: CampaignIdentity, objectId: string) {
  const inspected = await send({ operation: "inspect_object", ...identity, objectId });
  if (inspected.objectId !== objectId) throw new Error("Migration inspection returned a different source.");
  const observed = record(inspected.observation);
  if (observed.kind !== "observed") throw new Error("Legacy source schema requires recovery before migration.");
  if (observed.userId === null) return send({ operation: "advance_empty", ...identity, objectId });
  if (typeof observed.userId !== "string" || !observed.userId) throw new Error("Legacy source member identity is invalid.");
  const userId = observed.userId;
  const migrationId = digest(JSON.stringify([identity.namespaceId, objectId, userId]));
  return send({ operation: "advance_member", ...identity, objectId, userId, migrationId });
}

async function prepareRollingInventory(input: RuntimeMigrationOperator, send: Commander,
  inventory: Awaited<ReturnType<typeof inventoryHostedLegacyRuntime>>, initialGate: Record<string, unknown>) {
  const identity = { namespaceId: inventory.namespaceId, workerVersion: inventory.workerVersion };
  let gate = initialGate;
  if (!gate.inventorySealedAt && gate.inventoryCount === 0) {
    await discoverSources(send, identity, inventory.objectIds);
    gate = record((await send({ operation: "close_legacy_creation", ...identity })).gate);
    // Census once more after closing materialization. The database inventory
    // also retains intents whose physical object never appeared in the listing.
    const closed = await inventoryHostedLegacyRuntime(input);
    if (closed.namespaceId !== identity.namespaceId) throw new Error("Migration namespace changed during creation closure.");
    await discoverSources(send, identity, closed.objectIds);
  }
  const registered = await readRegisteredSources(send, identity);
  requireProviderCoverage(inventory, identity, registered);
  if (!gate.inventorySealedAt) gate = await sealRegisteredSources(send, identity, registered, gate);
  requireSealedInventory(gate, registered);
  return gate;
}

async function discoverSources(send: Commander, identity: CampaignIdentity, objectIds: string[]) {
  for (let index = 0; index < objectIds.length || index === 0; index += 100) {
    await send({ operation: "discover", ...identity, objectIds: objectIds.slice(index, index + 100), complete: index + 100 >= objectIds.length });
  }
}
async function readRegisteredSources(send: Commander, identity: CampaignIdentity): Promise<string[]> {
  const ids: string[] = [];
  let after = "";
  for (let page = 0; page <= MAX_OBJECTS / 100; page++) {
    const result = await send({ operation: "list_inventory", ...identity, after });
    if (!Array.isArray(result.objects) || result.objects.length > 100) throw new Error("Registered source inventory is invalid.");
    for (const item of result.objects) {
      const id = requireObjectId(record(item).objectId);
      if (id <= after || ids.length >= MAX_OBJECTS) throw new Error("Registered source inventory is unordered or exceeds its bound.");
      ids.push(id); after = id;
    }
    if (result.nextAfter === null) return ids;
    if (!result.objects.length || result.nextAfter !== after) throw new Error("Registered source inventory cursor did not advance.");
  }
  throw new Error("Registered source inventory exceeded its page bound.");
}
async function sealRegisteredSources(send: Commander, identity: CampaignIdentity, ids: string[], initialGate: Record<string, unknown>) {
  let gate = initialGate;
  const count = gate.inventoryCount;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > ids.length
    || gate.inventoryHash !== inventoryHash(ids.slice(0, count)) || gate.inventoryAfter !== (ids[count - 1] ?? "")) {
    throw new Error("Migration inventory receipt is stale or invalid.");
  }
  for (let index = count; index < ids.length || index === count; index += 100) {
    gate = record((await send({ operation: "inventory", ...identity, after: ids[index - 1] ?? "",
      objectIds: ids.slice(index, index + 100), complete: index + 100 >= ids.length })).gate);
    if (gate.inventorySealedAt) return gate;
  }
  throw new Error("Migration inventory seal was not acknowledged.");
}
async function finishRollingMigration(input: RuntimeMigrationOperator & { activate: boolean }, send: Commander,
  identity: CampaignIdentity, gate: Record<string, unknown>, steps: number) {
  const finalInventory = await inventoryHostedLegacyRuntime(input);
  const registered = await readRegisteredSources(send, identity);
  requireProviderCoverage(finalInventory, identity, registered);
  requireSealedInventory(gate, registered);
  if (!input.activate) return { phase: "members_migrated", steps };
  const activated = record((await send({ operation: "activate", ...identity, inventoryHash: inventoryHash(registered), inventoryCount: registered.length })).gate);
  if (activated.phase !== "postgres") throw new Error("Campaign activation was not acknowledged.");
  return { phase: "postgres", steps };
}
function requireProviderCoverage(inventory: { namespaceId: string; objectIds: string[] }, identity: CampaignIdentity, registered: string[]) {
  const known = new Set(registered);
  if (inventory.namespaceId !== identity.namespaceId || inventory.objectIds.some(id => !known.has(id))) {
    throw new Error("Namespace inventory changed beyond the registered census; migration remains held.");
  }
}
function requireSealedInventory(gate: Record<string, unknown>, ids: string[]) {
  if (!gate.inventorySealedAt || gate.inventoryCount !== ids.length || gate.inventoryHash !== inventoryHash(ids)) {
    throw new Error("Registered source inventory does not match its sealed receipt.");
  }
}
function inventoryHash(ids: string[]) { return ids.reduce((hash, id) => digest(`${hash}\n${id}`), digest("")); }
function requireObjectId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error("Migration source identity is invalid.");
  return value;
}

async function findLegacyNamespace(get: (path: string) => Promise<Record<string, unknown>>, scriptName: string): Promise<string> {
  const matches: string[] = [];
  for (let page = 1; page <= 100; page++) {
    const response = await get(`workers/durable_objects/namespaces?page=${page}&per_page=50`);
    if (!Array.isArray(response.result)) throw new Error("Cloudflare namespace inventory is invalid.");
    for (const item of response.result) {
      const namespace = record(item);
      if (namespace.script === scriptName && namespace.class === "UserRunnerDurableObject") {
        if (namespace.use_sqlite !== true || typeof namespace.id !== "string" || !/^[a-f0-9-]{1,64}$/u.test(namespace.id)) throw new Error("Legacy namespace identity is invalid.");
        matches.push(namespace.id);
      }
    }
    const totalPages = record(response.result_info).total_pages;
    if (typeof totalPages !== "number" || !Number.isSafeInteger(totalPages) || totalPages < 0 || totalPages > 100) throw new Error("Cloudflare namespace pagination is incomplete.");
    if (page >= totalPages) {
      if (matches.length !== 1) throw new Error("Expected exactly one legacy runtime namespace for the serving script.");
      return matches[0]!;
    }
  }
  throw new Error("Cloudflare namespace inventory exceeded its bound.");
}
async function listAllObjects(get: (path: string) => Promise<Record<string, unknown>>, namespaceId: string): Promise<string[]> {
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 1000; page++) {
    const response = await get(`workers/durable_objects/namespaces/${namespaceId}/objects?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!Array.isArray(response.result)) throw new Error("Cloudflare object inventory is invalid.");
    for (const value of response.result) {
      const id = record(value).id;
      if (typeof id !== "string" || !/^[a-f0-9]{64}$/u.test(id) || ids.has(id)) throw new Error("Cloudflare object inventory contains an invalid or repeated identity.");
      ids.add(id);
      if (ids.size > MAX_OBJECTS) throw new Error("Cloudflare object inventory exceeded its bound.");
    }
    const next = record(response.result_info).cursor;
    if (next === undefined || next === null || next === "") return [...ids].sort();
    if (typeof next !== "string" || next.length > 4096 || cursors.has(next)) throw new Error("Cloudflare object inventory cursor did not advance.");
    cursors.add(next); cursor = next;
  }
  throw new Error("Cloudflare object inventory exceeded its page bound.");
}
function cloudflareReader(input: RuntimeMigrationOperator) {
  if (!/^[a-f0-9]{32}$/u.test(input.accountId)) throw new TypeError("Cloudflare account identity is invalid.");
  return async (path: string) => {
    const response = await (input.fetchImpl ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/${path}`, {
      headers: { authorization: `Bearer ${input.cloudflareToken}` }, redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    const result = await readResponse(response);
    if (result.success !== true) throw new Error("Cloudflare inventory request was not successful.");
    return result;
  };
}
function workerCommander(input: RuntimeMigrationOperator) {
  const url = new URL("/internal/runtime-migration", input.workerBaseUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new TypeError("Migration Worker URL must be an HTTPS origin.");
  return async (command: HostedRuntimeMigrationCommand) => {
    const payload = JSON.stringify(command);
    const headers = await input.workerAuthorization({ method: "POST", path: url.pathname, payload });
    headers.set("content-type", "application/json");
    return readResponse(await (input.fetchImpl ?? fetch)(url, { method: "POST", headers, body: payload,
      redirect: "error", signal: AbortSignal.timeout(30_000) }));
  };
}
async function readResponse(response: Response) {
  if (!response.ok) throw new Error(`Runtime migration request returned HTTP ${response.status}.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Runtime migration response is empty.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error("Runtime migration response exceeded its bound.");
      chunks.push(item.value);
    }
    return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Runtime migration response shape is invalid.");
  return value as Record<string, unknown>;
}
