import type { R2BucketLike } from "../bundle-store.js";

export function requireR2DeletionCapabilities(bucket: R2BucketLike): {
  delete: NonNullable<R2BucketLike["delete"]>;
  list: NonNullable<R2BucketLike["list"]>;
} {
  if (!bucket.delete || !bucket.list) {
    throw new Error("R2 list and delete support are required for hosted user-data deletion.");
  }
  return {
    delete: bucket.delete.bind(bucket),
    list: bucket.list.bind(bucket),
  };
}

export async function deleteR2ObjectRequired(
  bucket: R2BucketLike,
  key: string,
): Promise<{ deletedCount: number }> {
  const { delete: deleteObject } = requireR2DeletionCapabilities(bucket);
  const existing = await bucket.get(key);
  await deleteObject(key);
  return { deletedCount: existing ? 1 : 0 };
}

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

  let deletedCount = 0;

  for (;;) {
    const page = await bucket.list({ limit: 1_000, prefix });
    const keys = page.objects.map((object) => object.key);
    if (keys.length === 0) {
      return { deletedCount };
    }

    await bucket.delete(keys);
    deletedCount += keys.length;

    if (!page.truncated) {
      return { deletedCount };
    }
  }
}

export async function assertR2PrefixEmpty(
  bucket: R2BucketLike,
  prefix: string,
): Promise<void> {
  const { list } = requireR2DeletionCapabilities(bucket);
  for (let observation = 0; observation < 2; observation += 1) {
    const page = await list({ limit: 1, prefix });
    if (page.objects.length > 0 || page.truncated) {
      throw new Error("R2 prefix is not empty after hosted user-data deletion.");
    }
  }
}

export async function assertR2ObjectAbsent(
  bucket: R2BucketLike,
  key: string,
): Promise<void> {
  requireR2DeletionCapabilities(bucket);
  for (let observation = 0; observation < 2; observation += 1) {
    const existing = bucket.head
      ? await bucket.head(key)
      : await bucket.get(key);
    if (existing) {
      throw new Error("R2 fixed key is still present after hosted user-data deletion.");
    }
  }
}
