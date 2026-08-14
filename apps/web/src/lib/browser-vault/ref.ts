import { type HostedBrowserVaultReplicaRef } from "@murphai/hosted-execution/browser-vault";

export function browserVaultReplicaRefsMatch(
  left: HostedBrowserVaultReplicaRef | null,
  right: HostedBrowserVaultReplicaRef | null,
): boolean {
  if (!left || !right) {
    return false;
  }

  return left.byteLength === right.byteLength
    && left.dataVersion === right.dataVersion
    && left.generatedAt === right.generatedAt
    && left.generation === right.generation
    && left.keyId === right.keyId
    && left.objectKey === right.objectKey
    && left.replicaSchema === right.replicaSchema
    && left.runtimeRootKeyId === right.runtimeRootKeyId
    && left.schema === right.schema
    && left.sourceBundleHash === right.sourceBundleHash
    && canonicalJson(left.metricBuckets ?? null)
      === canonicalJson(right.metricBuckets ?? null)
    && canonicalJson(left.shards ?? null) === canonicalJson(right.shards ?? null)
    && canonicalJson(left.dataKeyEnvelope ?? null)
      === canonicalJson(right.dataKeyEnvelope ?? null);
}

/**
 * Compatibility check for an older Web/Worker parser that echoed the exact
 * logical replica identity but omitted additive shard metadata.
 */
export function browserVaultReplicaLegacyFieldsMatch(
  left: HostedBrowserVaultReplicaRef | null,
  right: HostedBrowserVaultReplicaRef | null,
): boolean {
  if (!left || !right) {
    return false;
  }

  return browserVaultReplicaRefsMatch(
    { ...left, metricBuckets: undefined, shards: undefined },
    { ...right, metricBuckets: undefined, shards: undefined },
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }

  return value;
}
