import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceSnapshotBucket } from "../src/workspace-snapshot-local-s3.ts";
import { completeManagedSnapshotUpload, expectedManagedSnapshotEtag } from "../src/managed-snapshot-upload.ts";
import { createHostedR2PresignedSnapshotPartUrl, readHostedR2PresignEnvironment } from "../src/r2-presigned-url.ts";

const key = "users/synthetic/workspace-snapshots/synthetic.snapshot.enc";
const env = {
  HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "synthetic-access", HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "synthetic-secret",
  HOSTED_R2_PRESIGN_ACCOUNT_ID: "synthetic-account", HOSTED_R2_PRESIGN_BUCKET_NAME: "synthetic-bucket",
  HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:9000", HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:9000",
  HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1", MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
};
function fixture() {
  return { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined), createMultipartUpload: vi.fn(), resumeMultipartUpload: vi.fn() };
}
afterEach(() => vi.unstubAllGlobals());

describe("local snapshot storage boundary", () => {
  it("preserves the exact production bucket and rejects a production local-mode override", () => {
    const BUNDLES = fixture();
    expect(workspaceSnapshotBucket({ BUNDLES })).toBe(BUNDLES);
    expect(() => workspaceSnapshotBucket({ ...env, BUNDLES, NODE_ENV: "production" })).toThrow();
  });

  it("uses one S3 store for allocation, signed part, completion, stream verification and deletion", async () => {
    const BUNDLES = fixture();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("<InitiateMultipartUploadResult><UploadId>synthetic-upload</UploadId></InitiateMultipartUploadResult>"))
      .mockResolvedValueOnce(new Response("<CompleteMultipartUploadResult/>"))
      .mockResolvedValueOnce(new Response("abc", { headers: { "content-length": "3", "x-amz-meta-managedupload": "1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    const bucket = workspaceSnapshotBucket({ ...env, BUNDLES });
    const upload = await bucket.createMultipartUpload!(key, { customMetadata: { managedupload: "1" } });
    const part = new URL((await createHostedR2PresignedSnapshotPartUrl({ environment: readHostedR2PresignEnvironment(env),
      key, uploadId: upload.uploadId, contentType: "application/octet-stream", encryptedByteSize: 3 })).url);
    expect(part.searchParams.get("uploadId")).toBe("synthetic-upload");
    await upload.complete([{ partNumber: 1, etag: '"synthetic-etag"' }]);
    const object = await bucket.get(key);
    expect(object).toMatchObject({ size: 3, customMetadata: { managedupload: "1" } });
    expect(await new Response(object!.body).text()).toBe("abc");
    await bucket.delete!(key);
    const calls = fetcher.mock.calls.map(([url, options]) => ({ url: new URL(url), options }));
    expect(calls.map(call => call.options.method)).toEqual(["POST", "POST", "GET", "DELETE"]);
    for (const call of calls) {
      expect(call.url.origin).toBe(env.HOSTED_R2_PRESIGN_CONTROL_ENDPOINT);
      expect(call.url.pathname).toBe(part.pathname);
    }
    expect(calls[0]!.url.searchParams.has("uploads")).toBe(true);
    expect(calls[1]!.url.searchParams.get("uploadId")).toBe(upload.uploadId);
    expect(calls[1]!.options.body).toContain("&quot;synthetic-etag&quot;");
    expect(BUNDLES.createMultipartUpload).not.toHaveBeenCalled();
    expect(BUNDLES.get).not.toHaveBeenCalled();
    expect(BUNDLES.delete).not.toHaveBeenCalled();
    await bucket.get("users/synthetic/media/image");
    expect(BUNDLES.get).toHaveBeenCalledWith("users/synthetic/media/image");
  });

  it("verifies a managed receipt through the store's ETag without reading the object back", async () => {
    const bytes = new TextEncoder().encode("abc");
    const encryptedMd5 = createHash("md5").update(bytes).digest("hex");
    const encryptedSha256 = createHash("sha256").update(bytes).digest("hex");
    const receipt = { userId: "synthetic", snapshotId: "synthetic", objectKey: key, uploadId: "synthetic-upload", attemptId: "synthetic-attempt",
      generation: "1", encryptedByteSize: 3, encryptedSha256, encryptedMd5, completedAt: null, verifiedAt: null };
    const headResponse = (etag: string) => new Response(null, { headers: { "content-length": "3", "x-amz-meta-encryptedsha256": encryptedSha256, etag: `"${etag}"` } });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("<CompleteMultipartUploadResult/>"))
      .mockResolvedValueOnce(headResponse(expectedManagedSnapshotEtag(encryptedMd5)))
      .mockResolvedValueOnce(new Response("<CompleteMultipartUploadResult/>"))
      .mockResolvedValueOnce(headResponse(`${"0".repeat(32)}-1`))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    const bucket = workspaceSnapshotBucket({ ...env, BUNDLES: fixture() });
    const settle = vi.fn(async () => true);
    await completeManagedSnapshotUpload({ bucket, receipt, etag: "part", settle });
    expect(settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ encryptedMd5 }), true);
    await expect(completeManagedSnapshotUpload({ bucket, receipt, etag: "part", settle })).rejects.toThrow("ETag verification failed");
    expect(settle).toHaveBeenLastCalledWith(expect.anything(), false);
    expect(fetcher.mock.calls.map(([, options]) => options.method)).toEqual(["POST", "HEAD", "POST", "HEAD", "DELETE"]);
  });

  it("retains uncertain aborts and rejects completion errors inside HTTP 200", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("<Error><Code>InvalidPart</Code></Error>"))
      .mockResolvedValueOnce(new Response("<Error><Code>AccessDenied</Code></Error>", { status: 404 }))
      .mockResolvedValueOnce(new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    const upload = workspaceSnapshotBucket({ ...env, BUNDLES: fixture() }).resumeMultipartUpload!(key, "synthetic-upload");
    await expect(upload.complete([{ partNumber: 1, etag: "part" }])).rejects.toThrow("completion failed");
    await expect(upload.abort()).rejects.toThrow("abort failed");
    await expect(upload.abort()).resolves.toBeUndefined();
  });
});
