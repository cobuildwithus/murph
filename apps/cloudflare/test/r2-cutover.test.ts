import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { R2BucketLike } from "../src/bundle-store.ts";
import {
  createHostedR2WriteAdmissionPausedResponse,
  isHostedR2PausedCanaryUser,
  locateHostedR2ObjectBucketRole,
  readHostedR2PausedCanaryConfigured,
  readHostedR2WriteAdmission,
  resolveHostedR2CutoverContext,
} from "../src/r2-cutover.ts";

const storedObject = { size: 1 } as never;
type TestR2Object = typeof storedObject;

function createBucket(input: {
  get?: (key: string) => Promise<TestR2Object | null>;
  head?: (key: string) => Promise<TestR2Object | null>;
  name: string;
  operations: string[];
}): R2BucketLike {
  return {
    delete: async (key: string | string[]) => {
      input.operations.push(`${input.name}:delete:${Array.isArray(key) ? key.join(",") : key}`);
    },
    get: input.get ?? (async (key) => {
      input.operations.push(`${input.name}:get:${key}`);
      return null;
    }),
    head: input.head ?? (async (key) => {
      input.operations.push(`${input.name}:head:${key}`);
      return null;
    }),
    list: async ({ prefix }: { prefix?: string }) => {
      input.operations.push(`${input.name}:list:${prefix ?? ""}`);
      return { objects: [], truncated: false };
    },
    put: async (key: string) => {
      input.operations.push(`${input.name}:put:${key}`);
    },
  } as unknown as R2BucketLike;
}

describe("R2 OC to ENAM cutover bucket", () => {
  it("defaults write admission open, accepts the pause, and rejects unknown values", () => {
    expect(readHostedR2WriteAdmission({})).toBe("open");
    expect(readHostedR2WriteAdmission({
      HOSTED_R2_WRITE_ADMISSION: " paused ",
    })).toBe("paused");
    expect(() => readHostedR2WriteAdmission({
      HOSTED_R2_WRITE_ADMISSION: "closed",
    })).toThrow("HOSTED_R2_WRITE_ADMISSION must be open or paused");
  });

  it("returns a bounded retry while write admission is paused", () => {
    expect(createHostedR2WriteAdmissionPausedResponse(
      Date.parse("2026-08-04T03:00:00.000Z"),
    )).toEqual({
      kind: "retry_later",
      retryAt: "2026-08-04T03:01:00.000Z",
    });
  });

  it("admits only the configured hashed canary after destination promotion", async () => {
    const canaryUserId = "member_canary";
    const canarySha256 = createHash("sha256").update(canaryUserId).digest("hex");
    const destinationPaused = {
      HOSTED_R2_CUTOVER_PHASE: "destination_active",
      HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256: canarySha256,
      HOSTED_R2_WRITE_ADMISSION: "paused",
    };

    expect(readHostedR2PausedCanaryConfigured(destinationPaused)).toBe(true);
    await expect(isHostedR2PausedCanaryUser(
      destinationPaused,
      canaryUserId,
    )).resolves.toBe(true);
    await expect(isHostedR2PausedCanaryUser(
      destinationPaused,
      "member_other",
    )).resolves.toBe(false);
    await expect(isHostedR2PausedCanaryUser({
      ...destinationPaused,
      HOSTED_R2_CUTOVER_PHASE: "source_active",
    }, canaryUserId)).resolves.toBe(false);
    await expect(isHostedR2PausedCanaryUser({
      ...destinationPaused,
      HOSTED_R2_WRITE_ADMISSION: "open",
    }, canaryUserId)).resolves.toBe(false);
    expect(() => readHostedR2PausedCanaryConfigured({
      HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256: "not-a-digest",
    })).toThrow("HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256");
  });

  it("keeps source_active reads, writes, and lists on OC while deleting OC then ENAM", async () => {
    const operations: string[] = [];
    const source = createBucket({
      get: async (key) => {
        operations.push(`source:get:${key}`);
        return storedObject;
      },
      name: "source",
      operations,
    });
    const destination = createBucket({ name: "destination", operations });
    const context = resolveHostedR2CutoverContext({
      BUNDLES: source,
      BUNDLES_ENAM: destination,
      HOSTED_R2_CUTOVER_PHASE: "source_active",
    });

    expect(await context.bucket.get("one")).toBe(storedObject);
    await context.bucket.put("two", new Uint8Array([2]));
    await context.bucket.list?.({ prefix: "users/" });
    await context.bucket.delete?.("three");

    expect(operations).toEqual([
      "source:get:one",
      "source:put:two",
      "source:list:users/",
      "source:delete:three",
      "destination:delete:three",
    ]);
  });

  it("uses ENAM then OC only after a definitive destination miss", async () => {
    const operations: string[] = [];
    const source = createBucket({
      get: async (key) => {
        operations.push(`source:get:${key}`);
        return storedObject;
      },
      name: "source",
      operations,
    });
    const destination = createBucket({
      get: async (key) => {
        operations.push(`destination:get:${key}`);
        return null;
      },
      name: "destination",
      operations,
    });
    const context = resolveHostedR2CutoverContext({
      BUNDLES: source,
      BUNDLES_ENAM: destination,
      HOSTED_R2_CUTOVER_PHASE: "destination_active",
    });

    expect(await context.bucket.get("fallback")).toBe(storedObject);
    await context.bucket.put("new", new Uint8Array([1]));

    expect(operations).toEqual([
      "destination:get:fallback",
      "source:get:fallback",
      "destination:put:new",
    ]);
  });

  it("does not turn destination operational failures into source fallback reads", async () => {
    const operations: string[] = [];
    const sourceGet = vi.fn(async () => storedObject);
    const source = createBucket({ get: sourceGet, name: "source", operations });
    const destination = createBucket({
      get: async () => {
        throw new Error("destination unavailable");
      },
      name: "destination",
      operations,
    });
    const context = resolveHostedR2CutoverContext({
      BUNDLES: source,
      BUNDLES_ENAM: destination,
      HOSTED_R2_CUTOVER_PHASE: "destination_active",
    });

    await expect(context.bucket.get("key")).rejects.toThrow("destination unavailable");
    expect(sourceGet).not.toHaveBeenCalled();
  });

  it("propagates a partial dual-delete failure and preserves source-first order", async () => {
    const operations: string[] = [];
    const source = createBucket({ name: "source", operations });
    const destination = createBucket({ name: "destination", operations });
    destination.delete = async () => {
      operations.push("destination:delete:key");
      throw new Error("destination delete failed");
    };
    const context = resolveHostedR2CutoverContext({
      BUNDLES: source,
      BUNDLES_ENAM: destination,
      HOSTED_R2_CUTOVER_PHASE: "destination_active",
    });

    await expect(context.bucket.delete?.("key")).rejects.toThrow("destination delete failed");
    expect(operations).toEqual(["source:delete:key", "destination:delete:key"]);
  });

  it("locates direct reads by fixed bucket role and rejects incomplete bridge config", async () => {
    const operations: string[] = [];
    const source = createBucket({
      head: async () => storedObject,
      name: "source",
      operations,
    });
    const destination = createBucket({
      head: async () => null,
      name: "destination",
      operations,
    });
    const context = resolveHostedR2CutoverContext({
      BUNDLES: source,
      BUNDLES_ENAM: destination,
      HOSTED_R2_CUTOVER_PHASE: "destination_active",
    });

    await expect(locateHostedR2ObjectBucketRole(context, "key")).resolves.toBe("source");
    expect(() => resolveHostedR2CutoverContext({
      BUNDLES: source,
      BUNDLES_ENAM: destination,
    })).toThrow("HOSTED_R2_CUTOVER_PHASE");
    expect(() => resolveHostedR2CutoverContext({
      BUNDLES: source,
      HOSTED_R2_CUTOVER_PHASE: "source_active",
    })).toThrow("BUNDLES_ENAM");
  });
});
