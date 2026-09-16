import type { R2BucketLike, RuntimeMultipartUpload } from "./bundle-store.ts";
import type { R2PutOptionsLike } from "./crypto.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import { createHostedLocalS3ControlUrl, readHostedR2PresignEnvironment } from "./r2-presigned-url.ts";

/** Local presigned snapshot bytes live in MinIO, not Wrangler's separate R2
 * emulator. Keep every snapshot operation on that same store. Other object
 * classes and all production bindings retain their existing bucket. */
export function workspaceSnapshotBucket(source: Readonly<Record<string, unknown>> & { BUNDLES: R2BucketLike }): R2BucketLike {
  const bucket = source.BUNDLES;
  const env = asWorkerStringEnvironment(source);
  if (env.HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT?.trim() !== "1") return bucket;
  const environment = readHostedR2PresignEnvironment(env);
  const isSnapshot = (key: string) => key.includes("/workspace-snapshots/");
  const request = async (key: string, method: "GET" | "HEAD" | "POST" | "DELETE", query?: Record<string, string>,
    headers?: Record<string, string>, body?: string) => fetch(await createHostedLocalS3ControlUrl({ environment, key, method, query, headers }), {
      method, headers, body, signal: AbortSignal.timeout(30_000),
    });
  const read = async (key: string, method: "GET" | "HEAD") => {
    const response = await request(key, method);
    if (response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Local snapshot ${method} failed with HTTP ${response.status}.`); }
    const customMetadata: Record<string, string> = {};
    response.headers.forEach((value, name) => { if (name.startsWith("x-amz-meta-")) customMetadata[name.slice(11)] = value; });
    return { key, size: Number(response.headers.get("content-length")), customMetadata,
      ...(response.body ? { body: response.body } : {}), arrayBuffer: () => response.arrayBuffer() };
  };
  const multipart = (key: string, uploadId: string): RuntimeMultipartUpload => ({
    uploadId,
    // Native snapshots use the ordinary signed part URL, never a binding PUT.
    uploadPart: async () => { throw new Error("Local snapshots require the presigned part URL."); },
    complete: async parts => {
      const body = `<CompleteMultipartUpload>${parts.map(part => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
      const response = await request(key, "POST", { uploadId }, { "content-type": "application/xml" }, body);
      const text = await response.text();
      if (!response.ok || text.includes("<Error>")) throw new Error(`Local snapshot completion failed with HTTP ${response.status}.`);
    },
    abort: async () => {
      const response = await request(key, "DELETE", { uploadId });
      const text = await response.text();
      if (!response.ok && !(response.status === 404 && text.includes("<Code>NoSuchUpload</Code>"))) {
        throw new Error(`Local snapshot abort failed with HTTP ${response.status}.`);
      }
    },
  });
  return {
    get: key => isSnapshot(key) ? read(key, "GET") : bucket.get(key),
    put: bucket.put.bind(bucket),
    head: key => isSnapshot(key) ? read(key, "HEAD") : bucket.head?.(key) ?? Promise.resolve(null),
    ...(bucket.list ? { list: bucket.list.bind(bucket) } : {}),
    delete: async keys => {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        if (!isSnapshot(key)) { if (!bucket.delete) throw new Error("Object deletion is unavailable."); await bucket.delete(key); continue; }
        const response = await request(key, "DELETE"); await response.body?.cancel();
        if (!response.ok) throw new Error(`Local snapshot deletion failed with HTTP ${response.status}.`);
      }
    },
    createMultipartUpload: async (key, options?: R2PutOptionsLike) => {
      if (!isSnapshot(key)) {
        if (!bucket.createMultipartUpload) throw new Error("Multipart uploads are unavailable.");
        return bucket.createMultipartUpload(key, options);
      }
      const headers: Record<string, string> = { "content-type": options?.httpMetadata?.contentType ?? "application/octet-stream" };
      for (const [name, value] of Object.entries(options?.customMetadata ?? {})) headers[`x-amz-meta-${name}`] = value;
      const response = await request(key, "POST", { uploads: "" }, headers);
      const text = await response.text();
      const uploadId = /<UploadId>([A-Za-z0-9+/=_-]{1,1024})<\/UploadId>/u.exec(text)?.[1];
      if (!response.ok || !uploadId) throw new Error(`Local snapshot allocation failed with HTTP ${response.status}.`);
      return multipart(key, uploadId);
    },
    resumeMultipartUpload: (key, uploadId) => {
      if (isSnapshot(key)) return multipart(key, uploadId);
      if (!bucket.resumeMultipartUpload) throw new Error("Multipart uploads are unavailable.");
      return bucket.resumeMultipartUpload(key, uploadId);
    },
  };
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
