import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { HostedRuntimeManagedSnapshotUpload } from "@murphai/hosted-execution/runtime-resources";
import { parseHostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import { buildHostedWorkspaceSnapshotV2Aad, HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { completeManagedSnapshotUpload, prepareManagedSnapshotUpload, verifyManagedSnapshotBytes } from "../src/managed-snapshot-upload.ts";
import type { R2BucketLike } from "../src/bundle-store.ts";
import { completeManagedSnapshotForSession, presignManagedSnapshot } from "../src/managed-snapshot-control.ts";

const resource = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../src/runtime-resource-client.ts", () => ({ commandHostedRuntimeSnapshot: resource.command }));

const bytes = new TextEncoder().encode("synthetic encrypted snapshot bytes");
const encryptedSha256 = createHash("sha256").update(bytes).digest("hex");
const objectKey = "users/synthetic/workspace-snapshots/snapshot-1.snapshot.enc";
const session = parseHostedWorkspaceSnapshotUploadSession({
  schema: "murph.hosted-workspace-snapshot-upload.v1", userId: "synthetic-member", snapshotId: "snapshot-1",
  attemptId: "synthetic-attempt", leaseGeneration: "1", expectedWorkspaceVersion: "0", workspaceVersion: "0", objectKey,
  createdAt: "2026-09-15T00:00:00.000Z", expiresAt: "2026-09-15T01:00:00.000Z",
  encryption: { scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME, rootKeyId: "synthetic-root", ivBase64: "AQIDBAUGBwgJCgsM", wrappedDataKey: "synthetic-wrapped",
    aad: buildHostedWorkspaceSnapshotV2Aad({ objectKey, snapshotId: "snapshot-1", userId: "synthetic-member" }) },
});
const receipt: HostedRuntimeManagedSnapshotUpload = {
  userId: session.userId, snapshotId: session.snapshotId, objectKey, uploadId: "synthetic-upload",
  attemptId: session.attemptId, generation: session.leaseGeneration, encryptedByteSize: bytes.length, encryptedSha256,
  completedAt: null, verifiedAt: null,
};
function harness() {
  const abort = vi.fn(async () => {});
  const complete = vi.fn(async () => undefined);
  const upload = { uploadId: receipt.uploadId, abort, complete, uploadPart: vi.fn(async () => { throw new Error("Bytes must use the part URL."); }) };
  const bucket: R2BucketLike = {
    put: vi.fn(async () => { throw new Error("Direct PUT is forbidden."); }),
    createMultipartUpload: vi.fn(async () => upload), resumeMultipartUpload: vi.fn(() => upload),
    get: vi.fn(async () => ({ size: bytes.length, arrayBuffer: async () => new ArrayBuffer(0),
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 5)); controller.enqueue(bytes.slice(5)); controller.close(); } }) })),
  };
  const settle = vi.fn(async () => true);
  return { bucket, upload, abort, complete, settle };
}

describe("managed snapshot uploads", () => {
  it("connects presigning and trusted completion to the admitted Postgres upload receipt", async () => {
    const h = harness();
    let stored: HostedRuntimeManagedSnapshotUpload | null = null;
    resource.command.mockReset().mockImplementation(async ({ command }) => {
      if (command.operation === "snapshot_managed_admit") {
        stored = { ...receipt, uploadId: command.uploadId };
      } else if (command.operation === "snapshot_managed_settled") {
        if (!stored || command.uploadId !== stored.uploadId) throw new Error("Wrong upload settlement.");
        stored = { ...stored, completedAt: "2026-09-15T00:01:00.000Z", verifiedAt: command.verified ? "2026-09-15T00:01:00.000Z" : null };
      } else if (command.operation !== "snapshot_managed_read") throw new Error("Unexpected resource command.");
      return { cutover: "postgres", applied: true, session, managedUpload: stored };
    });
    const source = { BUNDLES: h.bucket, HOSTED_R2_PRESIGN_ACCOUNT_ID: "synthetic-account",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "synthetic-bucket", HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "synthetic-access", HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "synthetic-secret" };
    const signed = await presignManagedSnapshot({ source, session, encryptedByteSize: bytes.length, encryptedSha256, expiresSeconds: 60 });
    const url = new URL(signed.putUrl);
    expect(url.searchParams.get("uploadId")).toBe(receipt.uploadId);
    expect(url.searchParams.get("partNumber")).toBe("1");
    await expect(completeManagedSnapshotForSession({ source, session, encryptedByteSize: bytes.length, encryptedSha256,
      part: { uploadId: "wrong-upload", etag: "synthetic-etag" } })).rejects.toThrow("does not match");
    expect(h.complete).not.toHaveBeenCalled();
    expect(await completeManagedSnapshotForSession({ source, session, encryptedByteSize: bytes.length, encryptedSha256,
      part: { uploadId: signed.managedUploadId, etag: "synthetic-etag" } })).toBe(encryptedSha256);
    expect(stored).toMatchObject({ completedAt: "2026-09-15T00:01:00.000Z", verifiedAt: "2026-09-15T00:01:00.000Z" });
    expect(h.bucket.get).toHaveBeenCalledWith(objectKey);
  });

  it("records admission before granting access to the upload and aborts only unused retry allocations", async () => {
    const h = harness();
    const admit = vi.fn(async (proposed: HostedRuntimeManagedSnapshotUpload) => ({ ...proposed, uploadId: "existing-upload" }));
    const actual = await prepareManagedSnapshotUpload({ ...h, session, encryptedByteSize: bytes.length, encryptedSha256, admit });
    expect(actual.uploadId).toBe("existing-upload");
    expect(admit).toHaveBeenCalledWith(receipt);
    expect(h.abort).toHaveBeenCalledTimes(1);
    expect(h.upload.uploadPart).not.toHaveBeenCalled();
    expect(h.bucket.put).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
  });

  it("retains an ambiguous admission when abort is unconfirmed", async () => {
    const h = harness();
    h.abort.mockRejectedValueOnce(new Error("synthetic abort lost"));
    await expect(prepareManagedSnapshotUpload({ ...h, session, encryptedByteSize: bytes.length, encryptedSha256,
      admit: async () => { throw new Error("synthetic admission reply lost"); },
    })).rejects.toThrow("admission reply lost");
    expect(h.settle).not.toHaveBeenCalled();
  });

  it("seals and verifies an object after a lost completion response before acknowledging publication", async () => {
    const h = harness();
    h.complete.mockRejectedValueOnce(new Error("synthetic response lost"));
    h.abort.mockRejectedValueOnce(new Error("NoSuchUpload (10024)"));
    await completeManagedSnapshotUpload({ ...h, receipt, etag: '"synthetic-etag"' });
    expect(h.complete).toHaveBeenCalledWith([{ partNumber: 1, etag: "synthetic-etag" }]);
    expect(h.abort).toHaveBeenCalledTimes(1);
    expect(h.settle).toHaveBeenCalledExactlyOnceWith(receipt, true);
    expect(h.bucket.get).toHaveBeenCalledWith(objectKey);
  });

  it("does not discharge a write when both completion and abort remain uncertain", async () => {
    const h = harness();
    h.complete.mockRejectedValueOnce(new Error("synthetic completion lost"));
    h.abort.mockRejectedValue(new Error("synthetic abort unknown"));
    await expect(completeManagedSnapshotUpload({ ...h, receipt, etag: "synthetic-etag" })).rejects.toThrow("abort unknown");
    expect(h.bucket.get).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
  });

  it("rejects substituted bytes even when object size and client metadata agree", async () => {
    const h = harness();
    await expect(completeManagedSnapshotUpload({ ...h, receipt: { ...receipt, encryptedSha256: "a".repeat(64) }, etag: "synthetic-etag" })).rejects.toThrow("SHA-256 verification failed");
    expect(h.settle).toHaveBeenCalledWith(expect.anything(), false);
    expect(h.settle).not.toHaveBeenCalledWith(expect.anything(), true);
  });

  it("cancels an oversized stream instead of buffering or trusting HEAD length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes.length + 1)); }, cancel });
    await expect(verifyManagedSnapshotBytes({ receipt, bucket: { get: async () => ({ size: bytes.length, body, arrayBuffer: async () => { throw new Error("Must stream."); } }) } })).rejects.toThrow("exceeds");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
