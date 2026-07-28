import { describe, expect, it, vi } from "vitest";

import {
  classifyR2OnlineCopyKey,
  compareR2OnlineEligibleObjects,
  createSignedR2Request,
  parseR2BundlesOnlineCopyArgs,
  runR2BundlesOnlineCopy,
  type R2BundlesOnlineCopyOptions,
} from "../scripts/r2-bundles-online-copy.ts";
import {
  createR2MigrationMarkerKey,
  type R2ObjectInventoryEntry,
} from "../scripts/r2-bundles-migration.ts";

const sourceBucket = "murph-bundles-oc";
const destinationBucket = "murph-bundles-enam";
const environment = {
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_MIGRATION_ACCESS_KEY_ID: "access",
  R2_MIGRATION_SECRET_ACCESS_KEY: "secret",
};
const activeOwners = {
  canonicalSnapshotObjectKeys: new Set<string>(),
  namespaces: new Set(["hsn_0123456789abcdef01234567"]),
};
type CopyObjectInput = {
  destination: string;
  entry: R2ObjectInventoryEntry;
  source: string;
};

function entry(key: string, overrides: Partial<R2ObjectInventoryEntry> = {}): R2ObjectInventoryEntry {
  return {
    etag: '"d41d8cd98f00b204e9800998ecf8427e"',
    key,
    lastModified: "2026-07-28T00:00:00.000Z",
    size: 0,
    storageClass: "STANDARD",
    ...overrides,
  };
}

function marker(): R2ObjectInventoryEntry {
  return entry(createR2MigrationMarkerKey(sourceBucket, destinationBucket));
}

function options(overrides: Partial<R2BundlesOnlineCopyOptions> = {}): R2BundlesOnlineCopyOptions {
  return {
    apply: false,
    confirmDestination: null,
    copierStopped: false,
    destination: destinationBucket,
    finalConvergence: false,
    immutableKeysAudited: false,
    phase: "source_active",
    source: sourceBucket,
    sourcePutDrained: false,
    ...overrides,
  };
}

describe("R2 online immutable copy", () => {
  it("classifies only the approved immutable user-scoped key families", () => {
    expect(classifyR2OnlineCopyKey(
      "users/hsn_0123456789abcdef01234567/artifacts/0123456789abcdef0123456789abcdef0123456789abcdef.artifact.bin",
    )).toBe("eligible_immutable");
    expect(classifyR2OnlineCopyKey(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_1.snapshot.enc",
    )).toBe("eligible_immutable");
    expect(classifyR2OnlineCopyKey(
      "hosted-email/messages/hsn_0123456789abcdef01234567/message.eml",
    )).toBe("lifecycle_managed");
    expect(classifyR2OnlineCopyKey(
      "hosted-meal-photos/images/hsn_0123456789abcdef01234567/photo.jpg.enc",
    )).toBe("lifecycle_managed");
    expect(classifyR2OnlineCopyKey(
      "users/hsn_0123456789abcdef01234567/runner-secrets.json",
    )).toBe("mutable_fixed");
    expect(classifyR2OnlineCopyKey("bundles/full/legacy.bundle.json")).toBe("legacy_global");
    expect(classifyR2OnlineCopyKey("unexpected/key")).toBe("unknown");
  });

  it("rejects prune-like arguments and requires explicit final-drain acknowledgements", () => {
    expect(() => parseR2BundlesOnlineCopyArgs([
      "--source", sourceBucket,
      "--destination", destinationBucket,
      "--phase", "source_active",
      "--prune", "1",
    ])).toThrow();
    expect(() => parseR2BundlesOnlineCopyArgs([
      "--source", sourceBucket,
      "--destination", destinationBucket,
      "--phase", "destination_active",
      "--final-convergence",
      "--immutable-keys-audited",
    ])).toThrow("--copier-stopped");
  });

  it("signs the R2 beta destination create-only header with the source ETag", () => {
    const signed = createSignedR2Request({
      accessKeyId: "access",
      bucket: destinationBucket,
      endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
      headers: {
        "cf-copy-destination-if-none-match": "*",
        "x-amz-copy-source": `/${sourceBucket}/users/key`,
        "x-amz-copy-source-if-match": '"etag"',
        "x-amz-metadata-directive": "COPY",
        "x-amz-storage-class": "STANDARD",
      },
      key: "users/key",
      method: "PUT",
      now: new Date("2026-07-28T12:00:00.000Z"),
      secretAccessKey: "secret",
    });

    expect(signed.headers["cf-copy-destination-if-none-match"]).toBe("*");
    expect(signed.headers["x-amz-copy-source-if-match"]).toBe('"etag"');
    expect(signed.headers.authorization).toContain("cf-copy-destination-if-none-match");
    expect(signed.headers.authorization).toContain("x-amz-copy-source-if-match");
  });

  it("allows ENAM-native objects only after destination_active", () => {
    const copied = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/source.snapshot.enc",
    );
    const enamNative = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/destination.snapshot.enc",
    );
    const comparison = compareR2OnlineEligibleObjects([copied], [copied, enamNative]);

    expect(comparison).toEqual({
      destinationOnlyEligibleCount: 1,
      mismatchedEligibleKeys: [],
      sourceOnlyEligibleKeys: [],
    });
  });

  it("copies an eligible object, excludes lifecycle keys, and exposes no delete dependency", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/snapshot_1.snapshot.enc",
      { etag: '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"', size: 12 },
    );
    const lifecycle = entry(
      "hosted-email/messages/hsn_0123456789abcdef01234567/message.eml",
      { etag: '"multipart-etag-2"', size: 6_000_000_000 },
    );
    let destinationInventory = [marker()];
    const copyObject = vi.fn(async (_input: CopyObjectInput) => {
      destinationInventory = [marker(), eligible];
      return "copied" as const;
    });
    const headObject = vi.fn(async (bucket: string, key: string) => {
      const found = (bucket === sourceBucket ? [eligible] : destinationInventory)
        .find((candidate) => candidate.key === key);
      return found ? { etag: found.etag, size: found.size } : null;
    });

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject,
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket
          ? [eligible, lifecycle]
          : destinationInventory,
      },
    );

    expect(copyObject).toHaveBeenCalledTimes(1);
    const copyInput = copyObject.mock.calls[0]?.[0];
    if (!copyInput) {
      throw new Error("expected a copyObject call");
    }
    expect(copyInput.entry.key).toBe(eligible.key);
  });

  it("treats an identical create-only destination precondition as convergence", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/already.snapshot.enc",
      { etag: '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"', size: 7 },
    );
    const destinationInventory = [marker(), eligible];
    const copyObject = vi.fn(async () => "destination_exists" as const);

    await runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(async () => ({ etag: eligible.etag, size: eligible.size })),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket
          ? [eligible]
          : (copyObject.mock.calls.length === 0 ? [marker()] : destinationInventory),
      },
    );

    expect(copyObject).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an immutable source identity changes after CopyObject", async () => {
    const eligible = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/raced.snapshot.enc",
      { etag: '"cccccccccccccccccccccccccccccccc"', size: 9 },
    );
    let destinationInventory = [marker()];
    const copyObject = vi.fn(async () => {
      destinationInventory = [marker(), eligible];
      return "copied" as const;
    });

    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(async (bucket: string) => bucket === destinationBucket
            ? { etag: eligible.etag, size: eligible.size }
            : { etag: '"dddddddddddddddddddddddddddddddd"', size: eligible.size }),
          putMarker: vi.fn(async () => "created" as const),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket ? [eligible] : destinationInventory,
      },
    )).rejects.toThrow("source changed after a create-only copy committed");
  });

  it("final convergence accepts ENAM-only production writes and is strictly read-only", async () => {
    const copied = entry(
      "users/hsn_0123456789abcdef01234567/artifacts/0123456789abcdef0123456789abcdef0123456789abcdef.artifact.bin",
    );
    const enamNative = entry(
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/new.snapshot.enc",
    );
    const copyObject = vi.fn();
    const putMarker = vi.fn();

    await runR2BundlesOnlineCopy(
      options({
        copierStopped: true,
        finalConvergence: true,
        immutableKeysAudited: true,
        phase: "destination_active",
        sourcePutDrained: true,
      }),
      environment,
      {
        client: {
          copyObject,
          headObject: vi.fn(),
          putMarker,
        },
        inspectActiveOwners: async () => ({
          canonicalSnapshotObjectKeys: new Set([enamNative.key]),
          namespaces: activeOwners.namespaces,
        }),
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket
          ? [copied]
          : [marker(), copied, enamNative],
      },
    );

    expect(copyObject).not.toHaveBeenCalled();
    expect(putMarker).not.toHaveBeenCalled();
  });

  it("blocks objects outside the current hosted-member ownership set", async () => {
    const unowned = entry(
      "users/hsn_ffffffffffffffffffffffff/workspace-snapshots/orphan.snapshot.enc",
    );
    await expect(runR2BundlesOnlineCopy(
      options({
        apply: true,
        confirmDestination: destinationBucket,
        immutableKeysAudited: true,
      }),
      environment,
      {
        client: {
          copyObject: vi.fn(),
          headObject: vi.fn(),
          putMarker: vi.fn(),
        },
        inspectActiveOwners: async () => activeOwners,
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket ? [unowned] : [marker()],
      },
    )).rejects.toThrow("outside current hosted-member ownership");
  });

  it("blocks when a canonical v2 checkpoint is absent from OC", async () => {
    const canonicalKey =
      "users/hsn_0123456789abcdef01234567/workspace-snapshots/canonical.snapshot.enc";
    await expect(runR2BundlesOnlineCopy(
      options(),
      environment,
      {
        client: {
          copyObject: vi.fn(),
          headObject: vi.fn(),
          putMarker: vi.fn(),
        },
        inspectActiveOwners: async () => ({
          canonicalSnapshotObjectKeys: new Set([canonicalKey]),
          namespaces: activeOwners.namespaces,
        }),
        inspectInfrastructure: async () => undefined,
        log: vi.fn(),
        readInventory: async (bucket) => bucket === sourceBucket ? [] : [marker()],
      },
    )).rejects.toThrow("canonical v2 workspace snapshot");
  });

  it("blocks mutable, unknown, and legacy-global source objects before any copy", async () => {
    const copyObject = vi.fn();
    for (const blockedKey of [
      "users/hsn_0123456789abcdef01234567/runner-secrets.json",
      "bundles/full/legacy.bundle.json",
      "unknown/object",
    ]) {
      await expect(runR2BundlesOnlineCopy(
        options({
          apply: true,
          confirmDestination: destinationBucket,
          immutableKeysAudited: true,
        }),
        environment,
        {
          client: {
            copyObject,
            headObject: vi.fn(),
            putMarker: vi.fn(),
          },
          inspectActiveOwners: async () => activeOwners,
          inspectInfrastructure: async () => undefined,
          log: vi.fn(),
          readInventory: async (bucket) => bucket === sourceBucket
            ? [entry(blockedKey)]
            : [marker()],
        },
      )).rejects.toThrow("mutable, unknown, or legacy-global");
    }
    expect(copyObject).not.toHaveBeenCalled();
  });
});
