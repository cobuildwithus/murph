import { workspaceSnapshotBucket } from "./workspace-snapshot-local-s3.ts";
import type { HostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import { HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE } from "@murphai/hosted-execution/workspace-snapshot-store";
import type { HostedRuntimeManagedSnapshotUpload } from "@murphai/hosted-execution/runtime-resources";
import { completeManagedSnapshotUpload, prepareManagedSnapshotUpload } from "./managed-snapshot-upload.ts";
import { commandHostedRuntimeSnapshot } from "./runtime-resource-client.ts";
import { createHostedR2PresignedSnapshotPartUrl, readHostedR2PresignEnvironment } from "./r2-presigned-url.ts";
import { asWorkerStringEnvironment, type WorkerEnvironmentContract } from "./worker-contracts.ts";

type SnapshotSource = Readonly<Record<string, unknown>> & Pick<WorkerEnvironmentContract, "BUNDLES">;

export class ManagedSnapshotCompletionRejectedError extends Error {
  constructor() {
    super("Hosted workspace snapshot completion does not match its admitted bytes.");
  }
}

export async function presignManagedSnapshot(input: {
  source: SnapshotSource; session: HostedWorkspaceSnapshotUploadSession;
  encryptedByteSize: number; encryptedSha256: string; encryptedMd5?: string; expiresSeconds: number;
}) {
  const receipt = await prepareManagedSnapshotUpload({
    bucket: workspaceSnapshotBucket(input.source), session: input.session,
    encryptedByteSize: input.encryptedByteSize, encryptedSha256: input.encryptedSha256, encryptedMd5: input.encryptedMd5,
    admit: async proposed => {
      const result = await commandHostedRuntimeSnapshot({ source: input.source, userId: input.session.userId, command: {
        operation: "snapshot_managed_admit", expectedSession: input.session, uploadId: proposed.uploadId,
        encryptedByteSize: proposed.encryptedByteSize, encryptedSha256: proposed.encryptedSha256,
        ...(proposed.encryptedMd5 === undefined ? {} : { encryptedMd5: proposed.encryptedMd5 }),
      } });
      return result.applied ? result.managedUpload ?? null : null;
    },
    settle: (receipt, verified) => settle(input.source, receipt, verified),
  });
  if (receipt.completedAt !== null) throw new Error("Managed snapshot upload is terminal; start a fresh snapshot session.");
  const signed = await createHostedR2PresignedSnapshotPartUrl({
    environment: readHostedR2PresignEnvironment(asWorkerStringEnvironment(input.source)),
    key: receipt.objectKey, uploadId: receipt.uploadId, encryptedByteSize: receipt.encryptedByteSize,
    contentType: HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE, expiresSeconds: input.expiresSeconds,
  });
  return { putUrl: signed.url, expiresAt: signed.expiresAt, managedUploadId: receipt.uploadId };
}

export async function completeManagedSnapshotForSession(input: {
  source: SnapshotSource; session: HostedWorkspaceSnapshotUploadSession; part: unknown;
  receipt: HostedRuntimeManagedSnapshotUpload | null;
  encryptedByteSize: number; encryptedSha256: string;
}): Promise<string> {
  const { uploadId, etag } = parseManagedPart(input.part);
  const receipt = input.receipt;
  if (!receipt || receipt.uploadId !== uploadId || receipt.objectKey !== input.session.objectKey
    || receipt.userId !== input.session.userId || receipt.snapshotId !== input.session.snapshotId
    || receipt.attemptId !== input.session.attemptId || receipt.generation !== input.session.leaseGeneration
    || receipt.encryptedByteSize !== input.encryptedByteSize || receipt.encryptedSha256 !== input.encryptedSha256) {
    throw new ManagedSnapshotCompletionRejectedError();
  }
  await completeManagedSnapshotUpload({ bucket: workspaceSnapshotBucket(input.source), receipt, etag,
    settle: (receipt, verified) => settle(input.source, receipt, verified) });
  return receipt.encryptedSha256;
}

function parseManagedPart(part: unknown): { uploadId: string; etag: string } {
  if (!part || typeof part !== "object" || !("uploadId" in part) || !("etag" in part)
    || typeof part.uploadId !== "string" || !part.uploadId || part.uploadId.length > 1024
    || typeof part.etag !== "string" || !part.etag || part.etag.length > 1024) throw new TypeError("Managed snapshot part is invalid.");
  return { uploadId: part.uploadId, etag: part.etag };
}

async function settle(source: SnapshotSource, receipt: HostedRuntimeManagedSnapshotUpload, verified: boolean): Promise<boolean> {
  const result = await commandHostedRuntimeSnapshot({ source, userId: receipt.userId, command: {
    operation: "snapshot_managed_settled", snapshotId: receipt.snapshotId, uploadId: receipt.uploadId,
    attemptId: receipt.attemptId, generation: receipt.generation, verified,
  } });
  return result.applied;
}
