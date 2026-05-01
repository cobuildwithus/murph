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
    && left.keyId === right.keyId
    && left.objectKey === right.objectKey
    && left.replicaSchema === right.replicaSchema
    && left.schema === right.schema
    && left.sourceBundleHash === right.sourceBundleHash;
}
