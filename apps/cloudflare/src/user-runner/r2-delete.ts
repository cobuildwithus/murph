import type { R2BucketLike } from "../bundle-store.js";

export async function deleteR2ObjectIfSupported(
  bucket: R2BucketLike,
  key: string,
): Promise<{ deleted: boolean; deletedCount: number }> {
  if (!bucket.delete) {
    return { deleted: false, deletedCount: 0 };
  }

  const existingObject = await bucket.get(key);
  if (!existingObject) {
    return { deleted: false, deletedCount: 0 };
  }

  await bucket.delete(key);
  return { deleted: true, deletedCount: 1 };
}

export async function deleteR2ObjectsWithPrefix(
  bucket: R2BucketLike,
  prefix: string,
): Promise<{ deletedCount: number }> {
  if (!bucket.delete || !bucket.list) {
    return { deletedCount: 0 };
  }

  let cursor: string | undefined;
  let deletedCount = 0;

  do {
    const page = await bucket.list({ cursor, limit: 1_000, prefix });
    for (const object of page.objects) {
      await bucket.delete(object.key);
      deletedCount += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { deletedCount };
}
