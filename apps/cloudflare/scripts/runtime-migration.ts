import { createHash } from "node:crypto";
import type { HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";

export interface RuntimeMigrationOperator {
  accountId: string;
  scriptName: string;
  workerVersion: string;
  cloudflareToken: string;
  workerBaseUrl: string;
  /** Refresh OIDC for each bounded call; never persist a token in migration state. */
  workerAuthorization: () => Promise<Headers>;
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

/** Authorized hosted operator only. No deploy/rollback or destructive namespace
 * removal occurs here. It stops at held drains; rerunning resumes durable pages.
 * Activation is a separate explicit invocation after the import is complete. */
export async function migrateHostedLegacyRuntime(input: RuntimeMigrationOperator & { activate: boolean }) {
  const inventory = await inventoryHostedLegacyRuntime(input);
  const identity = { namespaceId: inventory.namespaceId, workerVersion: inventory.workerVersion };
  const send = workerCommander(input);
  let gate = record((await send({ operation: "begin", ...identity })).gate);
  if (gate.phase === "postgres") return { phase: "postgres", importedObjects: inventory.count };
  gate = await registerInventory(send, inventory, gate);
  if (gate.inventoryHash !== inventory.hash || gate.inventoryCount !== inventory.count) throw new Error("Namespace inventory changed after sealing; activation remains blocked.");
  let importedObjects = 0;
  for (const objectId of inventory.objectIds) {
    for (let page = 0; page < 100_000; page++) {
      const result = await send({ operation: "read_object", ...identity, objectId });
      if (result.draining === true) return { phase: "draining", importedObjects };
      if (record(result.object).completedAt) { importedObjects++; break; }
      if (page === 99_999) throw new Error("Legacy object export exceeded the operator page bound.");
    }
  }
  if (!input.activate) return { phase: "imported", importedObjects };
  const finalInventory = await inventoryHostedLegacyRuntime(input);
  if (finalInventory.namespaceId !== inventory.namespaceId || finalInventory.hash !== inventory.hash || finalInventory.count !== inventory.count) throw new Error("Final namespace inventory changed; activation remains blocked.");
  await send({ operation: "activate", ...identity, inventoryHash: finalInventory.hash, inventoryCount: finalInventory.count });
  return { phase: "postgres", importedObjects };
}

async function registerInventory(
  send: ReturnType<typeof workerCommander>,
  inventory: Awaited<ReturnType<typeof inventoryHostedLegacyRuntime>>,
  gate: Record<string, unknown>,
) {
  const identity = { namespaceId: inventory.namespaceId, workerVersion: inventory.workerVersion };
  if (!gate.inventorySealedAt) {
    const count = gate.inventoryCount;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > inventory.count) throw new Error("Migration inventory receipt is invalid.");
    let expected = digest("");
    for (const id of inventory.objectIds.slice(0, count)) expected = digest(`${expected}\n${id}`);
    if (expected !== gate.inventoryHash || gate.inventoryAfter !== (inventory.objectIds[count - 1] ?? "")) throw new Error("Namespace inventory changed during migration.");
    for (let index = count; index < inventory.count || index === count && count === inventory.count; index += 100) {
      const objectIds = inventory.objectIds.slice(index, index + 100);
      gate = record((await send({ operation: "inventory", ...identity, after: inventory.objectIds[index - 1] ?? "", objectIds, complete: index + 100 >= inventory.count })).gate);
      if (gate.inventorySealedAt) break;
    }
  }
  return gate;
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
    const headers = await input.workerAuthorization();
    headers.set("content-type", "application/json");
    return readResponse(await (input.fetchImpl ?? fetch)(url, { method: "POST", headers, body: JSON.stringify(command),
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
