import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildAwsMigrationChildEnvironment,
  buildWranglerMigrationChildEnvironment,
  compareR2ObjectInventories,
  createR2MigrationMarkerKey,
  parseCanonicalLifecycleJson,
  parseR2BundlesActiveOwnerGateArgs,
  parseR2BundlesMigrationArgs,
  parseR2ObjectInventoryJson,
  parseWranglerLifecycleList,
  runR2BundlesActiveOwnerGate,
  runR2BundlesMigration,
  type R2BundlesMigrationCommandRunner,
  type R2BundlesMigrationOptions,
  type R2ObjectInventoryEntry,
} from "../scripts/r2-bundles-migration.js";
import { createHostedStorageNamespaceId } from "../src/storage-paths.js";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const SOURCE_BUCKET = "bundles-source-oc";
const DESTINATION_BUCKET = "bundles-destination-enam";
const MARKER_KEY = createR2MigrationMarkerKey(SOURCE_BUCKET, DESTINATION_BUCKET);
const PRIVATE_KEY = "users/private-member/workspace-snapshots/private-object";
const ACTIVE_MEMBER_ID = "member_active_fixture";
const ACTIVE_NAMESPACE = createHostedStorageNamespaceId(ACTIVE_MEMBER_ID);
const ACTIVE_MEMBER_KEY =
  `users/${ACTIVE_NAMESPACE}/workspace-snapshots/snapshot_fixture.snapshot.enc`;
const MIGRATION_ACCESS_KEY = "migration-access-fixture";
const MIGRATION_SECRET_KEY = "migration-secret-fixture";
const CLOUDFLARE_TOKEN = "cloudflare-fixture";

const lifecycleOutput = (bucketName: string) => `Listing lifecycle rules for bucket '${bucketName}'...
name:     delete-hosted-email-raw-messages-after-24h
enabled:  Yes
prefix:   hosted-email/messages/
action:   Expire objects after 1 days

name:     delete-hosted-meal-photos-after-31d
enabled:  Yes
prefix:   hosted-meal-photos/images/
action:   Expire objects after 31 days`;

function inventoryEntry(
  overrides: Partial<R2ObjectInventoryEntry> = {},
): R2ObjectInventoryEntry {
  return {
    etag: '"0123456789abcdef0123456789abcdef"',
    key: PRIVATE_KEY,
    lastModified: "2026-07-22T20:00:00Z",
    size: 1024,
    storageClass: "STANDARD",
    ...overrides,
  };
}

function inventoryJson(entries: readonly R2ObjectInventoryEntry[]): string {
  return JSON.stringify(entries);
}

function markerEntry(
  key = MARKER_KEY,
  overrides: Partial<R2ObjectInventoryEntry> = {},
): R2ObjectInventoryEntry {
  return inventoryEntry({
    etag: '"d41d8cd98f00b204e9800998ecf8427e"',
    key,
    size: 0,
    ...overrides,
  });
}

function options(overrides: Partial<R2BundlesMigrationOptions> = {}): R2BundlesMigrationOptions {
  return {
    apply: false,
    confirmDestination: null,
    destination: DESTINATION_BUCKET,
    prune: null,
    source: SOURCE_BUCKET,
    sourceFrozen: true,
    ...overrides,
  };
}

function migrationEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  return {
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN,
    R2_MIGRATION_ACCESS_KEY_ID: MIGRATION_ACCESS_KEY,
    R2_MIGRATION_SECRET_ACCESS_KEY: MIGRATION_SECRET_KEY,
    ...extra,
  };
}

interface MockRunnerOptions {
  activeMemberIds?: string[];
  copyObjectFailure?: Error;
  destinationInventory?: R2ObjectInventoryEntry[];
  destinationInventoryReadHook?: (input: {
    inventory: R2ObjectInventoryEntry[];
    readCount: number;
  }) => R2ObjectInventoryEntry[];
  destinationLifecycleEmpty?: boolean;
  ownerQueryFailure?: Error;
  sourceInventoryReadHook?: (input: {
    inventory: R2ObjectInventoryEntry[];
    readCount: number;
  }) => R2ObjectInventoryEntry[];
  sourceInventory?: R2ObjectInventoryEntry[];
}

function createMockRunner(input: MockRunnerOptions = {}): {
  calls: Array<{ args: readonly string[]; command: string; env: NodeJS.ProcessEnv }>;
  runner: R2BundlesMigrationCommandRunner;
} {
  const calls: Array<{ args: readonly string[]; command: string; env: NodeJS.ProcessEnv }> = [];
  let lifecycleApplied = !input.destinationLifecycleEmpty;
  let sourceInventory = input.sourceInventory ?? [inventoryEntry()];
  let destinationInventory = input.destinationInventory
    ?? (input.destinationLifecycleEmpty ? [] : sourceInventory.map((entry) => ({ ...entry })));
  let destinationInventoryReadCount = 0;
  let sourceInventoryReadCount = 0;
  const replaceDestinationEntry = (entry: R2ObjectInventoryEntry): void => {
    destinationInventory = [
      ...destinationInventory.filter((candidate) => candidate.key !== entry.key),
      { ...entry, lastModified: "2026-07-22T20:05:00Z" },
    ];
  };

  return {
    calls,
    runner: {
      async run(call) {
        calls.push({ args: call.args, command: call.command, env: call.env });
        if (call.command === "aws" && call.args[0] === "--version") {
          return { stderr: "aws-cli/2.24.21", stdout: "" };
        }
        if (call.command === "murph-prod-psql-ro") {
          if (input.ownerQueryFailure) throw input.ownerQueryFailure;
          return {
            stderr: "",
            stdout: `${(input.activeMemberIds ?? [ACTIVE_MEMBER_ID]).join("\n")}\n`,
          };
        }
        if (call.command === "pnpm" && call.args.includes("info")) {
          const bucket = call.args[5];
          return {
            stderr: "",
            stdout: JSON.stringify({
              default_storage_class: "Standard",
              location: bucket === SOURCE_BUCKET ? "OC" : "ENAM",
              name: bucket,
            }),
          };
        }
        if (call.command === "pnpm" && call.args.includes("lifecycle")) {
          const operation = call.args[5];
          const bucket = call.args[6];
          if (operation === "set") {
            lifecycleApplied = true;
            return { stderr: "", stdout: "" };
          }
          const empty = bucket === DESTINATION_BUCKET && !lifecycleApplied;
          return {
            stderr: "",
            stdout: empty
              ? `Listing lifecycle rules for bucket '${bucket}'...\nThere are no lifecycle rules for bucket '${bucket}'.`
              : lifecycleOutput(String(bucket)),
          };
        }
        if (call.command === "aws" && call.args[0] === "s3api" && call.args[1] === "put-object") {
          replaceDestinationEntry(markerEntry());
          return { stderr: "", stdout: "" };
        }
        if (call.command === "aws" && call.args[0] === "s3api"
          && call.args[1] === "delete-object") {
          const bucket = call.args[call.args.indexOf("--bucket") + 1];
          if (bucket !== DESTINATION_BUCKET) {
            throw new Error("Mock delete-object targeted a bucket other than the destination.");
          }
          const key = call.args[call.args.indexOf("--key") + 1];
          destinationInventory = destinationInventory.filter((entry) => entry.key !== key);
          return { stderr: "", stdout: "" };
        }
        if (call.command === "aws" && call.args[0] === "s3api" && call.args[1] === "copy-object") {
          if (input.copyObjectFailure) throw input.copyObjectFailure;
          const key = call.args[call.args.indexOf("--key") + 1];
          const source = sourceInventory.find((entry) => entry.key === key);
          if (!source) throw new Error("Mock copy-object source was not found.");
          replaceDestinationEntry(source);
          return { stderr: "", stdout: "" };
        }
        if (call.command === "aws" && call.args[0] === "s3api"
          && call.args[1] === "list-objects-v2") {
          const bucket = call.args[call.args.indexOf("--bucket") + 1];
          if (bucket === SOURCE_BUCKET) {
            sourceInventoryReadCount += 1;
            sourceInventory = input.sourceInventoryReadHook?.({
              inventory: sourceInventory.map((entry) => ({ ...entry })),
              readCount: sourceInventoryReadCount,
            }) ?? sourceInventory;
          }
          if (bucket === DESTINATION_BUCKET) {
            destinationInventoryReadCount += 1;
            destinationInventory = input.destinationInventoryReadHook?.({
              inventory: destinationInventory.map((entry) => ({ ...entry })),
              readCount: destinationInventoryReadCount,
            }) ?? destinationInventory;
          }
          return {
            stderr: "",
            stdout: inventoryJson(
              bucket === SOURCE_BUCKET ? sourceInventory : destinationInventory,
            ),
          };
        }
        throw new Error(`Unhandled test command: ${call.command} ${call.args.join(" ")}`);
      },
    },
  };
}

describe("R2 bundles migration arguments", () => {
  it("is read-only by default", () => {
    expect(parseR2BundlesMigrationArgs([
      "--",
      "--source", SOURCE_BUCKET,
      "--destination", DESTINATION_BUCKET,
      "--source-frozen",
    ])).toEqual(options());
  });

  it("refuses to run at all outside the declared write fence", () => {
    expect(() => parseR2BundlesMigrationArgs([
      "--source", SOURCE_BUCKET,
      "--destination", DESTINATION_BUCKET,
    ])).toThrow("--source-frozen is required");
    expect(() => parseR2BundlesMigrationArgs([
      "--source", SOURCE_BUCKET,
      "--destination", DESTINATION_BUCKET,
      "--apply",
      "--confirm-destination", DESTINATION_BUCKET,
    ])).toThrow("--source-frozen is required");
  });

  it("keeps the copy behind an exact destination confirmation", () => {
    expect(() => parseR2BundlesMigrationArgs([
      "--source", SOURCE_BUCKET,
      "--destination", DESTINATION_BUCKET,
      "--source-frozen",
      "--apply",
    ])).toThrow("--confirm-destination");
    expect(parseR2BundlesMigrationArgs([
      "--source", SOURCE_BUCKET,
      "--destination", DESTINATION_BUCKET,
      "--source-frozen",
      "--apply",
      "--confirm-destination", DESTINATION_BUCKET,
    ])).toEqual(options({ apply: true, confirmDestination: DESTINATION_BUCKET }));
  });
});

describe("R2 active-owner gate", () => {
  it("requires the frozen-source acknowledgement", () => {
    expect(() => parseR2BundlesActiveOwnerGateArgs([
      "--source", SOURCE_BUCKET,
    ])).toThrow("--source-frozen is required");
    expect(parseR2BundlesActiveOwnerGateArgs([
      "--",
      "--source", SOURCE_BUCKET,
      "--source-frozen",
    ])).toEqual({
      source: SOURCE_BUCKET,
      sourceFrozen: true,
    });
  });

  it("joins every stable source object to canonical hosted-member ownership", async () => {
    const logs: string[] = [];
    const { calls, runner } = createMockRunner({
      sourceInventory: [
        inventoryEntry({ key: ACTIVE_MEMBER_KEY }),
        inventoryEntry({
          key: `users/${ACTIVE_NAMESPACE}/runner-secrets.json`,
        }),
      ],
    });

    await runR2BundlesActiveOwnerGate({
      source: SOURCE_BUCKET,
      sourceFrozen: true,
    }, migrationEnvironment({
      DATABASE_URL: "must-not-reach-a-child",
    }), {
      log: (message) => logs.push(message),
      runner,
    });

    expect(logs).toEqual([
      "Verified 2 frozen source object(s) across 1 active hosted-member namespace(s).",
    ]);
    const ownerCall = calls.find((call) => call.command === "murph-prod-psql-ro");
    expect(ownerCall?.env.DATABASE_URL).toBeUndefined();
    expect(ownerCall?.env.R2_MIGRATION_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("blocks an object whose member owner is absent without exposing either identifier", async () => {
    const { runner } = createMockRunner({
      activeMemberIds: [],
      sourceInventory: [inventoryEntry({ key: ACTIVE_MEMBER_KEY })],
    });

    const error = await runR2BundlesActiveOwnerGate({
      source: SOURCE_BUCKET,
      sourceFrozen: true,
    }, migrationEnvironment(), { runner }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("outside current hosted-member ownership");
    expect(String(error)).not.toContain(ACTIVE_MEMBER_ID);
    expect(String(error)).not.toContain(ACTIVE_NAMESPACE);
    expect(String(error)).not.toContain(ACTIVE_MEMBER_KEY);
  });

  it("blocks ambiguous non-current object placement", async () => {
    const { runner } = createMockRunner({
      sourceInventory: [inventoryEntry({ key: "bundles/vault/opaque.bundle.json" })],
    });

    await expect(runR2BundlesActiveOwnerGate({
      source: SOURCE_BUCKET,
      sourceFrozen: true,
    }, migrationEnvironment(), { runner })).rejects.toThrow(
      "outside current hosted-member ownership",
    );
  });

  it("blocks an unstable source inventory before reading owner ids", async () => {
    const { calls, runner } = createMockRunner({
      sourceInventory: [inventoryEntry({ key: ACTIVE_MEMBER_KEY })],
      sourceInventoryReadHook: ({ inventory, readCount }) => readCount === 2
        ? inventory.map((entry) => ({ ...entry, size: entry.size + 1 }))
        : inventory,
    });

    await expect(runR2BundlesActiveOwnerGate({
      source: SOURCE_BUCKET,
      sourceFrozen: true,
    }, migrationEnvironment(), { runner })).rejects.toThrow(
      "Source inventory changed during the active-owner gate",
    );
    expect(calls.some((call) => call.command === "murph-prod-psql-ro")).toBe(false);
  });

  it("fails closed when canonical owner enumeration fails", async () => {
    const { runner } = createMockRunner({
      ownerQueryFailure: new Error("read-only owner query unavailable"),
      sourceInventory: [inventoryEntry({ key: ACTIVE_MEMBER_KEY })],
    });

    await expect(runR2BundlesActiveOwnerGate({
      source: SOURCE_BUCKET,
      sourceFrozen: true,
    }, migrationEnvironment(), { runner })).rejects.toThrow(
      "read-only owner query unavailable",
    );
  });
});

describe("R2 lifecycle parsing", () => {
  it("derives the exact enabled day-based rules from the canonical file", async () => {
    const value = await readFile(
      new URL("../r2-bundles-lifecycle.json", import.meta.url),
      "utf8",
    );
    expect(parseCanonicalLifecycleJson(value)).toEqual([
      {
        days: 1,
        enabled: true,
        id: "delete-hosted-email-raw-messages-after-24h",
        prefix: "hosted-email/messages/",
      },
      {
        days: 31,
        enabled: true,
        id: "delete-hosted-meal-photos-after-31d",
        prefix: "hosted-meal-photos/images/",
      },
    ]);
  });

  it("strictly parses pinned Wrangler output and rejects drift", () => {
    expect(parseWranglerLifecycleList(
      lifecycleOutput(SOURCE_BUCKET),
      SOURCE_BUCKET,
    )).toHaveLength(2);
    expect(() => parseWranglerLifecycleList(
      lifecycleOutput(SOURCE_BUCKET).replace("enabled:  Yes", "enabled:  Maybe"),
      SOURCE_BUCKET,
    )).toThrow("unrecognized");
  });
});

describe("R2 inventory verification", () => {
  it("sorts keys bytewise instead of conflating Unicode normalization forms", () => {
    const entries = parseR2ObjectInventoryJson(inventoryJson([
      inventoryEntry({ key: "é" }),
      inventoryEntry({ key: "é" }),
    ]));
    expect(entries.map((entry) => entry.key)).toEqual(["é", "é"]);
  });

  it("uses exact ETags and redacted failures", () => {
    const result = compareR2ObjectInventories(
      [inventoryEntry()],
      [inventoryEntry({ etag: '"ffffffffffffffffffffffffffffffff"' })],
    );
    expect(result.failures).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_KEY);
  });

  it("counts destination-only objects without exposing their keys", () => {
    const first = compareR2ObjectInventories(
      [inventoryEntry()],
      [inventoryEntry(), inventoryEntry({ key: "extra-a" })],
    );
    expect(first.destinationOnlyCount).toBe(1);
    expect(JSON.stringify(first)).not.toContain("extra-a");
  });
});

describe("R2 copy command and credential boundaries", () => {
  it("passes only explicitly allowlisted variables to each child", () => {
    const base = {
      AWS_PROFILE: "must-not-survive",
      CLOUDFLARE_API_TOKEN: "cloudflare-fixture",
      DATABASE_URL: "must-not-survive",
      PATH: "/fixture/bin",
      R2_MIGRATION_SECRET_ACCESS_KEY: "must-not-survive",
    };
    const aws = buildAwsMigrationChildEnvironment({
      accessKeyId: "migration-access-fixture",
      base,
      secretAccessKey: "migration-secret-fixture",
    });
    const wrangler = buildWranglerMigrationChildEnvironment(base);
    expect(aws.AWS_ACCESS_KEY_ID).toBe("migration-access-fixture");
    expect(aws.AWS_SECRET_ACCESS_KEY).toBe("migration-secret-fixture");
    expect(aws.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(aws.DATABASE_URL).toBeUndefined();
    expect(aws.AWS_PROFILE).toBeUndefined();
    expect(wrangler.CLOUDFLARE_API_TOKEN).toBe("cloudflare-fixture");
    expect(wrangler.WRANGLER_HIDE_BANNER).toBe("true");
    expect(wrangler.R2_MIGRATION_SECRET_ACCESS_KEY).toBeUndefined();
    expect(wrangler.DATABASE_URL).toBeUndefined();
  });
});

describe("R2 migration orchestration", () => {
  it("performs only a read-only mirror gate without --apply", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), markerEntry()],
    });
    await runR2BundlesMigration(options(), migrationEnvironment({
      DATABASE_URL: "must-not-reach-a-child",
    }), { log: () => undefined, runner });
    expect(calls.some((call) => call.args.includes("set"))).toBe(false);
    expect(mutationCalls(calls)).toHaveLength(0);
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain(MIGRATION_ACCESS_KEY);
      expect(call.args.join(" ")).not.toContain(MIGRATION_SECRET_KEY);
      expect(call.args.join(" ")).not.toContain(CLOUDFLARE_TOKEN);
      expect(call.env.DATABASE_URL).toBeUndefined();
    }
  });

  it("fails closed on multipart history without exposing its object key", async () => {
    const { runner } = createMockRunner({
      destinationInventory: [markerEntry()],
      sourceInventory: [inventoryEntry({ etag: '"multipart-etag-2"' })],
    });
    let message = "";
    try {
      await runR2BundlesMigration(options(), migrationEnvironment(), {
        log: () => undefined,
        runner,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("simple quoted MD5 ETag");
    expect(message).not.toContain(PRIVATE_KEY);
  });

  it("sets and reads back lifecycle before creating the marker and seeding", async () => {
    const { calls, runner } = createMockRunner({ destinationLifecycleEmpty: true });
    await runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment(), { log: () => undefined, runner });
    const lifecycleSet = calls.findIndex((call) => call.args.includes("set"));
    const markerPut = calls.findIndex((call) => call.args[1] === "put-object");
    const seed = calls.findIndex((call) => call.args[1] === "copy-object");
    expect(lifecycleSet).toBeGreaterThan(-1);
    expect(markerPut).toBeGreaterThan(lifecycleSet);
    expect(seed).toBeGreaterThan(markerPut);
    expect(calls[markerPut]?.args).toContain("--if-none-match");
    expect(calls[markerPut]?.args).toContain("*");
    expect(calls.every((call) => !call.args.includes("--delete"))).toBe(true);
  });

  it("copies every missing or changed object with R2-compatible source conditions", async () => {
    const missing = inventoryEntry({
      etag: '"11111111111111111111111111111111"',
      key: `${PRIVATE_KEY}-missing #1`,
    });
    const changed = inventoryEntry({ etag: '"ffffffffffffffffffffffffffffffff"' });
    const logs: string[] = [];
    const { calls, runner } = createMockRunner({
      destinationInventory: [changed, markerEntry()],
      sourceInventory: [inventoryEntry(), missing],
    });
    await runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment(), {
      log: (message) => logs.push(message),
      runner,
    });

    const copies = calls.filter((call) =>
      call.command === "aws" && call.args[1] === "copy-object");
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy.args).toContain("--copy-source");
      expect(copy.args).toContain("--copy-source-if-match");
      expect(copy.args).toContain("--key");
      expect(copy.args.slice(
        copy.args.indexOf("--metadata-directive"),
        copy.args.indexOf("--metadata-directive") + 2,
      )).toEqual(["--metadata-directive", "COPY"]);
      expect(copy.args.slice(
        copy.args.indexOf("--storage-class"),
        copy.args.indexOf("--storage-class") + 2,
      )).toEqual(["--storage-class", "STANDARD"]);
    }
    const specialKeyCopy = copies.find((copy) => copy.args.includes(missing.key));
    if (!specialKeyCopy) throw new Error("Special-key copy call was not observed.");
    expect(specialKeyCopy.args.slice(
      specialKeyCopy.args.indexOf("--copy-source"),
      specialKeyCopy.args.indexOf("--copy-source") + 2,
    )).toEqual(["--copy-source", `/${SOURCE_BUCKET}/${missing.key}`]);
    expect(specialKeyCopy.args.slice(
      specialKeyCopy.args.indexOf("--copy-source-if-match"),
      specialKeyCopy.args.indexOf("--copy-source-if-match") + 2,
    )).toEqual(["--copy-source-if-match", missing.etag]);
    expect(logs).toContain("Copied 2 object(s).");
  });

  it("sanitizes a targeted copy failure", async () => {
    const unsafeFailure = new Error(
      `aws s3api copy-object --key ${PRIVATE_KEY} `
      + `--access-key ${MIGRATION_ACCESS_KEY} --secret ${MIGRATION_SECRET_KEY}`,
    );
    const { runner } = createMockRunner({
      copyObjectFailure: unsafeFailure,
      destinationInventory: [
        inventoryEntry({ etag: '"ffffffffffffffffffffffffffffffff"' }),
        markerEntry(),
      ],
    });
    let message = "";
    try {
      await runR2BundlesMigration(options({
        apply: true,
        confirmDestination: DESTINATION_BUCKET,
      }), migrationEnvironment(), { log: () => undefined, runner });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("R2 deterministic object copy failed.");
    expect(message).not.toContain(PRIVATE_KEY);
    expect(message).not.toContain("copy-object --key");
    expect(message).not.toContain(MIGRATION_ACCESS_KEY);
    expect(message).not.toContain(MIGRATION_SECRET_KEY);
  });

  it("rejects any migration marker in the source before mutation", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), markerEntry()],
      sourceInventory: [inventoryEntry(), markerEntry()],
    });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment(), { log: () => undefined, runner })).rejects.toThrow(
      "unexpected R2 bundles migration marker",
    );
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("rejects a non-empty seed destination without the exact pair marker", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry()],
    });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment(), { log: () => undefined, runner })).rejects.toThrow(
      "provenance marker does not match",
    );
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("rejects a marked destination extra before copying", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry({ key: "unexpected-seed-object" }), markerEntry()],
    });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment(), { log: () => undefined, runner })).rejects.toThrow(
      "unexpected object",
    );
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("verifies an exact marked mirror without mutating it", async () => {
    const logs: string[] = [];
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), markerEntry()],
    });
    await runR2BundlesMigration(options(), migrationEnvironment(), {
      log: (message) => logs.push(message),
      runner,
    });
    expect(mutationCalls(calls)).toHaveLength(0);
    expect(logs.join("\n")).toContain("Verified the exact mirror of 1 frozen source object(s)");
  });

  it.each([
    ["missing", []],
    [
      "wrong",
      [markerEntry(createR2MigrationMarkerKey(SOURCE_BUCKET, "other-destination-enam"))],
    ],
    [
      "multiple",
      [
        markerEntry(),
        markerEntry(createR2MigrationMarkerKey(SOURCE_BUCKET, "other-destination-enam")),
      ],
    ],
    ["malformed", [markerEntry(MARKER_KEY, { size: 1 })]],
  ])("rejects a %s destination marker", async (_label, markers) => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), ...markers],
    });
    await expect(runR2BundlesMigration(
      options(),
      migrationEnvironment(),
      { log: () => undefined, runner },
    )).rejects.toThrow("provenance marker does not match");
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it.each([
    ["missing", []],
    ["changed", [inventoryEntry({ etag: '"ffffffffffffffffffffffffffffffff"' })]],
  ])("refuses %s frozen-source coverage", async (_label, objects) => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [...objects, markerEntry()],
    });
    await expect(runR2BundlesMigration(options(), migrationEnvironment(), {
      log: () => undefined,
      runner,
    })).rejects.toThrow("not copied from the source");
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("refuses a source that changes between the two verification reads", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), markerEntry()],
      sourceInventoryReadHook: ({ inventory, readCount }) => readCount === 3
        ? inventory.map((entry) => ({ ...entry, lastModified: "2026-07-22T20:01:00Z" }))
        : inventory,
    });
    await expect(runR2BundlesMigration(options(), migrationEnvironment(), {
      log: () => undefined,
      runner,
    })).rejects.toThrow("Source inventory is not frozen");
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("refuses a destination that changes between the two verification reads", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), markerEntry()],
      destinationInventoryReadHook: ({ inventory, readCount }) => readCount === 3
        ? [...inventory, inventoryEntry({ key: "unexpected-final-object" })]
        : inventory,
    });
    await expect(runR2BundlesMigration(options(), migrationEnvironment(), {
      log: () => undefined,
      runner,
    })).rejects.toThrow("Destination inventory is not stable");
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("refuses destination extras without deleting anything", async () => {
    const extra = inventoryEntry({ key: "obsolete-object" });
    const rejected = createMockRunner({
      destinationInventory: [inventoryEntry(), extra, markerEntry()],
    });
    await expect(runR2BundlesMigration(options(), migrationEnvironment(), {
      log: () => undefined,
      runner: rejected.runner,
    })).rejects.toThrow("unexpected destination object");
    expect(mutationCalls(rejected.calls)).toHaveLength(0);
    expect(rejected.calls.some((call) => call.args.includes("delete-object"))).toBe(false);
  });

  it("refuses an object inserted alongside marker bootstrap before copying", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventoryReadHook: ({ inventory, readCount }) => readCount === 3
        ? [...inventory, inventoryEntry({ key: "unexpected-bootstrap-object" })]
        : inventory,
      destinationLifecycleEmpty: true,
    });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment(), { log: () => undefined, runner })).rejects.toThrow(
      "changed while the migration marker was created",
    );
    expect(calls.some((call) => call.args[1] === "copy-object")).toBe(false);
    expect(calls.some((call) => call.args.includes("delete-object"))).toBe(false);
  });

  it("fails closed when the destination gains an extra during seed", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [markerEntry()],
      destinationInventoryReadHook: ({ inventory, readCount }) => readCount === 3
        ? [...inventory, inventoryEntry({ key: "unexpected-late-object" })]
        : inventory,
    });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment(), { log: () => undefined, runner })).rejects.toThrow(
      "unexpected destination object",
    );
    expect(calls.some((call) => call.args[1] === "copy-object")).toBe(true);
    expect(calls.some((call) => call.args.includes("delete-object"))).toBe(false);
  });

  it.each([
    ["raw email", "hosted-email/messages/transient-email"],
    ["staged meal photo", "hosted-meal-photos/images/transient-photo"],
  ])("refuses to start while a staged %s object remains", async (_label, key) => {
    const staged = inventoryEntry({ key });
    const { calls, runner } = createMockRunner({
      destinationLifecycleEmpty: true,
      sourceInventory: [inventoryEntry(), staged],
    });
    let message = "";
    try {
      await runR2BundlesMigration(options({
        apply: true,
        confirmDestination: DESTINATION_BUCKET,
      }), migrationEnvironment(), { log: () => undefined, runner });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("retention age reset");
    expect(message).not.toContain(key);
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("reports both divergence directions instead of collapsing them", async () => {
    // A mixed divergence must show both directions; reporting only one would
    // hide half of what the operator has to act on.
    const stale = createMockRunner({
      destinationInventory: [inventoryEntry(), inventoryEntry({ key: "stale-copy" }), markerEntry()],
    });
    const incomplete = createMockRunner({
      destinationInventory: [markerEntry()],
      sourceInventory: [inventoryEntry()],
    });
    const read = async (mock: ReturnType<typeof createMockRunner>): Promise<string> => {
      try {
        await runR2BundlesMigration(options(), migrationEnvironment(), {
          log: () => undefined,
          runner: mock.runner,
        });
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error("Expected the read-only gate to fail.");
    };

    const staleMessage = await read(stale);
    const incompleteMessage = await read(incomplete);
    expect(staleMessage).toContain("unexpected destination object");
    expect(staleMessage).not.toContain("not copied from the source");
    expect(incompleteMessage).toContain("not copied from the source");
    expect(incompleteMessage).not.toContain("unexpected destination object");
    expect(mutationCalls(stale.calls)).toHaveLength(0);
    expect(mutationCalls(incomplete.calls)).toHaveLength(0);
  });

  it("prunes exactly the objects the source no longer has, then converges", async () => {
    const stale = inventoryEntry({
      etag: '"22222222222222222222222222222222"',
      key: `${PRIVATE_KEY}-superseded`,
    });
    const logs: string[] = [];
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), stale, markerEntry()],
      sourceInventory: [inventoryEntry()],
    });
    await runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
      prune: 1,
    }), migrationEnvironment(), { log: (message) => logs.push(message), runner });

    const deletes = calls.filter((call) => call.args[1] === "delete-object");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.args[deletes[0].args.indexOf("--key") + 1]).toBe(stale.key);
    expect(deletes[0]?.args[deletes[0].args.indexOf("--bucket") + 1]).toBe(DESTINATION_BUCKET);
    expect(logs.join("\n")).toContain("Pruned 1 destination object(s)");
    expect(logs.join("\n")).not.toContain(stale.key);
    expect(logs.join("\n")).toContain("Verified the exact mirror");
  });

  it("never issues a delete against the source bucket", async () => {
    const stale = inventoryEntry({ key: `${PRIVATE_KEY}-superseded` });
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), stale, markerEntry()],
      sourceInventory: [inventoryEntry()],
    });
    await runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
      prune: 1,
    }), migrationEnvironment(), { log: () => undefined, runner });
    for (const call of calls.filter((entry) => entry.args[1] === "delete-object")) {
      expect(call.args).not.toContain(SOURCE_BUCKET);
    }
  });

  it("refuses a prune count that does not match the observed drift", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [
        inventoryEntry(),
        inventoryEntry({ key: `${PRIVATE_KEY}-a` }),
        markerEntry(),
      ],
      sourceInventory: [inventoryEntry()],
    });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
      prune: 2,
    }), migrationEnvironment(), { log: () => undefined, runner })).rejects.toThrow(
      "does not match",
    );
    expect(calls.some((call) => call.args[1] === "delete-object")).toBe(false);
  });

  it("refuses to prune a key the second source read still reports", async () => {
    const contested = inventoryEntry({ key: `${PRIVATE_KEY}-contested` });
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), contested, markerEntry()],
      sourceInventory: [inventoryEntry()],
      // The confirming read sees the object again, so the delete is not authorized.
      sourceInventoryReadHook: ({ inventory, readCount }) => readCount === 2
        ? [...inventory, contested]
        : inventory,
    });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
      prune: 1,
    }), migrationEnvironment(), { log: () => undefined, runner })).rejects.toThrow(
      "still in the source",
    );
    expect(calls.some((call) => call.args[1] === "delete-object")).toBe(false);
  });

  it("keeps the read-only gate incapable of deleting", () => {
    expect(() => parseR2BundlesMigrationArgs([
      "--source", SOURCE_BUCKET,
      "--destination", DESTINATION_BUCKET,
      "--source-frozen",
      "--prune", "1",
    ])).toThrow("--prune requires --apply");
  });

  it("blocks the read-only gate while a lifecycle-managed source object remains", async () => {
    const staged = inventoryEntry({ key: "hosted-email/messages/transient-email" });
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), staged, markerEntry()],
      sourceInventory: [inventoryEntry(), staged],
    });
    await expect(runR2BundlesMigration(options(), migrationEnvironment(), {
      log: () => undefined,
      runner,
    })).rejects.toThrow("retention age reset");
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("fails closed when ordinary cleanup deletes an already-copied source object", async () => {
    const superseded = inventoryEntry({
      etag: '"11111111111111111111111111111111"',
      key: `${PRIVATE_KEY}-superseded`,
    });
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), superseded, markerEntry()],
      sourceInventory: [inventoryEntry(), superseded],
      sourceInventoryReadHook: ({ inventory, readCount }) => readCount >= 2
        ? inventory.filter((entry) => entry.key !== superseded.key)
        : inventory,
    });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment(), { log: () => undefined, runner })).rejects.toThrow(
      "unexpected destination object",
    );
    expect(calls.some((call) => call.args.includes("delete-object"))).toBe(false);
  });

  it("keeps credentials out of arguments and limits each child environment", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [
        inventoryEntry({ etag: '"ffffffffffffffffffffffffffffffff"' }),
        markerEntry(),
      ],
    });
    await runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment({
      AWS_PROFILE: "must-not-reach-a-child",
      DATABASE_URL: "must-not-reach-a-child",
      PRIVATE_SERVICE_TOKEN: "must-not-reach-a-child",
    }), { log: () => undefined, runner });

    for (const call of calls) {
      const args = call.args.join(" ");
      expect(args).not.toContain(MIGRATION_ACCESS_KEY);
      expect(args).not.toContain(MIGRATION_SECRET_KEY);
      expect(args).not.toContain(CLOUDFLARE_TOKEN);
      expect(call.env.AWS_PROFILE).toBeUndefined();
      expect(call.env.DATABASE_URL).toBeUndefined();
      expect(call.env.PRIVATE_SERVICE_TOKEN).toBeUndefined();
      if (call.command === "aws") {
        expect(call.env.AWS_ACCESS_KEY_ID).toBe(MIGRATION_ACCESS_KEY);
        expect(call.env.AWS_SECRET_ACCESS_KEY).toBe(MIGRATION_SECRET_KEY);
        expect(call.env.CLOUDFLARE_API_TOKEN).toBeUndefined();
      } else {
        expect(call.command).toBe("pnpm");
        expect(call.env.CLOUDFLARE_API_TOKEN).toBe(CLOUDFLARE_TOKEN);
        expect(call.env.AWS_ACCESS_KEY_ID).toBeUndefined();
        expect(call.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      }
    }
  });

});

function mutationCalls(
  calls: ReadonlyArray<{ args: readonly string[]; command: string }>,
): Array<{ args: readonly string[]; command: string }> {
  return calls.filter((call) =>
    (call.command === "aws" && (
      call.args[0] === "s3api" && call.args[1] !== "list-objects-v2"
    ))
    || (call.command === "pnpm"
      && call.args.includes("lifecycle")
      && call.args.includes("set")));
}
