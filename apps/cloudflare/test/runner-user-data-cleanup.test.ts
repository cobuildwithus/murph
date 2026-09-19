import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hostedBundleUserPrefix,
  hostedMealPhotoUserPrefix,
  hostedPrivateMediaUserPrefix,
} from "../src/storage-paths.js";

import {
  deleteHostedUserR2DataBeforeStateDeletion,
} from "../src/user-runner/user-data-deletion.js";
import {
  deleteR2ObjectsWithPrefix,
} from "../src/user-runner/r2-delete.js";

import { MemoryEncryptedR2Bucket } from "./test-helpers.js";

const hostedExecutionMocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );

  return {
    ...actual,
    emitHostedExecutionStructuredLog: hostedExecutionMocks.emitHostedExecutionStructuredLog,
  };
});

const USER_ID = "member_cleanup_test";

describe("hosted runner user data cleanup", () => {
  afterEach(() => {
    hostedExecutionMocks.emitHostedExecutionStructuredLog.mockReset();
    vi.restoreAllMocks();
  });

  it("deletes staged meal photos during user erasure", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const prefix = await hostedMealPhotoUserPrefix({ userId: USER_ID });
    const stagedPhotoKey = `${prefix}${"a".repeat(48)}.jpg.enc`;
    const unrelatedKey = "hosted-meal-photos/images/other/photo.jpg.enc";
    await bucket.put(stagedPhotoKey, "encrypted-photo");
    await bucket.put(unrelatedKey, "other-user-photo");

    const result = await deleteHostedUserR2DataBeforeStateDeletion({
      bucket,
      userId: USER_ID,
    });

    expect(result).toMatchObject({
      deletedObjectCount: 1,
      skippedUserScopedPrefixes: false,
      supported: true,
    });
    expect(bucket.objects.has(stagedPhotoKey)).toBe(false);
    expect(bucket.objects.has(unrelatedKey)).toBe(true);
  });

  it("deletes private avatar ingress objects during user erasure", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const prefix = await hostedPrivateMediaUserPrefix({ userId: USER_ID });
    const stagedMediaKey = `${prefix}${"a".repeat(48)}.image.enc`;
    const unrelatedKey =
      `hosted-private-media/images/other/${"b".repeat(48)}.image.enc`;
    await bucket.put(stagedMediaKey, "encrypted-private-media");
    await bucket.put(unrelatedKey, "other-user-private-media");

    const result = await deleteHostedUserR2DataBeforeStateDeletion({
      bucket,
      userId: USER_ID,
    });

    expect(result).toMatchObject({
      deletedObjectCount: 1,
      skippedUserScopedPrefixes: false,
      supported: true,
    });
    expect(bucket.objects.has(stagedMediaKey)).toBe(false);
    expect(bucket.objects.has(unrelatedKey)).toBe(true);
  });

  it("withholds completion when R2 cleanup fails", async () => {
    const prefix = await hostedBundleUserPrefix({ userId: USER_ID });
    const deletedBeforeFailureKey = `${prefix}a.bundle.json`;
    const failedKey = `${prefix}z.bundle.json`;
    const bucket = new FailingDeleteListableR2Bucket(failedKey);
    await bucket.put(deletedBeforeFailureKey, "first");
    await bucket.put(failedKey, "second");

    await expect(deleteHostedUserR2DataBeforeStateDeletion({
      bucket,
      userId: USER_ID,
    })).rejects.toThrow("Hosted runner R2 cleanup failed before user data deletion.");

    expect(bucket.deleted).toEqual([deletedBeforeFailureKey]);
    expect(bucket.objects.has(failedKey)).toBe(true);
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain(failedKey);
    expect(serializedLogs).not.toContain("R2 delete failed for");
  });

  it("withholds completion when R2 listing fails", async () => {
    const bucket = new FailingListableR2Bucket();
    const leakedPrefix = await hostedBundleUserPrefix({ userId: USER_ID });

    await expect(deleteHostedUserR2DataBeforeStateDeletion({
      bucket,
      userId: USER_ID,
    })).rejects.toThrow("Hosted runner R2 cleanup failed before user data deletion.");

    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain(leakedPrefix);
    expect(serializedLogs).not.toContain("R2 list failed for");
  });

  it("rejects a bucket without list support instead of reporting success", async () => {
    const unsupported = new MemoryEncryptedR2Bucket();

    await expect(deleteHostedUserR2DataBeforeStateDeletion({
      bucket: unsupported,
      userId: USER_ID,
    })).rejects.toThrow("Hosted runner R2 cleanup failed");

  });

  it("withholds completion when a late object appears between empty observations", async () => {
    const prefix = await hostedBundleUserPrefix({ userId: USER_ID });
    const lateKey = `${prefix}late.bundle.json`;
    const bucket = new LateWriteListableR2Bucket(prefix, lateKey);

    await expect(deleteHostedUserR2DataBeforeStateDeletion({
      bucket,
      userId: USER_ID,
    })).rejects.toThrow("Hosted runner R2 cleanup failed");

    expect(bucket.objects.has(lateKey)).toBe(true);
  });

  it("bulk-deletes every listed R2 prefix page without cursor skips", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const prefix = await hostedBundleUserPrefix({ userId: USER_ID });
    for (let index = 0; index < 1_001; index += 1) {
      await bucket.put(`${prefix}${String(index).padStart(4, "0")}.bundle.json`, "data");
    }

    await expect(deleteR2ObjectsWithPrefix(bucket, prefix)).resolves.toEqual({
      deletedCount: 1_001,
    });

    expect(bucket.deleteBatches.map((batch) => batch.length)).toEqual([1_000, 1]);
    expect(bucket.objects.size).toBe(0);
  });

});

class ListableMemoryEncryptedR2Bucket extends MemoryEncryptedR2Bucket {
  readonly deleteBatches: string[][] = [];
  readonly listCalls: string[] = [];

  override async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    this.deleteBatches.push(keys);
    await super.delete(keys);
  }

  async list(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }> {
    this.listCalls.push(input.prefix ?? "");
    const matchingKeys = [...this.objects.keys()]
      .filter((key) => input.prefix ? key.startsWith(input.prefix) : true)
      .sort();
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const limit = input.limit ?? 1_000;
    const pageKeys = matchingKeys.slice(offset, offset + limit);
    const nextOffset = offset + pageKeys.length;
    const truncated = nextOffset < matchingKeys.length;

    return {
      ...(truncated ? { cursor: String(nextOffset) } : {}),
      objects: pageKeys.map((key) => ({ key })),
      truncated,
    };
  }
}

class FailingDeleteListableR2Bucket extends ListableMemoryEncryptedR2Bucket {
  constructor(private readonly failedKey: string) {
    super();
  }

  override async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const item of keys) {
      if (item === this.failedKey) {
        throw new Error(`R2 delete failed for ${item}`);
      }
      await super.delete(item);
    }
  }
}

class LateWriteListableR2Bucket extends ListableMemoryEncryptedR2Bucket {
  private targetPrefixListCount = 0;

  constructor(
    private readonly targetPrefix: string,
    private readonly lateKey: string,
  ) {
    super();
  }

  override async list(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }> {
    const result = await super.list(input);
    if (input.prefix === this.targetPrefix) {
      this.targetPrefixListCount += 1;
      if (this.targetPrefixListCount === 2) {
        await this.put(this.lateKey, "late");
      }
    }
    return result;
  }
}

class FailingListableR2Bucket extends ListableMemoryEncryptedR2Bucket {
  override async list(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }> {
    throw new Error(`R2 list failed for ${input.prefix ?? "<none>"}`);
  }
}
