export const HOSTED_RUNTIME_ORPHAN_RECORD_PATH = "/api/internal/hosted-runtime/orphans";
import { requireObject, requireString } from "./parsers/assertions.ts";
import { isHostedWorkspaceSnapshotV2Ref, parseHostedExecutionSnapshotRef } from "./parsers.ts";
import type { HostedExecutionSnapshotRef } from "./contracts.ts";

export type HostedRuntimeResourcePurge =
  | { kind: "snapshot" | "replica" | "media"; objectKey: string }
  | { kind: "legacy_snapshot"; snapshotRef: NonNullable<HostedExecutionSnapshotRef> };

export function parseHostedRuntimeResourcePurge(value: unknown): HostedRuntimeResourcePurge {
  const record = requireObject(value, "Runtime resource purge");
  if (record.kind === "legacy_snapshot") {
    const snapshotRef = parseHostedExecutionSnapshotRef(record.snapshotRef);
    if (!snapshotRef || isHostedWorkspaceSnapshotV2Ref(snapshotRef)) throw new TypeError("Legacy resource purge requires a bundle reference.");
    return { kind: record.kind, snapshotRef };
  }
  if (record.kind !== "snapshot" && record.kind !== "replica" && record.kind !== "media") throw new TypeError("Runtime resource purge kind is invalid.");
  const objectKey = requireString(record.objectKey, "Runtime resource object key");
  if (objectKey.length > 1024) throw new TypeError("Runtime resource object key is too long.");
  return { kind: record.kind, objectKey };
}

export function parseHostedRuntimeResourcePurgeResponse(value: unknown): { deleted: true } {
  if (requireObject(value, "Runtime resource purge response").deleted !== true) throw new TypeError("Runtime resource deletion was not acknowledged.");
  return { deleted: true };
}
