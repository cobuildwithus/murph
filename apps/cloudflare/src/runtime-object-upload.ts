import type { R2BucketLike, RuntimeMultipartUpload } from "./bundle-store.ts";
import type { R2PutOptionsLike, R2PutValueLike } from "./crypto.ts";

/** Commit the exact upload ID before any encrypted bytes. Recovery may abort
 * that ID from another Worker after a lost response or activation eviction. */
export async function writeRecoverableRuntimeObject(input: {
  bucket: R2BucketLike; objectKey: string; value: R2PutValueLike; options?: R2PutOptionsLike;
  admit: (uploadId: string) => Promise<boolean>; release: () => Promise<unknown>;
}): Promise<void> {
  if (!input.bucket.createMultipartUpload || !input.bucket.resumeMultipartUpload) throw new Error("Recoverable runtime uploads are not configured.");
  const upload = await input.bucket.createMultipartUpload(input.objectKey, input.options);
  try {
    if (!await input.admit(upload.uploadId)) throw new Error("Runtime upload admission was rejected.");
    const part = await upload.uploadPart(1, input.value);
    await upload.complete([part]);
    await input.release();
  } catch (error) {
    // Neither an unknown abort nor elapsed time proves that a write stopped.
    try { await abortRuntimeMultipartUpload(upload); await input.release(); } catch { /* durable recovery retains the obligation */ }
    throw error;
  }
}
export async function abortRuntimeMultipartUpload(upload: Pick<RuntimeMultipartUpload, "abort">): Promise<void> {
  try { await upload.abort(); }
  catch (error) {
    // Official Workers API NoSuchUpload code, not a generic HTTP 404.
    if (!(error instanceof Error) || !/\(10024\)$/u.test(error.message)) throw error;
  }
}
