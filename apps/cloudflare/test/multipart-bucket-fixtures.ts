import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound.ts";
import type { R2PutValueLike } from "../src/crypto.ts";

export function createOutboundMultipartTestBucket(bucket: RunnerOutboundEnvironmentSource["BUNDLES"]): RunnerOutboundEnvironmentSource["BUNDLES"] {
  const uploads = new Map<string, import("../src/bundle-store.ts").RuntimeMultipartUpload>();
  return {
    ...bucket,
    async createMultipartUpload(key, options) {
      const uploadId = `synthetic-upload-${uploads.size + 1}`;
      let pending: R2PutValueLike | undefined;
      const upload = {
        uploadId,
        async uploadPart(partNumber: number, value: R2PutValueLike) {
          pending = value;
          return { partNumber, etag: "synthetic-etag" };
        },
        async complete() {
          if (pending === undefined) throw new Error("Synthetic multipart upload has no part.");
          await bucket.put(key, pending, options);
        },
        async abort() { pending = undefined; },
      };
      uploads.set(uploadId, upload);
      return upload;
    },
    resumeMultipartUpload(_key, uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload) throw new Error("Synthetic multipart upload is missing.");
      return upload;
    },
  };
}
