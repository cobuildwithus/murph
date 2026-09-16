import { pathToFileURL } from "node:url";
import { inventoryHostedLegacyRuntime, migrateHostedLegacyRuntime, type RuntimeMigrationOperator } from "./runtime-migration.ts";
import { createHostedWebCallbackSignatureHeaders, readHostedWebCallbackSigningEnvironment } from "../src/web-callback-auth.ts";

type Source = Readonly<Record<string, string | undefined>>;

/** Production credentials stay in the protected private deployment workflow.
 * Output contains counts, hashes and phases; never member/source inventory.
 */
export function readRuntimeMigrationOperator(source: Source) {
  if (source.GITHUB_ACTIONS !== "true" || source.GITHUB_REPOSITORY !== "cobuildwithus/murph-cloud"
    || source.GITHUB_REF !== "refs/heads/main") throw new Error("Runtime migration CLI requires the protected Murph Cloud main workflow.");
  const { mode, maxSteps, maxObjects, activate, memberId } = readMigrationOptions(source);
  const workerVersion = required(source, "MURPH_RUNTIME_MIGRATION_WORKER_VERSION");
  const scriptName = required(source, "CF_WORKER_NAME");
  if (![workerVersion, scriptName].every(value => /^[A-Za-z0-9_-]{1,128}$/u.test(value))) throw new Error("Runtime migration version or script identity is invalid.");
  const origin = new URL(required(source, "CF_PUBLIC_BASE_URL"));
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("Runtime migration requires the configured HTTPS Worker origin.");
  }
  const input: RuntimeMigrationOperator = {
    accountId: required(source, "CLOUDFLARE_ACCOUNT_ID"), cloudflareToken: required(source, "CLOUDFLARE_API_TOKEN"),
    scriptName, workerVersion, workerBaseUrl: origin.origin,
    workerAuthorization: async request => new Headers(await createHostedWebCallbackSignatureHeaders({
      ...request, environment: readHostedWebCallbackSigningEnvironment(source), userId: null,
    })),
  };
  return { input, mode, maxSteps, maxObjects, activate, memberId };
}

function readMigrationOptions(source: Source) {
  const mode = source.MURPH_RUNTIME_MIGRATION_MODE ?? "inventory";
  if (mode !== "inventory" && mode !== "migrate") throw new Error("Runtime migration mode must be inventory or migrate.");
  const maxSteps = Number(source.MURPH_RUNTIME_MIGRATION_MAX_STEPS ?? "1000");
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 1_000) throw new Error("Runtime migration requires a step bound from 1 to 1000.");
  const maxObjects = Number(source.MURPH_RUNTIME_MIGRATION_MAX_OBJECTS ?? "1");
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 1_000) throw new Error("Runtime migration requires an object bound from 1 to 1000.");
  const finalize = source.MURPH_RUNTIME_MIGRATION_FINALIZE ?? "false";
  if (finalize !== "false") throw new Error("Rolling migration cannot finalize the namespace.");
  const memberId = source.MURPH_RUNTIME_MIGRATION_MEMBER_ID?.trim() || undefined;
  if (memberId !== undefined && (!/^[A-Za-z0-9_-]{1,128}$/u.test(memberId) || maxObjects !== 1 || mode !== "migrate")) {
    throw new Error("Targeted migration requires a valid member identity, migrate mode and a one-object budget.");
  }
  return { mode, maxSteps, maxObjects, activate: false, memberId };
}

export async function runRuntimeMigrationOperator(source: Source, fetchImpl?: typeof fetch) {
  const { input, mode, maxSteps, maxObjects, activate, memberId } = readRuntimeMigrationOperator(source);
  if (mode === "inventory") {
    const inventory = await inventoryHostedLegacyRuntime({ ...input, fetchImpl });
    return { phase: "inventory", objectCount: inventory.count, inventoryHash: inventory.hash, workerVersion: inventory.workerVersion };
  }
  return migrateHostedLegacyRuntime({ ...input, fetchImpl, maxSteps, maxObjects, activate, memberId, waitForPending: true });
}

function required(source: Source, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`Runtime migration requires ${name}.`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRuntimeMigrationOperator(process.env).then(result => console.log(JSON.stringify(result))).catch((error: unknown) => {
    console.error(error instanceof SyntaxError ? "Runtime migration configuration or response is not valid JSON."
      : error instanceof Error ? error.message : "Runtime migration failed.");
    process.exitCode = 1;
  });
}
