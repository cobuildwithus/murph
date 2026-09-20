import { pathToFileURL } from "node:url";
import { parseHostedCipherEnvelope } from "@murphai/runtime-state";
import { parseHostedWorkspaceReadResponse } from "@murphai/hosted-execution/parsers";
import { createHostedStorageNamespaceId } from "@murphai/hosted-execution/storage-paths";
import { HOSTED_RUNTIME_WORKSPACE_PATH } from "@murphai/hosted-execution/routes";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { readHostedWebCallbackSigningEnvironment } from "../src/web-callback-auth.ts";
import {
  fetchHostedWorkerRuntimeRootByRootKeyId, type HostedWorkerCryptoEnv,
} from "../src/hosted-crypto/runtime-crypto-context.ts";
import {
  authenticateUnindexedArtifact, openRecoveryAssessmentRequest, recoveryPublicJwk,
} from "./checkpoint-recovery-envelope.ts";

const MAX_OBJECT_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_OBJECTS = 10_000;
const MAX_ROOTS = 16;
const RECEIPT_SCHEMA = "murph.hosted-canonical-write-receipt.v1";
const LOG_SCHEMA = "murph.hosted-canonical-write-receipt-log.v1";
type Env = Readonly<Record<string, string | undefined>>;
type ContentReference = { sha256: string; byteSize: number };
type ReceiptEvidence = { paths: string[]; contents: ContentReference[]; deletes: number; appends: number };

class RecoveryRemoteReadError extends Error {
  constructor(readonly httpStatus: number) { super("recovery_remote_read_failed"); }
}

function contentReference(value: unknown): ContentReference | null {
  if (!record(value) || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.byteSize !== "number" || !Number.isSafeInteger(value.byteSize) || value.byteSize < 0) return null;
  return { sha256: value.sha256, byteSize: value.byteSize };
}

function receiptAction(value: unknown): Record<string, unknown> & { targetRelativePath: string } | null {
  if (!record(value) || typeof value.targetRelativePath !== "string"
    || !["text_upsert", "jsonl_append", "raw_upsert", "delete", "delete_if_match"].includes(String(value.kind))) return null;
  const path = value.targetRelativePath;
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return { ...value, targetRelativePath: path };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function required(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new Error("missing_recovery_configuration");
  return value;
}

export async function readRecoveryResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new RecoveryRemoteReadError(response.status);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error("recovery_read_limit_exceeded");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

// This is an inventory of authenticated candidates, never an assertion that an
// upload was accepted as canonical state. No content is restored by this tool.
export function inspectReceiptCandidate(plaintext: Uint8Array, before: number): ReceiptEvidence | null {
  if (plaintext.byteLength > 4 * 1024 * 1024) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(plaintext)); } catch { return null; }
  if (!record(parsed) || parsed.schema !== RECEIPT_SCHEMA || !Array.isArray(parsed.actions)
    || typeof parsed.committedAt !== "string" || !Number.isFinite(Date.parse(parsed.committedAt))
    || Date.parse(parsed.committedAt) > before || parsed.actions.length > 10_000) return null;
  const result: ReceiptEvidence = { paths: [], contents: [], deletes: 0, appends: 0 };
  for (const raw of parsed.actions) {
    const action = receiptAction(raw);
    if (!action) return null;
    result.paths.push(action.targetRelativePath);
    if (action.kind === "delete" || action.kind === "delete_if_match") result.deletes++;
    if (action.kind === "jsonl_append") result.appends++;
    const ref = contentReference(action.contentRef);
    if (ref) result.contents.push(ref);
  }
  return result;
}

async function* readArtifactInventory(input: {
  api: string; prefix: string; token: string; fetchImpl: typeof fetch;
  stats: { objects: number; bytes: number };
}) {
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  const headers = { Authorization: `Bearer ${input.token}` };
  do {
    const query = new URLSearchParams({ prefix: input.prefix, per_page: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await input.fetchImpl(`${input.api}?${query}`, { headers });
    const page: unknown = JSON.parse(Buffer.from(await readRecoveryResponse(response, 1024 * 1024)).toString("utf8"));
    if (!record(page) || page.success !== true || !Array.isArray(page.result) || page.result.length > 100) throw new Error("invalid_recovery_listing");
    for (const object of page.result) {
      const key = inventoryObjectKey(object, input.prefix);
      if (seen.has(key) || seen.size >= MAX_OBJECTS) throw new Error("recovery_object_limit_or_duplicate");
      seen.add(key);
      const response = await input.fetchImpl(`${input.api}/${encodeURIComponent(key)}`, { headers });
      const serialized = await readRecoveryResponse(response, Math.min(MAX_OBJECT_BYTES, MAX_TOTAL_BYTES - input.stats.bytes));
      input.stats.objects++;
      input.stats.bytes += serialized.byteLength;
      yield { key, serialized };
    }
    cursor = inventoryCursor(page.result_info);
    if (cursor) {
      if (cursors.has(cursor)) throw new Error("invalid_recovery_cursor");
      cursors.add(cursor);
    }
  } while (cursor);
}

function inventoryObjectKey(object: unknown, prefix: string): string {
  if (!record(object) || typeof object.key !== "string" || !object.key.startsWith(prefix)
    || !/^[a-f0-9]{48}\.artifact\.bin$/.test(object.key.slice(prefix.length))) throw new Error("invalid_recovery_listing");
  return object.key;
}

function inventoryCursor(info: unknown): string | undefined {
  if (!record(info)) throw new Error("invalid_recovery_listing");
  if (info.cursor === undefined || info.cursor === null || info.cursor === "") return undefined;
  if (typeof info.cursor !== "string" || info.cursor.length > 4096) throw new Error("invalid_recovery_cursor");
  return info.cursor;
}

function requireHostedRecoveryBoundary(env: Env): void {
  // Both source and secrets must be admitted by the private protected job.
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== "cobuildwithus/murph-cloud"
    || env.GITHUB_REF !== "refs/heads/main" || env.RECOVERY_PROTECTED_ENVIRONMENT !== "production") {
    throw new Error("hosted_recovery_boundary_required");
  }
}

export async function assessCheckpointRecovery(env: Env, fetchImpl: typeof fetch = fetch) {
  requireHostedRecoveryBoundary(env);
  const privateJwk = required(env, "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK");
  if (env.RECOVERY_MODE === "describe-key") return { schema: "murph.recovery-public-key.v1", publicJwk: recoveryPublicJwk(privateJwk) };
  if (env.RECOVERY_MODE !== "assess") throw new Error("invalid_recovery_mode");
  const request = openRecoveryAssessmentRequest(required(env, "RECOVERY_SEALED_REQUEST"), privateJwk);
  const account = required(env, "CLOUDFLARE_ACCOUNT_ID");
  const bucket = required(env, "CF_BUNDLES_ENAM_BUCKET");
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket)) throw new Error("invalid_recovery_storage");
  const token = required(env, "CLOUDFLARE_API_TOKEN");
  const prefix = `users/${createHostedStorageNamespaceId(request.userId)}/artifacts/`;
  const api = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects`;
  const signal = AbortSignal.timeout(12 * 60_000);
  const boundedFetch: typeof fetch = (url, init) => fetchImpl(url, {
    ...init, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  const callbackSigning = readHostedWebCallbackSigningEnvironment(env);
  async function readWorkspace() {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: "https://www.withmurph.ai", boundUserId: request.userId,
      callbackSigning, method: "GET", path: HOSTED_RUNTIME_WORKSPACE_PATH,
      timeoutMs: 30_000, fetchImpl: boundedFetch,
    });
    const value = parseHostedWorkspaceReadResponse(JSON.parse(Buffer.from(await readRecoveryResponse(response, 1024 * 1024)).toString("utf8")));
    if (!value.workspace || value.workspace.userId !== request.userId
      || value.workspace.version !== request.expectedWorkspaceVersion) throw new Error("recovery_workspace_changed");
    return value.workspace;
  }
  const workspace = await readWorkspace();
  const cryptoEnv: HostedWorkerCryptoEnv = {
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: required(env, "HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION"),
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: required(env, "HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM"),
    HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: env.HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: required(env, "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID"),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: privateJwk,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON: env.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON,
    HOSTED_CRYPTO_ENV: required(env, "HOSTED_CRYPTO_ENV"), NODE_ENV: "production",
  };
  const roots = new Map<string, Uint8Array>();
  const attemptedRoots = new Set<string>();
  const hashes = new Map<string, number>();
  const receipts: ReceiptEvidence[] = [];
  const stats = { objects: 0, bytes: 0 };
  let receiptLogs = 0;
  let authenticated = 0;
  let unreadable = 0;
  try {
    for await (const { key: objectKey, serialized } of readArtifactInventory({ api, prefix, token, fetchImpl: boundedFetch, stats })) {
        let plaintext: Uint8Array | undefined;
        try {
          const envelope = parseHostedCipherEnvelope(JSON.parse(Buffer.from(serialized).toString("utf8")));
          if (envelope.scope !== "artifact") throw new Error("invalid_artifact_scope");
          let root = roots.get(envelope.keyId);
          if (!root) {
            if (attemptedRoots.has(envelope.keyId) || attemptedRoots.size >= MAX_ROOTS) throw new Error("recovery_root_unavailable");
            attemptedRoots.add(envelope.keyId);
            const resolved = await fetchHostedWorkerRuntimeRootByRootKeyId({
              baseUrl: "https://www.withmurph.ai", callbackSigning, cryptoEnv, domain: "runtime",
              rootKeyId: envelope.keyId, userId: request.userId, timeoutMs: 30_000, fetchImpl: boundedFetch,
            });
            root = resolved.rootKey;
            roots.set(envelope.keyId, root);
          }
          const result = await authenticateUnindexedArtifact({ serialized, objectKey, rootKey: root, userId: request.userId });
          plaintext = result.plaintext;
          hashes.set(result.sha256, plaintext.byteLength);
          authenticated++;
          const receipt = inspectReceiptCandidate(plaintext, Date.parse(request.before));
          if (receipt) receipts.push(receipt);
          if (plaintext.byteLength <= 64 * 1024) {
            try {
              const value: unknown = JSON.parse(new TextDecoder().decode(plaintext));
              if (record(value) && value.schema === LOG_SCHEMA) receiptLogs++;
            } catch { /* Non-JSON payloads are ordinary artifact content. */ }
          }
        } catch { unreadable++; }
        finally { plaintext?.fill(0); serialized.fill(0); }
    }
    await readWorkspace();
    const paths = new Set(receipts.flatMap((receipt) => receipt.paths));
    const contents = receipts.flatMap((receipt) => receipt.contents);
    return {
      schema: "murph.checkpoint-recovery-assessment-result.v1", complete: true,
      workspaceUnchanged: true, browserReplicaPresent: workspace.browserVaultReplicaRef != null,
      objects: stats.objects, encryptedBytes: stats.bytes, authenticated, unreadable,
      receiptCandidatesBeforeCutoff: receipts.length, receiptLogCandidates: receiptLogs,
      candidatePaths: paths.size, contentReferences: contents.length,
      presentContentReferences: contents.filter((ref) => hashes.get(ref.sha256) === ref.byteSize).length,
      deleteActions: receipts.reduce((count, receipt) => count + receipt.deletes, 0),
      appendActions: receipts.reduce((count, receipt) => count + receipt.appends, 0),
      acceptedHistoryProven: false, restorationPerformed: false,
    };
  } finally { for (const root of roots.values()) root.fill(0); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await assessCheckpointRecovery(process.env))); }
  catch (error) {
    // Never print caught errors: upstream errors can contain private paths,
    // member identifiers, remote bodies, or key metadata.
    console.error(JSON.stringify({ ok: false, reason: "checkpoint_recovery_assessment_failed",
      ...(error instanceof RecoveryRemoteReadError ? { httpStatus: error.httpStatus } : {}),
    }));
    process.exitCode = 1;
  }
}
