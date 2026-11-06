import { buildHostedStorageAad, decryptHostedStoragePayload } from "@murphai/runtime-state";
import { getHostedBrowserVaultReplicaStorageKeyId, HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES } from "@murphai/hosted-execution/browser-vault";
import type { HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/contracts";
import { parseBrowserVaultReplica, type BrowserVaultReplica } from "@murphai/query/browser";
import { createBrowserVaultReplicaAadFields, createHostedBrowserVaultReplicaStore } from "../src/browser-vault-store.ts";

// AES-GCM tag, base64 expansion, and bounded JSON envelope metadata.
export const RECOVERY_REPLICA_ENVELOPE_MAX_BYTES = Math.ceil((HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES + 16) / 3) * 4 + 64 * 1024;

// A published browser copy is a lossy recovery source. Keep its contents inside
// the protected process; only the closed summary may be emitted as diagnostics.
export async function readRecoveryReplica(input: {
  userId: string;
  ref: HostedBrowserVaultReplicaRef;
  before: string;
  rootKey: Uint8Array;
  rootKeyId: string;
  readObject(key: string): Promise<Uint8Array>;
  signal: AbortSignal;
}): Promise<{ replica: BrowserVaultReplica; sourceBytes: Uint8Array }> {
  input.signal.throwIfAborted();
  if (!Number.isFinite(Date.parse(input.before)) || !Number.isFinite(Date.parse(input.ref.generatedAt))
    || Date.parse(input.ref.generatedAt) > Date.parse(input.before)
    || input.ref.byteLength > HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES) throw new Error("recovery_replica_reference_invalid");
  const store = createHostedBrowserVaultReplicaStore({
    userId: input.userId, rootKey: input.rootKey, rootKeyId: input.rootKeyId,
    bucket: {
      async get(key) {
        input.signal.throwIfAborted();
        const bytes = await input.readObject(key);
        return { arrayBuffer: async () => Uint8Array.from(bytes).buffer };
      },
      async put() { throw new Error("recovery_replica_read_only"); },
    },
  });
  const envelope = await store.readBrowserVaultReplicaEnvelope(input.ref);
  if (!envelope) throw new Error("recovery_replica_unavailable");
  const key = await store.deriveBrowserVaultReplicaKey(input.ref);
  let plaintext: Uint8Array | undefined;
  try {
    input.signal.throwIfAborted();
    plaintext = await decryptHostedStoragePayload({
      aad: buildHostedStorageAad({ ...createBrowserVaultReplicaAadFields({ ref: input.ref, userId: input.userId }) }),
      envelope, expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(input.ref), key, scope: "browser-vault-replica",
    });
    input.signal.throwIfAborted();
    if (plaintext.byteLength !== input.ref.byteLength) throw new Error("recovery_replica_size_mismatch");
    const replica = parseBrowserVaultReplica(JSON.parse(new TextDecoder().decode(plaintext)));
    if (replica.generatedAt !== input.ref.generatedAt || replica.source.dataVersion !== input.ref.dataVersion
      || replica.source.sourceBundleHash !== input.ref.sourceBundleHash || replica.generation !== input.ref.generation) {
      throw new Error("recovery_replica_identity_mismatch");
    }
    // The caller owns and clears this copy after preserving the authenticated
    // source. Parsing alone can normalize or omit fields from older formats.
    return { replica, sourceBytes: Uint8Array.from(plaintext) };
  } finally { key.fill(0); plaintext?.fill(0); }
}

const RECOVERY_REPLICA_FAMILIES = new Set([
  "allergy", "assessment", "condition", "event", "experiment", "family", "genetics", "goal", "habitat",
  "journal", "protocol", "regimen", "provider", "sample", "workout_format",
]);

export function summarizeRecoveryReplica(replica: BrowserVaultReplica) {
  const entitiesByFamily: Record<string, number> = {};
  let entitiesWithBodyPreviews = 0;
  let experimentOnboardingCaptures = 0;
  for (const entity of replica.entities) {
    const family = RECOVERY_REPLICA_FAMILIES.has(entity.family) ? entity.family : "other";
    entitiesByFamily[family] = (entitiesByFamily[family] ?? 0) + 1;
    if (entity.bodyPreview) entitiesWithBodyPreviews++;
    if (entity.family === "experiment" && entity.attributes.onboarding !== undefined) experimentOnboardingCaptures++;
  }
  return { entities: replica.entities.length, entitiesByFamily, entitiesWithBodyPreviews, experimentOnboardingCaptures,
    metricRows: replica.metricRows.length, labResultRows: replica.labResultRows.length,
    assistantSummaryHighlights: replica.assistantSummary.highlights.length,
    completeFileBackup: false, restorationPerformed: false };
}
