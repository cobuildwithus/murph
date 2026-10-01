import { createHash } from "node:crypto";
import type { HostedBrowserVaultReplicaRef } from "./contracts.ts";
import { parseHostedBrowserVaultReplicaRef } from "./browser-vault.ts";
import { requireObject, requireString } from "./parsers/assertions.ts";
import { parseHostedWorkspaceSnapshotV2Ref } from "./parsers/workspace-snapshot-v2.ts";
import type { HostedWorkspaceSnapshotV2Ref } from "./workspace-snapshot-v2.ts";

export const HOSTED_CHECKPOINT_RECOVERY_PATH = "/api/internal/hosted-workspace/recovery";

export interface HostedCheckpointRecoveryRequest {
  operation: "stage" | "publish";
  expectedWorkspaceVersion: string;
  sourceSnapshotFingerprint: string;
  sourceReplicaFingerprint: string;
  replacement: HostedWorkspaceSnapshotV2Ref;
}

export function fingerprintRecoveryReplica(ref: HostedBrowserVaultReplicaRef): string {
  // Replica publication does not advance workspace.version. Bind the entire
  // normalized reference, including envelope, generation and all child refs.
  return createHash("sha256").update(JSON.stringify(parseHostedBrowserVaultReplicaRef(ref))).digest("hex");
}

export function parseHostedCheckpointRecoveryRequest(value: unknown): HostedCheckpointRecoveryRequest {
  const input = requireObject(value, "Checkpoint recovery request");
  const fields = ["operation", "expectedWorkspaceVersion", "sourceSnapshotFingerprint", "sourceReplicaFingerprint", "replacement"];
  if (Object.keys(input).some((key) => !fields.includes(key))
    || input.operation !== "stage" && input.operation !== "publish") throw new TypeError("Invalid checkpoint recovery operation.");
  const expectedWorkspaceVersion = requireString(input.expectedWorkspaceVersion, "Recovery workspace version");
  const sourceSnapshotFingerprint = requireString(input.sourceSnapshotFingerprint, "Recovery snapshot fingerprint");
  const sourceReplicaFingerprint = requireString(input.sourceReplicaFingerprint, "Recovery replica fingerprint");
  if (!/^(0|[1-9][0-9]{0,18})$/.test(expectedWorkspaceVersion)
    || !/^[a-f0-9]{64}$/.test(sourceSnapshotFingerprint) || !/^[a-f0-9]{64}$/.test(sourceReplicaFingerprint)) {
    throw new TypeError("Invalid checkpoint recovery precondition.");
  }
  return { operation: input.operation, expectedWorkspaceVersion, sourceSnapshotFingerprint, sourceReplicaFingerprint,
    replacement: parseHostedWorkspaceSnapshotV2Ref(input.replacement) };
}
