import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseHostedRuntimeManagedSnapshotUpload, type HostedRuntimeManagedSnapshotUpload } from "@murphai/hosted-execution/runtime-resources";
import { parseHostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import { buildHostedWorkspaceSnapshotV2Aad, HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { completeManagedSnapshotUpload, expectedManagedSnapshotEtag, prepareManagedSnapshotUpload, verifyManagedSnapshotBytes, verifyManagedSnapshotEtag } from "../src/managed-snapshot-upload.ts";
import type { R2BucketLike } from "../src/bundle-store.ts";
import { completeManagedSnapshotForSession, ManagedSnapshotCompletionRejectedError, presignManagedSnapshot } from "../src/managed-snapshot-control.ts";

const resource = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../src/runtime-resource-client.ts", () => ({ commandHostedRuntimeSnapshot: resource.command }));

const bytes = new TextEncoder().encode("synthetic encrypted snapshot bytes");
const encryptedSha256 = createHash("sha256").update(bytes).digest("hex");
const encryptedMd5 = createHash("md5").update(bytes).digest("hex");
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
    get: vi.fn(async () => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 5)); controller.enqueue(bytes.slice(5)); controller.close(); } }) })),
  };
  const settle = vi.fn(async () => true);
  return { bucket, upload, abort, complete, settle };
}

describe("managed snapshot uploads", () => {
  it.each([undefined, "false", "true"])("uses canonical managed uploads regardless of the retired capability (%s)", async capability => {
    const h = harness();
    let stored: HostedRuntimeManagedSnapshotUpload | null = null;
    const commandOwner = vi.fn(async ({ command }: { command: import("@murphai/hosted-execution/runtime-resources").HostedRuntimeManagedSnapshotCommand }) => {
      if (command.operation === "snapshot_managed_admit") {
        stored = { ...receipt, uploadId: command.uploadId };
      } else if (command.operation === "snapshot_managed_settled") {
        if (!stored || command.uploadId !== stored.uploadId) throw new Error("Wrong upload settlement.");
        stored = { ...stored, completedAt: "2026-09-15T00:01:00.000Z", verifiedAt: command.verified ? "2026-09-15T00:01:00.000Z" : null };
      } else if (command.operation !== "snapshot_managed_read") throw new Error("Unexpected resource command.");
      return { cutover: "postgres" as const, applied: true, session, managedUpload: stored };
    });
    resource.command.mockReset().mockImplementation(commandOwner);
    const source = { BUNDLES: h.bucket, HOSTED_RUNTIME_POSTGRES_ENABLED: capability,
      USER_RUNNER: { getByName() { throw new Error("Canonical upload must not access legacy state."); } }, HOSTED_R2_PRESIGN_ACCOUNT_ID: "synthetic-account",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "synthetic-bucket", HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "synthetic-access", HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "synthetic-secret" };
    const signed = await presignManagedSnapshot({ source, session, encryptedByteSize: bytes.length, encryptedSha256, expiresSeconds: 60 });
    const url = new URL(signed.putUrl);
    expect(url.searchParams.get("uploadId")).toBe(receipt.uploadId);
    expect(url.searchParams.get("partNumber")).toBe("1");
    await expect(completeManagedSnapshotForSession({ source, session, receipt: stored, encryptedByteSize: bytes.length, encryptedSha256,
      part: { uploadId: "wrong-upload", etag: "synthetic-etag" } })).rejects.toBeInstanceOf(ManagedSnapshotCompletionRejectedError);
    expect(h.complete).not.toHaveBeenCalled();
    expect(await completeManagedSnapshotForSession({ source, session, receipt: stored, encryptedByteSize: bytes.length, encryptedSha256,
      part: { uploadId: signed.managedUploadId, etag: "synthetic-etag" } })).toBe(encryptedSha256);
    expect(stored).toMatchObject({ completedAt: "2026-09-15T00:01:00.000Z", verifiedAt: "2026-09-15T00:01:00.000Z" });
    expect(h.bucket.get).toHaveBeenCalledWith(objectKey);
  });

  it.each([
    { uploadId: "other-upload" },
    { userId: "other-member" },
    { snapshotId: "other-snapshot" },
    { objectKey: "other-object" },
    { attemptId: "other-attempt" },
    { generation: "2" },
    { encryptedByteSize: bytes.length + 1 },
    { encryptedSha256: "b".repeat(64) },
  ])("rejects changed managed completion identity before storage or settlement: %j", async changed => {
    const h = harness();
    resource.command.mockReset().mockResolvedValue({
      cutover: "postgres", applied: true, managedUpload: { ...receipt, ...changed },
    });
    await expect(completeManagedSnapshotForSession({
      source: { BUNDLES: h.bucket }, session, receipt: { ...receipt, ...changed }, encryptedByteSize: bytes.length, encryptedSha256,
      part: { uploadId: receipt.uploadId, etag: "synthetic-etag" },
    })).rejects.toBeInstanceOf(ManagedSnapshotCompletionRejectedError);
    expect(h.bucket.resumeMultipartUpload).not.toHaveBeenCalled();
    expect(h.bucket.get).not.toHaveBeenCalled();
    expect(resource.command).not.toHaveBeenCalled();
  });

  it("preserves settlement failures instead of classifying them as a completion conflict", async () => {
    const h = harness();
    const failure = new Error("Resource transport unavailable.");
    resource.command.mockReset().mockRejectedValue(failure);
    await expect(completeManagedSnapshotForSession({
      source: { BUNDLES: h.bucket }, session, receipt, encryptedByteSize: bytes.length, encryptedSha256,
      part: { uploadId: receipt.uploadId, etag: "synthetic-etag" },
    })).rejects.toBe(failure);
    expect(h.bucket.resumeMultipartUpload).toHaveBeenCalledOnce();
  });

  it("hashes through the platform digest stream when the runtime provides one", async () => {
    const { createHash } = await import("node:crypto");
    class SyntheticDigestStream extends WritableStream<Uint8Array> {
      readonly digest: Promise<ArrayBuffer>;
      constructor(algorithm: string) {
        expect(algorithm).toBe("SHA-256");
        const hash = createHash("sha256");
        let settle!: (value: ArrayBuffer) => void;
        const digest = new Promise<ArrayBuffer>(resolve => { settle = resolve; });
        super({ write: chunk => { hash.update(chunk); }, close: () => { settle(hash.digest().buffer as ArrayBuffer); } });
        this.digest = digest;
      }
    }
    const used = vi.fn();
    Object.defineProperty(globalThis.crypto, "DigestStream", { configurable: true, value: class extends SyntheticDigestStream { constructor(algorithm: string) { used(); super(algorithm); } } });
    try {
      const h = harness();
      await verifyManagedSnapshotBytes({ bucket: h.bucket, receipt });
      expect(used).toHaveBeenCalledOnce();
      await expect(verifyManagedSnapshotBytes({ bucket: h.bucket, receipt: { ...receipt, encryptedSha256: "b".repeat(64) } })).rejects.toThrow("SHA-256 verification failed");
    } finally {
      delete (globalThis.crypto as { DigestStream?: unknown }).DigestStream;
    }
  });

  it("verifies a receipt admitted with an MD5 through the object ETag and never reads the body", async () => {
    const h = harness();
    const read = vi.fn(async () => { throw new Error("Must not read the body."); });
    const head = vi.fn(async () => ({ size: bytes.length, customMetadata: { encryptedsha256: encryptedSha256, snapshotid: session.snapshotId },
      etag: `"${expectedManagedSnapshotEtag(encryptedMd5)}"` }));
    h.bucket.get = vi.fn(async () => ({ size: bytes.length, arrayBuffer: read, body: new ReadableStream<Uint8Array>() }));
    h.bucket.head = head;
    await completeManagedSnapshotUpload({ ...h, receipt: { ...receipt, encryptedMd5 }, etag: "synthetic-etag" });
    expect(head).toHaveBeenCalledExactlyOnceWith(objectKey);
    expect(h.bucket.get).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(h.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ encryptedMd5 }), true);
    // R2 derives a multipart object's ETag from the MD5 digests of its parts.
    const digest = createHash("md5").update(bytes).digest();
    expect(expectedManagedSnapshotEtag(encryptedMd5)).toBe(`${createHash("md5").update(digest).digest("hex")}-1`);
  });

  it("rejects ETag, size, metadata or missing-object mismatches without publication", async () => {
    const h = harness();
    const withMd5 = { ...receipt, encryptedMd5 };
    for (const [label, object] of [
      ["etag", { size: bytes.length, customMetadata: { encryptedsha256: encryptedSha256 }, etag: `${"0".repeat(32)}-1` }],
      ["length", { size: bytes.length + 1, customMetadata: { encryptedsha256: encryptedSha256 }, etag: expectedManagedSnapshotEtag(encryptedMd5) }],
      ["metadata", { size: bytes.length, customMetadata: { encryptedsha256: "b".repeat(64) }, etag: expectedManagedSnapshotEtag(encryptedMd5) }],
      ["missing", null],
    ] as const) {
      h.settle.mockClear();
      h.bucket.head = vi.fn(async () => object);
      await expect(completeManagedSnapshotUpload({ ...h, receipt: withMd5, etag: "synthetic-etag" }), label).rejects.toThrow();
      expect(h.settle, label).toHaveBeenCalledWith(expect.anything(), false);
      expect(h.settle, label).not.toHaveBeenCalledWith(expect.anything(), true);
    }
    await expect(verifyManagedSnapshotEtag({ bucket: {}, receipt: withMd5 })).rejects.toThrow("unavailable");
    expect(h.bucket.get).not.toHaveBeenCalled();
  });

  it("keeps the read-back for receipts admitted without an MD5 and binds a declared MD5 at admission", async () => {
    const h = harness();
    h.bucket.head = vi.fn(async () => { throw new Error("Must not head a receipt without an MD5."); });
    await completeManagedSnapshotUpload({ ...h, receipt, etag: "synthetic-etag" });
    expect(h.bucket.get).toHaveBeenCalledWith(objectKey);
    expect(h.settle).toHaveBeenCalledExactlyOnceWith(expect.anything(), true);
    const admit = vi.fn(async (proposed: HostedRuntimeManagedSnapshotUpload) => proposed);
    const admitted = await prepareManagedSnapshotUpload({ ...h, session, encryptedByteSize: bytes.length, encryptedSha256, encryptedMd5, admit });
    expect(admitted.encryptedMd5).toBe(encryptedMd5);
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ encryptedMd5 }));
    // An existing receipt admitted before the runner declared MD5s stays authoritative.
    const legacy = vi.fn(async (proposed: HostedRuntimeManagedSnapshotUpload) => { const { encryptedMd5: _omitted, ...rest } = proposed; return rest; });
    expect((await prepareManagedSnapshotUpload({ ...h, session, encryptedByteSize: bytes.length, encryptedSha256, encryptedMd5, admit: legacy })).encryptedMd5).toBeUndefined();
    const changed = vi.fn(async (proposed: HostedRuntimeManagedSnapshotUpload) => ({ ...proposed, encryptedMd5: "f".repeat(32) }));
    await expect(prepareManagedSnapshotUpload({ ...h, session, encryptedByteSize: bytes.length, encryptedSha256, encryptedMd5, admit: changed })).rejects.toThrow("changed its byte or owner identity");
    expect(() => parseHostedRuntimeManagedSnapshotUpload({ ...receipt, encryptedMd5: "not-hex" })).toThrow("MD5 is invalid");
    expect(parseHostedRuntimeManagedSnapshotUpload({ ...receipt, encryptedMd5: undefined }).encryptedMd5).toBeUndefined();
  });

  it("bounds a stalled verification stream without recording success", async () => {
    const h = harness();
    const cancel = vi.fn();
    const huge = 65 * 1024 * 1024;
    h.bucket.get = vi.fn(async () => ({ size: huge, arrayBuffer: async () => { throw new Error("Must stream above the buffered cap."); },
      body: new ReadableStream<Uint8Array>({ cancel }) }));
    await expect(verifyManagedSnapshotBytes({ bucket: h.bucket, receipt: { ...receipt, encryptedByteSize: huge }, timeoutMs: 10 })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(h.settle).not.toHaveBeenCalled();
  });

  it("reads a small object in one call and still rejects a length or digest mismatch", async () => {
    const h = harness();
    const read = vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const cancel = vi.fn();
    h.bucket.get = vi.fn(async () => ({ size: bytes.length, arrayBuffer: read, body: new ReadableStream<Uint8Array>({ cancel }) }));
    await verifyManagedSnapshotBytes({ bucket: h.bucket, receipt });
    expect(read).toHaveBeenCalledOnce();
    await expect(verifyManagedSnapshotBytes({ bucket: h.bucket, receipt: { ...receipt, encryptedSha256: "c".repeat(64) } })).rejects.toThrow("SHA-256 verification failed");
    h.bucket.get = vi.fn(async () => ({ size: bytes.length + 1, arrayBuffer: read, body: new ReadableStream<Uint8Array>({ cancel }) }));
    await expect(verifyManagedSnapshotBytes({ bucket: h.bucket, receipt })).rejects.toThrow("byte length changed");
    expect(cancel).toHaveBeenCalledOnce();
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

  it("cancels an oversized stream above the buffered cap instead of trusting HEAD length", async () => {
    const cancel = vi.fn();
    const huge = 65 * 1024 * 1024;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(huge + 1)); }, cancel });
    await expect(verifyManagedSnapshotBytes({ receipt: { ...receipt, encryptedByteSize: huge }, bucket: { get: async () => ({ size: huge, body, arrayBuffer: async () => { throw new Error("Must stream."); } }) } })).rejects.toThrow("exceeds");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
