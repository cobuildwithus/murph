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
    && canonicalJson(left.dataKeyEnvelope ?? null)
      === canonicalJson(right.dataKeyEnvelope ?? null);
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
