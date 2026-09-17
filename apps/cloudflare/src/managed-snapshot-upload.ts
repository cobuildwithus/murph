import { createHash } from "node:crypto";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import { parseHostedRuntimeManagedSnapshotUpload, type HostedRuntimeManagedSnapshotUpload } from "@murphai/hosted-execution/runtime-resources";
import { HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE, type HostedWorkspaceSnapshotUploadSession } from "@murphai/hosted-execution/workspace-snapshot-store";
import { HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA } from "@murphai/hosted-execution/workspace-snapshot-v2";
import type { R2BucketLike } from "./bundle-store.ts";
import { abortRuntimeMultipartUpload } from "./runtime-object-upload.ts";

type UploadReceipt = HostedRuntimeManagedSnapshotUpload;
type SettleUpload = (upload: UploadReceipt, verified: boolean) => Promise<boolean>;

/** Allocate without bytes, then durably admit before any URL can escape. On
 * retries the owner returns the existing immutable receipt. Aborting the unused
 * allocation cannot affect that receipt or another concurrent upload. */
export async function prepareManagedSnapshotUpload(input: {
  bucket: R2BucketLike; session: HostedWorkspaceSnapshotUploadSession;
  encryptedByteSize: number; encryptedSha256: string;
  admit: (upload: UploadReceipt) => Promise<UploadReceipt | null>; settle: SettleUpload;
}): Promise<UploadReceipt> {
  if (!input.bucket.createMultipartUpload || !input.bucket.resumeMultipartUpload) throw new Error("Managed snapshot uploads are unavailable.");
  const { session } = input;
  // Validate byte and owner fields before allocating an upload.
  const identity = parseHostedRuntimeManagedSnapshotUpload({
    ...input, userId: session.userId, snapshotId: session.snapshotId, objectKey: session.objectKey,
    attemptId: session.attemptId, generation: session.leaseGeneration,
    uploadId: "pending-allocation", completedAt: null, verifiedAt: null,
  });
  const allocated = await input.bucket.createMultipartUpload(session.objectKey, {
    httpMetadata: { contentType: HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE },
    customMetadata: { encryptedsha256: input.encryptedSha256, snapshotid: session.snapshotId,
      schema: HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA, managedupload: "1" },
  });
  const proposed = { ...identity, uploadId: allocated.uploadId };
  try {
    const receipt = await input.admit(proposed);
    if (!receipt) throw new Error("Managed snapshot upload admission was rejected.");
    requireSameSnapshotBytes(proposed, receipt);
    if (receipt.uploadId !== allocated.uploadId) await abortRuntimeMultipartUpload(allocated);
    return receipt;
  } catch (error) {
    // An admission reply can be lost after commit. Record terminal proof only
    // after abort acknowledges this exact ID; otherwise retain recovery work.
    try { await abortRuntimeMultipartUpload(allocated); await input.settle(proposed, false); } catch { /* retain the durable obligation */ }
    throw error;
  }
}

/** Only this trusted completion path records verified bytes. Neither client
 * metadata nor multipart ETags/checksum formats substitute for SHA-256. */
export async function completeManagedSnapshotUpload(input: {
  bucket: R2BucketLike; receipt: UploadReceipt; etag: string; settle: SettleUpload;
}): Promise<void> {
  const receipt = parseHostedRuntimeManagedSnapshotUpload(input.receipt);
  if (!input.bucket.resumeMultipartUpload) throw new Error("Managed snapshot uploads are unavailable.");
  if (!input.etag || input.etag.length > 1024 || /[\r\n]/u.test(input.etag)) throw new TypeError("Managed snapshot part ETag is invalid.");
  const upload = input.bucket.resumeMultipartUpload(receipt.objectKey, receipt.uploadId);
  const timing = { completeElapsedMs: 0, verifyElapsedMs: 0, settleElapsedMs: 0, outcome: "failed" };
  const startedAt = Date.now();
  try {
    if (receipt.completedAt === null) {
      try {
        await upload.complete([{ partNumber: 1, etag: input.etag.replace(/^"|"$/gu, "") }]);
      } catch {
        // Unknown completion might have published the object. An acknowledged
        // abort/NoSuchUpload seals the capability before inspecting the object.
        await abortRuntimeMultipartUpload(upload);
      }
    }
    timing.completeElapsedMs = Date.now() - startedAt;
    await verifyManagedSnapshotBytes({ bucket: input.bucket, receipt });
    timing.verifyElapsedMs = Date.now() - startedAt - timing.completeElapsedMs;
    if (!await input.settle(receipt, true)) throw new Error("Managed snapshot verification receipt was rejected.");
    timing.settleElapsedMs = Date.now() - startedAt - timing.completeElapsedMs - timing.verifyElapsedMs;
    timing.outcome = "verified";
  } catch (error) {
    try { await abortRuntimeMultipartUpload(upload); await input.settle(receipt, false); } catch { /* retain the durable obligation */ }
    throw error;
  } finally {
    // Stage timings make a slow completion attributable without member data.
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: { ...timing, encryptedByteSize: receipt.encryptedByteSize, operation: "managed_snapshot_completion" },
      message: "Managed snapshot completion finished.",
      phase: "wake.running",
      userId: receipt.userId,
    });
  }
}

/** Fits inside the runner's 120-second commit budget with room for multipart
 * completion and settlement; the runner budget, not this deadline, bounds a
 * single checkpoint attempt. */
const MANAGED_SNAPSHOT_VERIFY_TIMEOUT_MS = 100_000;

type SnapshotHasher = { update(chunk: Uint8Array): Promise<void> | void; digestHex(): Promise<string> };

/** Workers expose a native streaming digest; Node tests fall back to node:crypto. */
function createSnapshotHasher(): SnapshotHasher {
  const DigestStream = (globalThis.crypto as { DigestStream?: new (algorithm: string) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> } }).DigestStream;
  if (DigestStream) {
    const stream = new DigestStream("SHA-256");
    const writer = stream.getWriter();
    return {
      update: chunk => writer.write(chunk),
      digestHex: async () => { await writer.close(); return bytesToHex(new Uint8Array(await stream.digest)); },
    };
  }
  const hash = createHash("sha256");
  return { update: chunk => { hash.update(chunk); }, digestHex: async () => hash.digest("hex") };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyManagedSnapshotBytes(input: { bucket: Pick<R2BucketLike, "get">; receipt: UploadReceipt; timeoutMs?: number }): Promise<void> {
  const signal = AbortSignal.timeout(input.timeoutMs ?? MANAGED_SNAPSHOT_VERIFY_TIMEOUT_MS);
  const getting = input.bucket.get(input.receipt.objectKey);
  void getting.then(object => { if (signal.aborted) void object?.body?.cancel().catch(() => {}); }, () => {});
  const object = await awaitSnapshotRead(getting, signal);
  if (!object?.body) throw new Error("Managed snapshot byte verification requires an object stream.");
  const reader = object.body.getReader();
  let ended = false;
  try {
    if (object.size !== input.receipt.encryptedByteSize) throw new Error("Managed snapshot byte length changed.");
    const hasher = createSnapshotHasher();
    let count = 0;
    for (;;) {
      const part = await awaitSnapshotRead(reader.read(), signal);
      if (part.done) { ended = true; break; }
      count += part.value.byteLength;
      if (count > input.receipt.encryptedByteSize) throw new Error("Managed snapshot exceeds its committed byte length.");
      await awaitSnapshotRead(Promise.resolve(hasher.update(part.value)), signal);
    }
    if (count !== input.receipt.encryptedByteSize || await hasher.digestHex() !== input.receipt.encryptedSha256) {
      throw new Error("Managed snapshot encrypted SHA-256 verification failed.");
    }
  } finally {
    if (!ended) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function requireSameSnapshotBytes(expected: UploadReceipt, actual: UploadReceipt): void {
  if (actual.userId !== expected.userId || actual.snapshotId !== expected.snapshotId
    || actual.attemptId !== expected.attemptId || actual.generation !== expected.generation
    || actual.objectKey !== expected.objectKey || actual.encryptedByteSize !== expected.encryptedByteSize
    || actual.encryptedSha256 !== expected.encryptedSha256) throw new Error("Managed snapshot admission changed its byte or owner identity.");
}

/** R2 reads cannot prolong a member handoff indefinitely. Cancellation is
 * best-effort and never grants upload settlement or verified-byte authority. */
function awaitSnapshotRead<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
