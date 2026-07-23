import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildAwsMigrationChildEnvironment,
  buildR2SyncArgs,
  buildWranglerMigrationChildEnvironment,
  compareR2ObjectInventories,
  createR2MigrationMarkerKey,
  parseCanonicalLifecycleJson,
  parseR2BundlesMigrationArgs,
  parseR2ObjectInventoryJson,
  parseWranglerLifecycleList,
  runR2BundlesMigration,
  type R2BundlesMigrationCommandRunner,
  type R2BundlesMigrationOptions,
  type R2ObjectInventoryEntry,
} from "../scripts/r2-bundles-migration.js";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const SOURCE_BUCKET = "bundles-source-oc";
const DESTINATION_BUCKET = "bundles-destination-enam";
const MARKER_KEY = createR2MigrationMarkerKey(SOURCE_BUCKET, DESTINATION_BUCKET);
const PRIVATE_KEY = "users/private-member/workspace-snapshots/private-object";
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
    confirmDeleteSet: null,
    confirmDestination: null,
    destination: DESTINATION_BUCKET,
    phase: "seed",
    source: SOURCE_BUCKET,
    sourceFrozen: false,
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
  copyObjectFailure?: Error;
  destinationInventory?: R2ObjectInventoryEntry[];
  destinationLifecycleEmpty?: boolean;
  seedSyncLeavesKeys?: readonly string[];
  sourceInventory?: R2ObjectInventoryEntry[];
}

function createMockRunner(input: MockRunnerOptions = {}): {
  calls: Array<{ args: readonly string[]; command: string; env: NodeJS.ProcessEnv }>;
  runner: R2BundlesMigrationCommandRunner;
} {
  const calls: Array<{ args: readonly string[]; command: string; env: NodeJS.ProcessEnv }> = [];
  let lifecycleApplied = !input.destinationLifecycleEmpty;
  const sourceInventory = input.sourceInventory ?? [inventoryEntry()];
  let destinationInventory = input.destinationInventory
    ?? (input.destinationLifecycleEmpty ? [] : sourceInventory.map((entry) => ({ ...entry })));
  const seedSyncLeavesKeys = new Set(input.seedSyncLeavesKeys ?? []);

  const excludedBy = (args: readonly string[], key: string): boolean => {
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] !== "--exclude") continue;
      const pattern = args[index + 1];
      if (pattern === key || (pattern?.endsWith("*") && key.startsWith(pattern.slice(0, -1)))) {
        return true;
      }
    }
    return false;
  };
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
        if (call.command === "aws" && call.args[0] === "s3") {
          const deleteDestinationOnly = call.args.includes("--delete");
          for (const entry of sourceInventory) {
            if (excludedBy(call.args, entry.key)) continue;
            if (!deleteDestinationOnly && seedSyncLeavesKeys.has(entry.key)) continue;
            replaceDestinationEntry(entry);
          }
          if (deleteDestinationOnly) {
            destinationInventory = destinationInventory.filter((entry) =>
              sourceInventory.some((source) => source.key === entry.key)
              || excludedBy(call.args, entry.key));
          }
          return { stderr: "", stdout: "" };
        }
        if (call.command === "aws" && call.args[0] === "s3api" && call.args[1] === "put-object") {
          replaceDestinationEntry(markerEntry());
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
      "--phase", "seed",
      "--source", SOURCE_BUCKET,
      "--destination", DESTINATION_BUCKET,
    ])).toEqual(options());
  });

  it("requires a frozen source and exact deletion token for final apply", () => {
    expect(() => parseR2BundlesMigrationArgs([
      "--phase", "final",
      "--source", SOURCE_BUCKET,
      "--destination", DESTINATION_BUCKET,
      "--confirm-destination", DESTINATION_BUCKET,
      "--apply",
    ])).toThrow("--source-frozen and --confirm-delete-set");
  });

  it("keeps verify strictly read-only", () => {
    expect(() => parseR2BundlesMigrationArgs([
      "--phase", "verify",
      "--source", SOURCE_BUCKET,
      "--destination", DESTINATION_BUCKET,
      "--source-frozen",
    ])).toThrow("verify phase is read-only");
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

  it("binds destructive confirmation to the exact destination-only set", () => {
    const first = compareR2ObjectInventories(
      [inventoryEntry()],
      [inventoryEntry(), inventoryEntry({ key: "extra-a" })],
    );
    const second = compareR2ObjectInventories(
      [inventoryEntry()],
      [inventoryEntry(), inventoryEntry({ key: "extra-b" })],
    );
    expect(first.destinationOnlyCount).toBe(1);
    expect(first.deleteSetConfirmation).not.toBe(second.deleteSetConfirmation);
    expect(first.deleteSetConfirmation).toMatch(/^1:[a-f0-9]{64}$/u);
  });
});

describe("R2 copy command and credential boundaries", () => {
  it("uses one sync, canonical exclusions, metadata copy, and optional deletion", () => {
    const seed = buildR2SyncArgs({
      deleteDestinationOnly: false,
      destination: DESTINATION_BUCKET,
      endpoint: ENDPOINT,
      excludedPatterns: ["hosted-email/messages/*"],
      source: SOURCE_BUCKET,
    });
    const final = buildR2SyncArgs({
      deleteDestinationOnly: true,
      destination: DESTINATION_BUCKET,
      endpoint: ENDPOINT,
      excludedPatterns: [],
      source: SOURCE_BUCKET,
    });
    expect(seed.slice(0, 2)).toEqual(["s3", "sync"]);
    expect(seed).toContain("hosted-email/messages/*");
    expect(seed).toContain("metadata-directive");
    expect(seed).not.toContain("--delete");
    expect(final).toContain("--delete");
    expect(final).not.toContain("cp");
  });

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
  it("performs only read-only preflight without --apply", async () => {
    const { calls, runner } = createMockRunner({ destinationLifecycleEmpty: true });
    await runR2BundlesMigration(options(), migrationEnvironment({
      DATABASE_URL: "must-not-reach-a-child",
    }), { log: () => undefined, runner });
    expect(calls.some((call) => call.args.includes("set"))).toBe(false);
    expect(calls.some((call) => call.args[0] === "s3")).toBe(false);
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain(MIGRATION_ACCESS_KEY);
      expect(call.args.join(" ")).not.toContain(MIGRATION_SECRET_KEY);
      expect(call.args.join(" ")).not.toContain(CLOUDFLARE_TOKEN);
      expect(call.env.DATABASE_URL).toBeUndefined();
    }
  });

  it("fails closed on multipart history without exposing its object key", async () => {
    const { runner } = createMockRunner({
      destinationLifecycleEmpty: true,
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
    const seed = calls.findIndex((call) => call.args[0] === "s3");
    expect(lifecycleSet).toBeGreaterThan(-1);
    expect(markerPut).toBeGreaterThan(lifecycleSet);
    expect(seed).toBeGreaterThan(markerPut);
    expect(calls[seed]?.args).not.toContain("--delete");
  });

  it("repairs seed objects that ordinary sync leaves missing or changed", async () => {
    const missing = inventoryEntry({
      etag: '"11111111111111111111111111111111"',
      key: `${PRIVATE_KEY}-missing #1`,
    });
    const changed = inventoryEntry({ etag: '"ffffffffffffffffffffffffffffffff"' });
    const logs: string[] = [];
    const { calls, runner } = createMockRunner({
      destinationInventory: [changed, markerEntry()],
      seedSyncLeavesKeys: [PRIVATE_KEY, missing.key],
      sourceInventory: [inventoryEntry(), missing],
    });
    await runR2BundlesMigration(options({
      apply: true,
      confirmDestination: DESTINATION_BUCKET,
    }), migrationEnvironment(), {
      log: (message) => logs.push(message),
      runner,
    });

    const repairs = calls.filter((call) =>
      call.command === "aws" && call.args[1] === "copy-object");
    expect(repairs).toHaveLength(2);
    for (const repair of repairs) {
      expect(repair.args).toContain("--copy-source");
      expect(repair.args).toContain("--key");
      expect(repair.args.slice(
        repair.args.indexOf("--metadata-directive"),
        repair.args.indexOf("--metadata-directive") + 2,
      )).toEqual(["--metadata-directive", "COPY"]);
      expect(repair.args.slice(
        repair.args.indexOf("--storage-class"),
        repair.args.indexOf("--storage-class") + 2,
      )).toEqual(["--storage-class", "STANDARD"]);
    }
    const specialKeyRepair = repairs.find((repair) => repair.args.includes(missing.key));
    if (!specialKeyRepair) throw new Error("Special-key repair call was not observed.");
    expect(specialKeyRepair.args.slice(
      specialKeyRepair.args.indexOf("--copy-source"),
      specialKeyRepair.args.indexOf("--copy-source") + 2,
    )).toEqual(["--copy-source", `${SOURCE_BUCKET}/${missing.key}`]);
    expect(logs).toContain("Deterministically repaired 2 object(s).");
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
      seedSyncLeavesKeys: [PRIVATE_KEY],
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

    expect(message).toBe("R2 deterministic copy repair failed.");
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

  it.each([
    ["without a marker", []],
    ["with the exact pair marker", [markerEntry()]],
  ])("verifies an exact mirror %s", async (_label, markers) => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), ...markers],
    });
    await runR2BundlesMigration(options({ phase: "verify" }), migrationEnvironment(), {
      log: () => undefined,
      runner,
    });
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it.each([
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
  ])("rejects a %s destination marker during verify", async (_label, markers) => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [inventoryEntry(), ...markers],
    });
    await expect(runR2BundlesMigration(
      options({ phase: "verify" }),
      migrationEnvironment(),
      { log: () => undefined, runner },
    )).rejects.toThrow("provenance marker does not match");
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it.each([
    ["missing", []],
    ["changed", [inventoryEntry({ etag: '"ffffffffffffffffffffffffffffffff"' })]],
  ])("refuses %s frozen-source coverage before final mutation", async (_label, objects) => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [...objects, markerEntry()],
    });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDeleteSet: `0:${"0".repeat(64)}`,
      confirmDestination: DESTINATION_BUCKET,
      phase: "final",
      sourceFrozen: true,
    }), migrationEnvironment(), { log: () => undefined, runner })).rejects.toThrow(
      "Destination is not fully seeded from the frozen source",
    );
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("hashes only application extras, then performs one marker-preserving final sync", async () => {
    const extra = inventoryEntry({ key: "obsolete-object" });
    const destination = [inventoryEntry(), extra, markerEntry()];
    const dryRun = createMockRunner({ destinationInventory: destination });
    const logs: string[] = [];
    await runR2BundlesMigration(options({ phase: "final" }), migrationEnvironment(), {
      log: (message) => logs.push(message),
      runner: dryRun.runner,
    });
    const token = /Delete-set confirmation: (\d+:[a-f0-9]{64})/u.exec(logs.join("\n"))?.[1];
    const expectedToken = compareR2ObjectInventories(
      [inventoryEntry()],
      [inventoryEntry(), extra],
    ).deleteSetConfirmation;
    expect(token).toBe(expectedToken);
    expect(token).toMatch(/^1:/u);

    const rejected = createMockRunner({ destinationInventory: destination });
    await expect(runR2BundlesMigration(options({
      apply: true,
      confirmDeleteSet: `1:${"0".repeat(64)}`,
      confirmDestination: DESTINATION_BUCKET,
      phase: "final",
      sourceFrozen: true,
    }), migrationEnvironment(), { log: () => undefined, runner: rejected.runner })).rejects.toThrow(
      "does not match",
    );
    expect(rejected.calls.some((call) => call.args[0] === "s3")).toBe(false);

    const applied = createMockRunner({ destinationInventory: destination });
    if (token === undefined) throw new Error("Final dry run did not report a deletion token.");
    await runR2BundlesMigration(options({
      apply: true,
      confirmDeleteSet: token,
      confirmDestination: DESTINATION_BUCKET,
      phase: "final",
      sourceFrozen: true,
    }), migrationEnvironment(), { log: () => undefined, runner: applied.runner });
    const mutations = applied.calls.filter((call) => call.args[0] === "s3");
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.args).toContain("--delete");
    expect(mutations[0]?.args).not.toContain("cp");
    expect(mutations[0]?.args).toContain("--exclude");
    expect(mutations[0]?.args).toContain(MARKER_KEY);
    expect(applied.calls.some((call) => call.args[1] === "delete-object")).toBe(false);
  });

  it("keeps credentials out of arguments and limits each child environment", async () => {
    const { calls, runner } = createMockRunner({
      destinationInventory: [
        inventoryEntry({ etag: '"ffffffffffffffffffffffffffffffff"' }),
        markerEntry(),
      ],
      seedSyncLeavesKeys: [PRIVATE_KEY],
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

  it("pins AWS copy to classic single-CopyObject behavior", async () => {
    const config = await readFile(
      new URL("../scripts/r2-bundles-migration.aws-config", import.meta.url),
      "utf8",
    );
    expect(config).toContain("preferred_transfer_client = classic");
    expect(config).toContain("multipart_threshold = 5TB");
  });
});

function mutationCalls(
  calls: ReadonlyArray<{ args: readonly string[]; command: string }>,
): Array<{ args: readonly string[]; command: string }> {
  return calls.filter((call) =>
    (call.command === "aws" && (
      call.args[0] === "s3"
      || (call.args[0] === "s3api" && call.args[1] !== "list-objects-v2")
    ))
    || (call.command === "pnpm"
      && call.args.includes("lifecycle")
      && call.args.includes("set")));
}
