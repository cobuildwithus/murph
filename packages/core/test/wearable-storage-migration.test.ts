import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import {
  CONTRACT_SCHEMA_VERSION,
  type RawImportManifest,
  type RawImportManifestArtifact,
} from "@murphai/contracts";

import {
  detectWearableStorageMigrationCandidates,
  hashWearableRawPayload,
  importDeviceBatch,
  initializeVault,
  runWearableStorageMigrationPass,
  validateVault,
} from "../src/index.ts";
import { parseRawImportManifest } from "../src/operations/raw-manifests.ts";

const IMPORT_ID = "xfm_FKXWJ9CRVED58RA9QVF2QHA1WE";
const IMPORTED_AT = "2026-05-01T00:00:00.000Z";
const RAW_DIRECTORY = `raw/integrations/wearable-provider/2026/05/${IMPORT_ID}`;
const REPAIR_NOW = new Date("2026-05-23T12:00:00.000Z");

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("runWearableStorageMigrationPass tombstones derived canonical raw artifacts", async () => {
  const vaultRoot = await createRawArtifactFixture();
  const providerBefore = await fs.readFile(
    path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"),
    "utf8",
  );

  const detection = await detectWearableStorageMigrationCandidates({ vaultRoot });
  assert.equal(detection.legacyCanonicalArtifactCount, 1);

  const result = await runWearableStorageMigrationPass({
    vaultRoot,
    now: REPAIR_NOW,
  });

  assert.equal(result.mutated, true);
  assert.equal(result.tombstonedCanonicalArtifactCount, 1);
  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  assert.ok(result.bytesBefore > 0);
  assert.equal(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    providerBefore,
  );

  const canonicalText = await fs.readFile(
    path.join(vaultRoot, RAW_DIRECTORY, "03-canonical-wearable-records.json"),
    "utf8",
  );
  const canonicalTombstone = JSON.parse(canonicalText) as Record<string, unknown>;
  assert.equal(canonicalTombstone.schemaVersion, "wearable.legacy_canonical_records_pruned.v1");
  assert.equal(canonicalTombstone.artifactClass, "derived_canonical_records");
  assert.equal(canonicalTombstone.originalRole, "wearable-canonical-records:wearable_raw_test");
  assert.equal(typeof canonicalTombstone.originalSha256, "string");
  assert.equal(JSON.stringify(canonicalTombstone).includes("sampleValues"), false);

  await assertManifestArtifactMatchesFile(vaultRoot, "03-canonical-wearable-records.json");
  const afterDetection = await detectWearableStorageMigrationCandidates({ vaultRoot });
  assert.equal(afterDetection.legacyCanonicalArtifactCount, 0);
  assert.equal((await validateVault({ vaultRoot })).valid, true);
});

test("dense raw timeseries tombstoning requires explicit prune flag", async () => {
  const vaultRoot = await createRawArtifactFixture();

  const defaultResult = await runWearableStorageMigrationPass({
    vaultRoot,
    maxFiles: 1,
    now: REPAIR_NOW,
  });
  assert.equal(defaultResult.tombstonedDenseRawArtifactCount, 0);

  const denseResult = await runWearableStorageMigrationPass({
    vaultRoot,
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
  });

  assert.equal(denseResult.tombstonedDenseRawArtifactCount, 1);
  const rawText = await fs.readFile(
    path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"),
    "utf8",
  );
  const rawTombstone = JSON.parse(rawText) as Record<string, unknown>;
  assert.equal(rawTombstone.schemaVersion, "wearable.dense_provider_timeseries_pruned.v1");
  assert.equal(rawTombstone.artifactClass, "dense_provider_timeseries");
  assert.equal(rawTombstone.originalRole, "provider-timeseries-heart-rate");
  assert.equal(typeof rawTombstone.originalSha256, "string");
  assert.equal(JSON.stringify(rawTombstone).includes("sampleValues"), false);
  await assertManifestArtifactMatchesFile(vaultRoot, "01-provider-timeseries-heart-rate.json");
  const afterDetection = await detectWearableStorageMigrationCandidates({ vaultRoot });
  assert.equal(afterDetection.denseProviderRawTimeseriesCount, 0);
});

test("Junction dense raw retention covers current high-volume timeseries role variants", async () => {
  const denseRoles = [
    "junction-timeseries-heartrate",
    "junction-timeseries-distance",
    "junction-timeseries-calories-active",
    "junction-timeseries-calories_active",
  ];

  for (const denseRole of denseRoles) {
    const vaultRoot = await createRawArtifactFixture({
      denseRole,
      denseSampleValues: Array.from({ length: 512 }, (_, index) => index),
    });
    const detection = await detectWearableStorageMigrationCandidates({
      now: REPAIR_NOW,
      vaultRoot,
    });

    assert.equal(detection.denseProviderRawTimeseriesCount, 1, denseRole);
    assert.equal(detection.retentionEligibleDenseProviderRawTimeseriesCount, 1, denseRole);
    assert.ok(detection.retentionEligibleDenseProviderRawTimeseriesBytes > 0, denseRole);

    const defaultResult = await runWearableStorageMigrationPass({
      maxFiles: 5,
      now: REPAIR_NOW,
      vaultRoot,
    });
    assert.equal(defaultResult.tombstonedDenseRawArtifactCount, 0, denseRole);

    const denseResult = await runWearableStorageMigrationPass({
      maxFiles: 5,
      now: REPAIR_NOW,
      pruneDenseRaw: true,
      vaultRoot,
    });

    assert.equal(denseResult.tombstonedDenseRawArtifactCount, 1, denseRole);
    assert.ok(denseResult.denseRawBytesBefore > 0, denseRole);
    assert.ok(denseResult.denseRawBytesFreed > 0, denseRole);
    assert.equal(denseResult.bytesFreed >= denseResult.denseRawBytesFreed, true, denseRole);
    const rawTombstone = JSON.parse(
      await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(rawTombstone.schemaVersion, "wearable.dense_provider_timeseries_pruned.v1", denseRole);
    assert.equal(rawTombstone.originalRole, denseRole, denseRole);
  }
});

test("bounded passes report more work when later repair classes remain", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await createLegacyReceiptPayloadFixture(vaultRoot);

  const firstResult = await runWearableStorageMigrationPass({
    maxFiles: 1,
    now: REPAIR_NOW,
    vaultRoot,
  });

  assert.equal(firstResult.compactedReceiptCount, 1);
  assert.equal(firstResult.tombstonedCanonicalArtifactCount, 0);
  assert.equal(firstResult.hasMore, true);

  const secondResult = await runWearableStorageMigrationPass({
    maxFiles: 1,
    now: REPAIR_NOW,
    vaultRoot,
  });

  assert.equal(secondResult.tombstonedCanonicalArtifactCount, 1);
});

test("bounded dense raw passes report more work after canonical budget is consumed", async () => {
  const vaultRoot = await createRawArtifactFixture();

  const firstResult = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 1,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(firstResult.tombstonedCanonicalArtifactCount, 1);
  assert.equal(firstResult.tombstonedDenseRawArtifactCount, 0);
  assert.equal(firstResult.hasMore, true);

  const secondResult = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 1,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(secondResult.tombstonedDenseRawArtifactCount, 1);
});

test("dense raw scoped passes do not mutate broader repair classes", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-distance",
    denseSampleValues: Array.from({ length: 512 }, (_, index) => index),
  });
  await createLegacyReceiptPayloadFixture(vaultRoot);

  const result = await runWearableStorageMigrationPass({
    maxFiles: 1,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    repairClasses: ["dense_raw_timeseries"],
    vaultRoot,
  });

  assert.equal(result.compactedReceiptCount, 0);
  assert.equal(result.tombstonedCanonicalArtifactCount, 0);
  assert.equal(result.tombstonedDenseRawArtifactCount, 1);
  assert.equal(result.hasMore, false);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "02-legacy-raw-ingest-envelope.json"), "utf8"),
    /payload/u,
  );
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "03-canonical-wearable-records.json"), "utf8"),
    /sampleValues/u,
  );
  const rawTombstone = JSON.parse(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(rawTombstone.schemaVersion, "wearable.dense_provider_timeseries_pruned.v1");
});

test("dense raw pruning treats maxBytes as a hard candidate budget", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-distance",
    denseSampleValues: Array.from({ length: 512 }, (_, index) => index),
  });

  const result = await runWearableStorageMigrationPass({
    maxBytes: 1,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    repairClasses: ["dense_raw_timeseries"],
    vaultRoot,
  });

  assert.equal(result.mutated, false);
  assert.equal(result.hasMore, true);
  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  assert.equal(result.denseRawBytesBefore, 0);
  assert.equal(result.denseRawBytesFreed, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    /sampleValues/u,
  );
});

test("dense raw timeseries detection covers non-Junction dense provider roles", async () => {
  const vaultRoot = await createRawArtifactFixture({ denseRole: "heartrate" });

  const detection = await detectWearableStorageMigrationCandidates({
    includeRecentDenseRaw: true,
    now: REPAIR_NOW,
    vaultRoot,
  });

  assert.equal(detection.denseProviderRawTimeseriesCount, 1);
  assert.equal(detection.retentionEligibleDenseProviderRawTimeseriesCount, 1);
});

test("dense raw timeseries tombstoning preserves recent artifacts unless explicitly included", async () => {
  const vaultRoot = await createRawArtifactFixture({
    importedAt: "2026-05-22T00:00:00.000Z",
  });
  await runWearableStorageMigrationPass({
    maxFiles: 1,
    now: REPAIR_NOW,
    vaultRoot,
  });

  const recentResult = await runWearableStorageMigrationPass({
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(recentResult.tombstonedDenseRawArtifactCount, 0);
  assert.equal(recentResult.hasMore, false);
  assert.equal(recentResult.skippedCount, 0);
  const rawPath = path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json");
  assert.match(await fs.readFile(rawPath, "utf8"), /sampleValues/u);

  const explicitRecentResult = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(explicitRecentResult.tombstonedDenseRawArtifactCount, 1);
  const rawTombstone = JSON.parse(await fs.readFile(rawPath, "utf8")) as Record<string, unknown>;
  assert.equal(rawTombstone.schemaVersion, "wearable.dense_provider_timeseries_pruned.v1");
});

test("Junction dense raw retention preserves recent heartrate unless explicitly included", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-heartrate",
    importedAt: "2026-05-22T00:00:00.000Z",
  });

  const detection = await detectWearableStorageMigrationCandidates({
    now: REPAIR_NOW,
    vaultRoot,
  });
  assert.equal(detection.denseProviderRawTimeseriesCount, 1);
  assert.equal(detection.retentionEligibleDenseProviderRawTimeseriesCount, 0);
  assert.equal(detection.retentionEligibleDenseProviderRawTimeseriesBytes, 0);

  const recentResult = await runWearableStorageMigrationPass({
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(recentResult.tombstonedDenseRawArtifactCount, 0);
  assert.equal(recentResult.denseRawBytesFreed, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    /sampleValues/u,
  );
});

test("Junction dense raw retention preserves shared raw artifacts with a recent manifest reference", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-distance",
  });
  await writeAdditionalRawManifest(vaultRoot, (manifest) => ({
    ...manifest,
    importedAt: "2026-05-22T00:00:00.000Z",
  }));

  const detection = await detectWearableStorageMigrationCandidates({
    now: REPAIR_NOW,
    vaultRoot,
  });
  assert.equal(detection.denseProviderRawTimeseriesCount, 1);
  assert.equal(detection.retentionEligibleDenseProviderRawTimeseriesCount, 0);
  assert.equal(detection.retentionEligibleDenseProviderRawTimeseriesBytes, 0);

  const result = await runWearableStorageMigrationPass({
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  assert.equal(result.hasMore, false);
  assert.equal(result.skippedCount, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    /sampleValues/u,
  );

  const explicitRecentResult = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(explicitRecentResult.tombstonedDenseRawArtifactCount, 1);
  await assertManifestArtifactMatchesFile(vaultRoot, "01-provider-timeseries-heart-rate.json");
  await assertManifestArtifactMatchesFile(
    vaultRoot,
    "01-provider-timeseries-heart-rate.json",
    "manifest.shared.json",
  );
});

test("Junction dense raw retention leaves summary artifacts untouched", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-summary-daily-activity",
  });

  const detection = await detectWearableStorageMigrationCandidates({
    includeRecentDenseRaw: true,
    now: REPAIR_NOW,
    vaultRoot,
  });
  assert.equal(detection.denseProviderRawTimeseriesCount, 0);

  const result = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  assert.equal(result.denseRawBytesFreed, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    /sampleValues/u,
  );
  await assertManifestArtifactMatchesFile(vaultRoot, "01-provider-timeseries-heart-rate.json");
});

test("Junction dense raw retention requires timeseries marker for new metric terms", async () => {
  const summaryRoles = [
    "active-calories",
    "active_calories",
    "calories-active",
    "calories_active",
    "distance",
  ];

  for (const denseRole of summaryRoles) {
    const vaultRoot = await createRawArtifactFixture({
      denseRole,
      denseSampleValues: Array.from({ length: 512 }, (_, index) => index),
    });

    const detection = await detectWearableStorageMigrationCandidates({
      includeRecentDenseRaw: true,
      now: REPAIR_NOW,
      vaultRoot,
    });
    assert.equal(detection.denseProviderRawTimeseriesCount, 0, denseRole);
    assert.equal(detection.retentionEligibleDenseProviderRawTimeseriesCount, 0, denseRole);

    const result = await runWearableStorageMigrationPass({
      includeRecentDenseRaw: true,
      maxFiles: 5,
      now: REPAIR_NOW,
      pruneDenseRaw: true,
      repairClasses: ["dense_raw_timeseries"],
      vaultRoot,
    });

    assert.equal(result.tombstonedDenseRawArtifactCount, 0, denseRole);
    assert.equal(result.denseRawBytesFreed, 0, denseRole);
    assert.match(
      await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
      /sampleValues/u,
      denseRole,
    );
  }
});

test("raw tombstoning skips when required evidence files are missing", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await fs.rm(path.join(vaultRoot, RAW_DIRECTORY, "02-raw-ingest-receipt.json"));

  const result = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    validateAfter: false,
    vaultRoot,
  });

  assert.equal(result.mutated, false);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "03-canonical-wearable-records.json"), "utf8"),
    /sampleValues/u,
  );
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    /sampleValues/u,
  );
});

test("dense raw tombstoning requires receipt coverage for the target artifact role", async () => {
  const vaultRoot = await createRawArtifactFixture({
    receiptRawArtifactRoles: ["provider-summary"],
  });
  await runWearableStorageMigrationPass({
    vaultRoot,
    maxFiles: 1,
    now: REPAIR_NOW,
  });

  const result = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    /sampleValues/u,
  );
});

test("dense raw tombstoning requires a recognized wearable receipt schema", async () => {
  const vaultRoot = await createRawArtifactFixture({
    receiptSchemaVersion: "wearable.not_a_receipt.v1",
  });
  await runWearableStorageMigrationPass({
    maxFiles: 1,
    now: REPAIR_NOW,
    vaultRoot,
  });

  const result = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    vaultRoot,
  });

  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    /sampleValues/u,
  );
});

test("canonical tombstoning never treats wearable storage tombstones as provider evidence", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await replaceRawArtifactContent(vaultRoot, "01-provider-timeseries-heart-rate.json", {
    artifactClass: "dense_provider_timeseries",
    originalByteSize: 123,
    originalRole: "provider-timeseries-heart-rate",
    originalSha256: "old-sha",
    prunedAt: REPAIR_NOW.toISOString(),
    reason: "test_prior_tombstone",
    schemaVersion: "wearable.dense_provider_timeseries_pruned.v1",
  });

  const result = await runWearableStorageMigrationPass({
    maxFiles: 5,
    now: REPAIR_NOW,
    vaultRoot,
  });

  assert.equal(result.tombstonedCanonicalArtifactCount, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "03-canonical-wearable-records.json"), "utf8"),
    /sampleValues/u,
  );
});

test("raw tombstoning skips candidates in directories with malformed manifests", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await fs.writeFile(path.join(vaultRoot, RAW_DIRECTORY, "manifest.broken.json"), "{", "utf8");

  const result = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    validateAfter: false,
    vaultRoot,
  });

  assert.equal(result.tombstonedCanonicalArtifactCount, 0);
  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "03-canonical-wearable-records.json"), "utf8"),
    /sampleValues/u,
  );
});

test("raw tombstoning skips candidates in directories with symlinked manifests", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await fs.symlink(
    "manifest.json",
    path.join(vaultRoot, RAW_DIRECTORY, "manifest.symlink.json"),
  );

  const result = await runWearableStorageMigrationPass({
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    validateAfter: false,
    vaultRoot,
  });

  assert.equal(result.tombstonedCanonicalArtifactCount, 0);
  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "03-canonical-wearable-records.json"), "utf8"),
    /sampleValues/u,
  );
});

test("raw tombstoning rejects cross-manifest role disagreement", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await writeAdditionalRawManifest(vaultRoot, (manifest) => ({
    ...manifest,
    artifacts: manifest.artifacts.map((artifact) =>
      artifact.relativePath.endsWith("/03-canonical-wearable-records.json")
        ? { ...artifact, role: "provider-summary-copy" }
        : artifact
    ),
  }));

  const result = await runWearableStorageMigrationPass({
    maxFiles: 5,
    now: REPAIR_NOW,
    vaultRoot,
  });

  assert.equal(result.tombstonedCanonicalArtifactCount, 0);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "03-canonical-wearable-records.json"), "utf8"),
    /sampleValues/u,
  );
});

test("raw tombstoning updates every agreeing manifest for a shared path", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await writeAdditionalRawManifest(vaultRoot, (manifest) => manifest);

  const result = await runWearableStorageMigrationPass({
    maxFiles: 5,
    now: REPAIR_NOW,
    vaultRoot,
  });

  assert.equal(result.tombstonedCanonicalArtifactCount, 1);
  await assertManifestArtifactMatchesFile(vaultRoot, "03-canonical-wearable-records.json", "manifest.json");
  await assertManifestArtifactMatchesFile(
    vaultRoot,
    "03-canonical-wearable-records.json",
    "manifest.shared.json",
  );
});

test("raw tombstoning does not exceed maxBytes for one oversized candidate", async () => {
  const vaultRoot = await createRawArtifactFixture();

  const result = await runWearableStorageMigrationPass({
    maxBytes: 1,
    maxFiles: 1,
    now: REPAIR_NOW,
    vaultRoot,
  });

  assert.equal(result.mutated, false);
  assert.equal(result.hasMore, true);
  assert.equal(result.tombstonedCanonicalArtifactCount, 0);
  assert.equal(result.bytesBefore, 0);
});

test("dense raw timeseries tombstoning treats escaped ledger raw references as blockers", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await runWearableStorageMigrationPass({
    vaultRoot,
    maxFiles: 1,
    now: REPAIR_NOW,
  });
  const rawPath = `${RAW_DIRECTORY}/01-provider-timeseries-heart-rate.json`;
  const eventShardPath = "ledger/events/2026/2026-05.jsonl";
  const escapedRawPath = rawPath.replaceAll("/", "\\/");
  await fs.mkdir(path.dirname(path.join(vaultRoot, eventShardPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `{"rawRef":"${escapedRawPath}"}\n`,
    "utf8",
  );

  const result = await runWearableStorageMigrationPass({
    vaultRoot,
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
  });

  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  const rawText = await fs.readFile(path.join(vaultRoot, rawPath), "utf8");
  assert.match(rawText, /sampleValues/u);
});

test("dense raw timeseries tombstoning treats unicode-escaped ledger raw references as blockers", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await runWearableStorageMigrationPass({
    vaultRoot,
    maxFiles: 1,
    now: REPAIR_NOW,
  });
  const rawPath = `${RAW_DIRECTORY}/01-provider-timeseries-heart-rate.json`;
  const eventShardPath = "ledger/events/2026/2026-05.jsonl";
  const escapedRawPath = rawPath.replaceAll("/", "\\u002f");
  await fs.mkdir(path.dirname(path.join(vaultRoot, eventShardPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `{"rawRef":"${escapedRawPath}"}\n`,
    "utf8",
  );

  const result = await runWearableStorageMigrationPass({
    vaultRoot,
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
  });

  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  const rawText = await fs.readFile(path.join(vaultRoot, rawPath), "utf8");
  assert.match(rawText, /sampleValues/u);
});

test("dense raw timeseries tombstoning treats malformed ledger shards as blockers", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await runWearableStorageMigrationPass({
    vaultRoot,
    maxFiles: 1,
    now: REPAIR_NOW,
  });
  const rawPath = `${RAW_DIRECTORY}/01-provider-timeseries-heart-rate.json`;
  const eventShardPath = "ledger/events/2026/2026-05.jsonl";
  await fs.mkdir(path.dirname(path.join(vaultRoot, eventShardPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `{"rawRef":\n`,
    "utf8",
  );

  const result = await runWearableStorageMigrationPass({
    vaultRoot,
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
  });

  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  assert.ok(result.skippedCount > 0);
  const rawText = await fs.readFile(path.join(vaultRoot, rawPath), "utf8");
  assert.match(rawText, /sampleValues/u);
});

test("canonical raw tombstoning treats malformed ledger shards as blockers", async () => {
  const vaultRoot = await createRawArtifactFixture();
  const canonicalPath = `${RAW_DIRECTORY}/03-canonical-wearable-records.json`;
  const eventShardPath = "ledger/events/2026/2026-05.jsonl";
  await fs.mkdir(path.dirname(path.join(vaultRoot, eventShardPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `{"rawRef":\n`,
    "utf8",
  );

  const result = await runWearableStorageMigrationPass({
    vaultRoot,
    maxFiles: 5,
    now: REPAIR_NOW,
  });

  assert.equal(result.tombstonedCanonicalArtifactCount, 0);
  assert.ok(result.skippedCount > 0);
  const canonicalText = await fs.readFile(path.join(vaultRoot, canonicalPath), "utf8");
  assert.match(canonicalText, /sampleValues/u);
});

test("dense raw timeseries tombstoning treats plain ledger raw references as blockers", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await runWearableStorageMigrationPass({
    vaultRoot,
    maxFiles: 1,
    now: REPAIR_NOW,
  });
  const rawPath = `${RAW_DIRECTORY}/01-provider-timeseries-heart-rate.json`;
  const eventShardPath = "ledger/events/2026/2026-05.jsonl";
  await fs.mkdir(path.dirname(path.join(vaultRoot, eventShardPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `{"rawRef":"${rawPath}"}\n`,
    "utf8",
  );

  const result = await runWearableStorageMigrationPass({
    vaultRoot,
    includeRecentDenseRaw: true,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
  });

  assert.equal(result.tombstonedDenseRawArtifactCount, 0);
  const rawText = await fs.readFile(path.join(vaultRoot, rawPath), "utf8");
  assert.match(rawText, /sampleValues/u);
});

test("detectWearableStorageMigrationCandidates reports dense sample-debug shards without deleting them", async () => {
  const vaultRoot = await makeTempDirectory("murph-wearable-storage-migration");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  const importResult = await importDeviceBatch({
    vaultRoot,
    provider: "wearable-provider",
    importedAt: "2026-05-02T00:00:00.000Z",
    samples: [
      buildHeartRateSample("2026-05-02T00:00:00.000Z", 70),
      buildHeartRateSample("2026-05-02T00:00:01.000Z", 71),
    ],
  });
  const [sampleShardPath] = importResult.sampleShardPaths;
  assert.ok(sampleShardPath);
  const before = await fs.readFile(path.join(vaultRoot, sampleShardPath), "utf8");

  const detection = await detectWearableStorageMigrationCandidates({ vaultRoot });
  assert.equal(detection.denseProviderSampleShardCount, 1);
  assert.equal(detection.hasWork, false);

  const result = await runWearableStorageMigrationPass({
    vaultRoot,
    now: REPAIR_NOW,
  });

  assert.equal(result.mutated, false);
  assert.equal(await fs.readFile(path.join(vaultRoot, sampleShardPath), "utf8"), before);
  assert.equal((await validateVault({ vaultRoot })).valid, true);
});

test("runWearableStorageMigrationPass leaves manual sample shards untouched", async () => {
  const vaultRoot = await makeTempDirectory("murph-wearable-storage-migration");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  const shardPath = "ledger/samples/heart_rate/2026/2026-05.jsonl";
  await fs.mkdir(path.dirname(path.join(vaultRoot, shardPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify({
      ...buildHeartRateSample("2026-05-02T00:00:00.000Z", 70),
      id: "smp_00000000000000000000000000",
      schemaVersion: "murph.sample.v1",
      dayKey: "2026-05-02",
      source: "manual",
      quality: "normalized",
      timeZone: "UTC",
    })}\n`,
    "utf8",
  );

  const before = await fs.readFile(path.join(vaultRoot, shardPath), "utf8");
  const result = await runWearableStorageMigrationPass({
    vaultRoot,
    now: REPAIR_NOW,
  });

  assert.equal(result.mutated, false);
  assert.equal(await fs.readFile(path.join(vaultRoot, shardPath), "utf8"), before);
});

async function createRawArtifactFixture(
  options: {
    denseRole?: string;
    denseSampleValues?: number[];
    importedAt?: string;
    receiptSchemaVersion?: string;
    receiptRawArtifactRoles?: string[];
  } = {},
): Promise<string> {
  const vaultRoot = await makeTempDirectory("murph-wearable-storage-migration");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  await fs.mkdir(path.join(vaultRoot, RAW_DIRECTORY), { recursive: true });

  const artifacts = [
    await writeRawJsonArtifact({
      content: {
        resource: "heart_rate",
        sampleValues: options.denseSampleValues ?? [70, 71, 72],
      },
      fileName: "01-provider-timeseries-heart-rate.json",
      role: options.denseRole ?? "provider-timeseries-heart-rate",
      vaultRoot,
    }),
    await writeRawJsonArtifact({
      content: {
        schemaVersion: options.receiptSchemaVersion ?? "wearable.raw_ingest_receipt.v1",
        payloadHash: "payload_hash",
        rawArtifactCount: (options.receiptRawArtifactRoles ?? [
          options.denseRole ?? "provider-timeseries-heart-rate",
        ]).length,
        rawArtifactRoles: options.receiptRawArtifactRoles ?? [
          options.denseRole ?? "provider-timeseries-heart-rate",
        ],
      },
      fileName: "02-raw-ingest-receipt.json",
      role: "wearable-raw-receipt:wearable_raw_test",
      vaultRoot,
    }),
    await writeRawJsonArtifact({
      content: {
        records: [
          {
            kind: "observation",
            sampleValues: [70, 71, 72],
          },
        ],
      },
      fileName: "03-canonical-wearable-records.json",
      role: "wearable-canonical-records:wearable_raw_test",
      vaultRoot,
    }),
  ];
  const manifest = buildManifest(artifacts, {
    importedAt: options.importedAt ?? IMPORTED_AT,
  });
  await fs.writeFile(
    path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return vaultRoot;
}

async function createLegacyReceiptPayloadFixture(vaultRoot: string): Promise<void> {
  const providerPayload = {
    resource: "heart_rate",
    sampleValues: [70, 71, 72],
  };
  const envelopeArtifact = await writeRawJsonArtifact({
    content: {
      id: "wearable_raw_legacy",
      payload: providerPayload,
      payloadHash: hashWearableRawPayload(providerPayload),
      rawArtifactCount: 1,
      rawArtifactRoles: ["provider-timeseries-heart-rate"],
      schemaVersion: "wearable.raw_ingest.v1",
    },
    fileName: "02-legacy-raw-ingest-envelope.json",
    role: "wearable-raw-envelope:wearable_raw_legacy",
    vaultRoot,
  });
  const manifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"), "utf8")),
  );
  await fs.writeFile(
    path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"),
    `${JSON.stringify({
      ...manifest,
      artifacts: [...manifest.artifacts, envelopeArtifact],
    }, null, 2)}\n`,
    "utf8",
  );
}

async function replaceRawArtifactContent(
  vaultRoot: string,
  fileName: string,
  content: unknown,
): Promise<void> {
  const relativePath = `${RAW_DIRECTORY}/${fileName}`;
  const text = `${JSON.stringify(content, null, 2)}\n`;
  await fs.writeFile(path.join(vaultRoot, relativePath), text, "utf8");
  const manifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"), "utf8")),
  );
  for (const artifact of manifest.artifacts) {
    if (artifact.relativePath !== relativePath) {
      continue;
    }
    artifact.byteSize = Buffer.byteLength(text, "utf8");
    artifact.sha256 = sha256Hex(text);
  }
  await fs.writeFile(
    path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function writeAdditionalRawManifest(
  vaultRoot: string,
  mutate: (manifest: RawImportManifest) => RawImportManifest,
): Promise<void> {
  const manifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"), "utf8")),
  );
  await fs.writeFile(
    path.join(vaultRoot, RAW_DIRECTORY, "manifest.shared.json"),
    `${JSON.stringify(mutate(manifest), null, 2)}\n`,
    "utf8",
  );
}

async function writeRawJsonArtifact(input: {
  content: unknown;
  fileName: string;
  role: string;
  vaultRoot: string;
}): Promise<RawImportManifestArtifact> {
  const content = `${JSON.stringify(input.content, null, 2)}\n`;
  const relativePath = `${RAW_DIRECTORY}/${input.fileName}`;
  await fs.writeFile(path.join(input.vaultRoot, relativePath), content, "utf8");
  return {
    byteSize: Buffer.byteLength(content, "utf8"),
    mediaType: "application/json",
    originalFileName: input.fileName,
    relativePath,
    role: input.role,
    sha256: sha256Hex(content),
  };
}

function buildManifest(
  artifacts: RawImportManifestArtifact[],
  options: { importedAt: string },
): RawImportManifest {
  return {
    artifacts,
    importId: IMPORT_ID,
    importKind: "device_batch",
    importedAt: options.importedAt,
    owner: {
      id: IMPORT_ID,
      kind: "device_batch",
      partition: "wearable-provider",
    },
    provenance: {
      provider: "wearable-provider",
    },
    rawDirectory: RAW_DIRECTORY,
    schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
    source: "device",
  };
}

function buildHeartRateSample(recordedAt: string, value: number): {
  stream: "heart_rate";
  recordedAt: string;
  unit: "bpm";
  quality: "normalized";
  externalRef: {
    system: string;
    resourceType: string;
    resourceId: string;
    version: string;
  };
  dataOrigin: {
    version: 1;
    aggregatorProvider: string;
    sourceProviderSlug: string;
    sourceType: string;
    sourceInstanceId: string;
  };
  sample: {
    recordedAt: string;
    value: number;
  };
} {
  return {
    stream: "heart_rate",
    recordedAt,
    unit: "bpm",
    quality: "normalized",
    externalRef: {
      system: "wearable-provider",
      resourceType: "timeseries-heart-rate",
      resourceId: "day-2026-05-02",
      version: "2026-05-02",
    },
    dataOrigin: {
      version: 1,
      aggregatorProvider: "wearable-aggregator",
      sourceProviderSlug: "wearable-provider",
      sourceType: "watch",
      sourceInstanceId: "device-test",
    },
    sample: {
      recordedAt,
      value,
    },
  };
}

async function assertManifestArtifactMatchesFile(
  vaultRoot: string,
  fileName: string,
  manifestFileName = "manifest.json",
): Promise<void> {
  const manifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, manifestFileName), "utf8")),
  );
  const artifact = manifest.artifacts.find((entry) => entry.relativePath.endsWith(`/${fileName}`));
  assert.ok(artifact);
  const content = await fs.readFile(path.join(vaultRoot, artifact.relativePath));
  assert.equal(content.byteLength, artifact.byteSize);
  assert.equal(sha256Hex(content), artifact.sha256);
}

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
