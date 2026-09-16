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
  const identity = await readServingIdentity(input);
  const objectIds = await listAllObjects(cloudflareReader(input), identity.namespaceId);
  return { ...identity, objectIds, hash: inventoryHash(objectIds), count: objectIds.length };
}

async function readServingIdentity(input: RuntimeMigrationOperator) {
  const get = cloudflareReader(input);
  const deployments = record((await get(`workers/scripts/${encodeURIComponent(input.scriptName)}/deployments`)).result);
  const latest = Array.isArray(deployments.deployments) ? record(deployments.deployments[0]) : {};
  const versions = Array.isArray(latest.versions) ? latest.versions.map(record) : [];
  if (versions.length !== 1 || versions[0]?.percentage !== 100 || versions[0]?.version_id !== input.workerVersion) throw new Error("Migration requires one exact Worker version serving 100% of traffic.");
  return { namespaceId: await findLegacyNamespace(get, input.scriptName), workerVersion: input.workerVersion };
}

/** Hosted rolling driver. Each invocation is bounded and resumes from canonical
 * receipts. A held or uncertain handoff never advances the ordered selection;
 * all other members keep their existing backend. Members activate independently;
 * namespace retirement requires a separate proof and is not supported here.
 */
type RollingOperator = RuntimeMigrationOperator & {
  activate: boolean; maxSteps?: number; maxObjects?: number; waitForPending?: boolean; maxDurationMs?: number;
  memberId?: string;
};
export async function migrateHostedLegacyRuntime(input: RollingOperator) {
  const { maxSteps, maxObjects, deadline } = readRollingLimits(input);
  const identity = await readServingIdentity(input);
  const send = workerCommander(input);
  let gate = record((await send({ operation: "begin_rolling", ...identity })).gate);
  if (gate.phase === "postgres") return { phase: "postgres", steps: 0 };
  if (gate.phase !== "rolling") throw new Error("Rolling operator cannot continue a fleet-draining campaign.");
  // Recovery of a paused source must not depend on unrelated object-list
  // drift or availability. Exact serving identity is still required; final
  // campaign accounting independently checks the complete provider census.
  if (!gate.inventorySealedAt) {
    const inventory = await inventoryHostedLegacyRuntime(input);
    if (inventory.namespaceId !== identity.namespaceId) throw new Error("Migration namespace changed before discovery.");
    gate = await prepareRollingInventory(input, send, inventory, gate);
  }
  let objectId: string | null = null;
  let selectedCount = 0;
  for (let steps = 1; steps <= maxSteps; steps++) {
    if (Date.now() >= deadline) return { phase: "rolling", steps: steps - 1, pending: "time_budget" };
    if (objectId === null) {
      // Selection is durable authority for automatic continuations too. Check
      // the budget before selecting, and retain this source until activation.
      if (selectedCount >= maxObjects) return { phase: "rolling", steps: steps - 1, pending: "object_budget" };
      const next = await send(input.memberId === undefined ? { operation: "next_object", ...identity }
        : { operation: "select_member", ...identity, userId: input.memberId });
      if (next.objectId === null) {
        if (input.memberId !== undefined) return { phase: "member_migrated", steps: steps - 1 };
        if (await enrollCanonicalSources(send, identity) > 0) continue;
        const settled = await send({ operation: "settle_unmaterialized", ...identity });
        if (settled.done === true) return finishRollingMigration(input, send, identity, gate, steps);
        if (settled.done !== false) throw new Error("Unmaterialized settlement receipt is invalid.");
        continue;
      }
      objectId = requireObjectId(next.objectId);
      selectedCount++;
    }
    const result = await advanceSelectedObject(send, identity, objectId);
    if (migrationActivated(result)) objectId = null;
    if (typeof result.pending !== "string") continue;
    if (!input.waitForPending || !["checkpoint", "freeze", "source_changed"].includes(result.pending)) {
      return { phase: "rolling", steps, pending: result.pending, ...(result.pending === "readiness" ? { readiness: result.readiness } : {}) };
    }
    // Keep the same durable selection while a closed source drains. Returning
    // here would add workflow queue/install latency to the member's pause.
    await delay(Math.min(1_000, Math.max(0, deadline - Date.now())));
  }
  return { phase: "rolling", steps: maxSteps, pending: "step_budget" };
}

function migrationActivated(result: Record<string, unknown>) {
  // A completed import page is not activation. Empty-source and member
  // activation have different canonical receipts.
  return result.done === true || (result.member != null && record(result.member).migrationPhase === "postgres");
}

function readRollingLimits(input: RollingOperator) {
  if (input.activate) throw new Error("Rolling migration cannot finalize the namespace.");
  const maxSteps = input.maxSteps ?? 25;
  const maxObjects = input.maxObjects ?? 1_000;
  const maxDurationMs = input.maxDurationMs ?? 600_000;
  if (input.memberId !== undefined && (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.memberId) || maxObjects !== 1)) {
    throw new TypeError("Targeted migration requires a valid member identity and a one-object budget.");
  }
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
  const result = await send({ operation: "advance_member", ...identity, objectId, userId, migrationId });
  // The Worker decides readiness; report its inspected inputs as flags and bounded counts only.
  return result.pending === "readiness" ? { ...result, readiness: readinessSummary(observed) } : result;
}
function readinessSummary(observed: Record<string, unknown>) {
  const drainUntil = typeof observed.snapshotPutDrainUntil === "string" ? Date.parse(observed.snapshotPutDrainUntil) : Number.NaN;
  return {
    activeAttempt: observed.activeAttemptId != null, containerBound: observed.activeRunnerContainerName != null,
    snapshotPutDrainMs: Number.isFinite(drainUntil) ? Math.max(0, drainUntil - Date.now()) : 0,
    replicaPendingWrites: typeof observed.replicaPendingWrites === "number" ? observed.replicaPendingWrites : null,
    managedSnapshotPendingUploads: typeof observed.managedSnapshotPendingUploads === "number" ? observed.managedSnapshotPendingUploads : null,
  };
}

async function prepareRollingInventory(input: RuntimeMigrationOperator, send: Commander,
  inventory: Awaited<ReturnType<typeof inventoryHostedLegacyRuntime>>, initialGate: Record<string, unknown>) {
  const identity = { namespaceId: inventory.namespaceId, workerVersion: inventory.workerVersion };
  let gate = initialGate;
  if (!gate.inventorySealedAt && gate.inventoryCount === 0) {
    await discoverSources(send, identity, inventory.objectIds);
    await enrollCanonicalSources(send, identity);
    gate = record((await send({ operation: "close_legacy_creation", ...identity })).gate);
    // Census once more after closing materialization. The database inventory
    // also retains intents whose physical object never appeared in the listing.
    const closed = await inventoryHostedLegacyRuntime(input);
    if (closed.namespaceId !== identity.namespaceId) throw new Error("Migration namespace changed during creation closure.");
    await discoverSources(send, identity, closed.objectIds);
  }
  const registered = await readRegisteredSources(send, identity);
  requireProviderCoverage(inventory, identity, registered.all);
  if (!gate.inventorySealedAt) gate = await sealRegisteredSources(send, identity, registered.baseline, gate);
  requireSealedInventory(gate, registered.baseline);
  return gate;
}

async function enrollCanonicalSources(send: Commander, identity: CampaignIdentity) {
  let enrolled = 0;
  for (let page = 0; page <= MAX_OBJECTS / 100; page++) {
    const result = await send({ operation: "enroll_members", ...identity });
    if (result.enrolled === 0 && result.cleanupPending !== true) return enrolled;
    if (typeof result.enrolled !== "number" || !Number.isInteger(result.enrolled) || result.enrolled < 0 || result.enrolled > 100) {
      throw new Error("Canonical source enrollment receipt is invalid.");
    }
    enrolled += result.enrolled;
  }
  throw new Error("Canonical source enrollment exceeded its page bound.");
}
async function discoverSources(send: Commander, identity: CampaignIdentity, objectIds: string[]) {
  for (let index = 0; index < objectIds.length || index === 0; index += 100) {
    await send({ operation: "discover", ...identity, objectIds: objectIds.slice(index, index + 100), complete: index + 100 >= objectIds.length });
  }
}
async function readRegisteredSources(send: Commander, identity: CampaignIdentity): Promise<{ all: string[]; baseline: string[] }> {
  const ids: string[] = [];
  const baseline: string[] = [];
  let after = "";
  for (let page = 0; page <= MAX_OBJECTS / 100; page++) {
    const result = await send({ operation: "list_inventory", ...identity, after });
    if (!Array.isArray(result.objects) || result.objects.length > 100) throw new Error("Registered source inventory is invalid.");
    for (const item of result.objects) {
      const row = record(item);
      const id = requireObjectId(row.objectId);
      if (row.inventoryClass !== "baseline" && row.inventoryClass !== "late") throw new Error("Registered source inventory class is invalid.");
      if (row.inventoryClass === "baseline") baseline.push(id);
      if (id <= after || ids.length >= MAX_OBJECTS) throw new Error("Registered source inventory is unordered or exceeds its bound.");
      ids.push(id); after = id;
    }
    if (result.nextAfter === null) return { all: ids, baseline };
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
async function finishRollingMigration(input: RuntimeMigrationOperator, send: Commander,
  identity: CampaignIdentity, gate: Record<string, unknown>, steps: number) {
  const finalInventory = await inventoryHostedLegacyRuntime(input);
  const registered = await readRegisteredSources(send, identity);
  requireSealedInventory(gate, registered.baseline);
  const known = new Set(registered.all);
  const late = finalInventory.objectIds.filter(id => !known.has(id));
  if (finalInventory.namespaceId !== identity.namespaceId) throw new Error("Migration namespace changed during final accounting.");
  if (late.length) {
    await discoverSources(send, identity, late);
    return { phase: "rolling", steps, pending: "late_sources" };
  }
  // New canonical identities or registered late sources may have arrived while
  // the provider scan was running. Never label that wider cohort complete.
  if (await enrollCanonicalSources(send, identity) > 0
    || (await send({ operation: "next_object", ...identity })).objectId !== null) {
    return { phase: "rolling", steps, pending: "late_sources" };
  }
  if ((await send({ operation: "settle_unmaterialized", ...identity })).done !== true) {
    return { phase: "rolling", steps, pending: "member_activation" };
  }
  return { phase: "members_migrated", steps };
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
    const info = record(response.result_info);
    // The live namespace list reports total_count without total_pages; derive the page count from either.
    const totalPages = info.total_pages ?? (typeof info.total_count === "number" ? Math.ceil(info.total_count / 50) : undefined);
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
