import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test, vi } from "vitest";

import {
  CONTRACT_SCHEMA_VERSION,
  CURRENT_VAULT_FORMAT_VERSION,
  LEGACY_VAULT_FORMAT_VERSION,
  type EventRecord,
  type IntegrationIngestRecord,
  type JsonObject,
  type RawImportManifest,
  type RawImportManifestArtifact,
} from "@murphai/contracts";

import {
  detectIntegrationIngestMigration,
  detectWearableStorageMigrationCandidates,
  hashWearableRawPayload,
  importDeviceBatch,
  initializeVault,
  MAX_INTEGRATION_EVIDENCE_PART_BYTES,
  pruneWearableDenseRawTimeseries,
  readIntegrationIngestById,
  readJsonlRecords,
  runIntegrationIngestMigration,
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
  const vaultRoot = await createRawArtifactFixture({
    rawArtifactMetadata: {
      artifactClass: "dense_provider_timeseries",
      resource: "heart_rate",
      resourceCategory: "timeseries",
      retentionClass: "debug_temporary",
    },
  });

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
  const manifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"), "utf8")),
  );
  const tombstonedArtifact = manifest.artifacts.find((artifact) =>
    artifact.relativePath.endsWith("/01-provider-timeseries-heart-rate.json")
  );
  const tombstonedProvenance = readRawArtifactProvenanceEntries(manifest)[0];
  assert.ok(tombstonedArtifact);
  assert.ok(tombstonedProvenance);
  assert.equal(tombstonedProvenance.role, tombstonedArtifact.role);
  assert.equal(tombstonedProvenance.sha256, tombstonedArtifact.sha256);
  assert.equal(tombstonedProvenance.metadata, undefined);
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

test("integration ingest migration bounds legacy bundle processing per pass", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-migration-bounded");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  await writeLegacyVaultFormat(vaultRoot);

  const firstBundle = await writeLegacyIntegrationBundle({
    vaultRoot,
    importId: "xfm_11111111111111111111111111",
    importedAt: "2026-05-01T00:00:00.000Z",
    resource: "heart_rate",
  });
  const secondBundle = await writeLegacyIntegrationBundle({
    vaultRoot,
    importId: "xfm_22222222222222222222222222",
    importedAt: "2026-05-02T00:00:00.000Z",
    resource: "steps",
  });

  const detection = await detectIntegrationIngestMigration({ vaultRoot, maxBundles: 1 });
  assert.equal(detection.candidateBundleCount, 1);
  assert.equal(detection.hasMore, true);

  const firstResult = await runIntegrationIngestMigration({
    vaultRoot,
    apply: true,
    maxBundles: 1,
  });

  assert.equal(firstResult.appendedBundleCount, 1);
  assert.equal(firstResult.deletedFileCount, 2);
  assert.equal(firstResult.finalized, false);
  assert.ok(await readIntegrationIngestById(vaultRoot, firstBundle.importId));
  assert.equal(await fileExists(path.join(vaultRoot, firstBundle.artifactPath)), false);
  assert.equal(await fileExists(path.join(vaultRoot, secondBundle.artifactPath)), true);
  assert.equal((await readVaultMetadataFormatVersion(vaultRoot)), LEGACY_VAULT_FORMAT_VERSION);

  const secondResult = await runIntegrationIngestMigration({
    vaultRoot,
    apply: true,
    maxBundles: 1,
  });

  assert.equal(secondResult.appendedBundleCount, 1);
  assert.equal(secondResult.deletedFileCount, 2);
  assert.equal(secondResult.finalized, true);
  assert.ok(await readIntegrationIngestById(vaultRoot, secondBundle.importId));
  assert.equal((await readVaultMetadataFormatVersion(vaultRoot)), CURRENT_VAULT_FORMAT_VERSION);
});

test("integration ingest migration finalizes empty legacy vaults and is idempotent", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-migration-empty-finalize");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  await writeLegacyVaultFormat(vaultRoot);
  await fs.rm(path.join(vaultRoot, "ledger/integration-ingests"), { recursive: true, force: true });

  const result = await runIntegrationIngestMigration({
    vaultRoot,
    apply: true,
  });

  assert.equal(result.mode, "apply");
  assert.equal(result.mutated, true);
  assert.equal(result.appendedBundleCount, 0);
  assert.equal(result.deletedFileCount, 0);
  assert.equal(result.finalized, true);
  assert.equal(result.storedFormatVersion, CURRENT_VAULT_FORMAT_VERSION);
  assert.equal(await readVaultMetadataFormatVersion(vaultRoot), CURRENT_VAULT_FORMAT_VERSION);
  assert.equal(await fileExists(path.join(vaultRoot, "ledger/integration-ingests")), true);
  assert.equal((await validateVault({ vaultRoot })).valid, true);

  const rerun = await runIntegrationIngestMigration({
    vaultRoot,
    apply: true,
  });

  assert.equal(rerun.mode, "apply");
  assert.equal(rerun.mutated, false);
  assert.equal(rerun.finalized, false);
  assert.equal(rerun.hasWork, false);
  assert.equal(rerun.storedFormatVersion, CURRENT_VAULT_FORMAT_VERSION);
  assert.deepEqual(rerun.auditPaths, []);
});

test("integration ingest migration restores legacy metadata when final validation fails", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-migration-finalize-rollback");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  await writeLegacyVaultFormat(vaultRoot);
  await fs.rm(path.join(vaultRoot, "ledger/integration-ingests"), { recursive: true, force: true });
  await fs.mkdir(path.join(vaultRoot, "raw/documents/bad-raw"), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, "raw/documents/bad-raw/payload.json"), "{}\n", "utf8");

  await assert.rejects(
    () =>
      runIntegrationIngestMigration({
        vaultRoot,
        apply: true,
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "INTEGRATION_INGEST_MIGRATION_INVALID_VAULT");
      return true;
    },
  );

  assert.equal(await readVaultMetadataFormatVersion(vaultRoot), LEGACY_VAULT_FORMAT_VERSION);
});

test("integration ingest migration no-ops current vaults without reading event shards", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-migration-v2-noop");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  await fs.mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, "ledger/events/2026/2026-05.jsonl"), "not-json\n", "utf8");

  const result = await runIntegrationIngestMigration({
    vaultRoot,
    apply: true,
  });

  assert.equal(result.mode, "apply");
  assert.equal(result.storedFormatVersion, CURRENT_VAULT_FORMAT_VERSION);
  assert.equal(result.mutated, false);
  assert.equal(result.finalized, false);
  assert.equal(result.hasWork, false);
});

test("integration ingest migration rewrites event rawRefs before deleting legacy files and finalizing", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-migration-event-rewrite");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  await writeLegacyVaultFormat(vaultRoot);

  const bundle = await writeLegacyIntegrationBundle({
    eventCount: 1,
    vaultRoot,
    importId: "xfm_33333333333333333333333333",
    importedAt: "2026-05-03T00:00:00.000Z",
    resource: "sleep",
  });
  const eventId = "evt_33333333333333333333333333";
  const eventShardPath = await writeLegacyDeviceEventRawRef({
    eventId,
    rawRef: bundle.artifactPath,
    vaultRoot,
  });

  const result = await runIntegrationIngestMigration({
    apply: true,
    vaultRoot,
  });

  assert.equal(result.appendedBundleCount, 1);
  assert.equal(result.detachedEventRowCount, 1);
  assert.equal(result.deletedFileCount, 2);
  assert.equal(result.finalized, true);
  assert.equal(await readVaultMetadataFormatVersion(vaultRoot), CURRENT_VAULT_FORMAT_VERSION);
  assert.equal(await fileExists(path.join(vaultRoot, bundle.artifactPath)), false);
  assert.equal(await fileExists(path.join(vaultRoot, bundle.manifestPath)), false);

  const migrated = await readIntegrationIngestById(vaultRoot, bundle.importId);
  assert.ok(migrated);
  assert.deepEqual(migrated.record.outputs.events, [
    { id: eventId, roles: [bundle.artifactRole] },
  ]);
  assert.equal(migrated.record.counts.eventCount, 1);
  assert.equal(migrated.record.outputs.eventIdsComplete, true);
  assert.equal(migrated.record.parts[0]?.role, bundle.artifactRole);
  assert.match(migrated.relativePath, /^ledger\/integration-ingests\/2026\/2026-05\.jsonl$/u);

  const rewrittenEvents = (await readJsonlRecords({ vaultRoot, relativePath: eventShardPath })) as EventRecord[];
  assert.equal(rewrittenEvents.length, 1);
  assert.equal(rewrittenEvents[0]?.id, eventId);
  assert.equal(Object.hasOwn(rewrittenEvents[0] ?? {}, "rawRefs"), false);
});

test("integration ingest migration fails closed on unverified legacy inputs", async () => {
  const cases: Array<{
    expectedCode: string;
    label: string;
    mutate: (input: { bundle: Awaited<ReturnType<typeof writeLegacyIntegrationBundle>>; vaultRoot: string }) => Promise<void>;
  }> = [
    {
      expectedCode: "LEGACY_UNMANIFESTED_FILE",
      label: "unmanifested file",
      mutate: async ({ bundle, vaultRoot }) => {
        await fs.writeFile(path.join(vaultRoot, bundle.rawDirectory, "unknown.json"), "{}\n", "utf8");
      },
    },
    {
      expectedCode: "LEGACY_REFERENCE_UNRESOLVED",
      label: "unresolved historical rawRef",
      mutate: async ({ bundle, vaultRoot }) => {
        await writeLegacyDeviceEventRawRef({
          eventId: "evt_44444444444444444444444444",
          rawRef: `${bundle.rawDirectory}/missing.json`,
          vaultRoot,
        });
      },
    },
    {
      expectedCode: "LEGACY_REFERENCE_UNRESOLVED",
      label: "historical manifest rawRef",
      mutate: async ({ bundle, vaultRoot }) => {
        await writeLegacyDeviceEventRawRef({
          eventId: "evt_44444444444444444444444444",
          rawRef: bundle.manifestPath,
          vaultRoot,
        });
      },
    },
    {
      expectedCode: "LEGACY_REFERENCE_UNRESOLVED",
      label: "historical receipt rawRef",
      mutate: async ({ bundle, vaultRoot }) => {
        const receiptPath = await appendLegacyBundleArtifact({
          bundle,
          content: {
            schemaVersion: "wearable.raw_ingest_receipt.v1",
            id: "wearable_raw_aaaaaaaaaaaaaaaaaaaaaaaa",
            provider: "wearable-provider",
            sourceKind: "poll",
            deliveryMode: "full_payload",
            observedAt: "2026-05-04T00:00:00.000Z",
            payloadHash: "0".repeat(64),
          },
          fileName: "receipt.json",
          role: "wearable-raw-receipt:wearable_raw_aaaaaaaaaaaaaaaaaaaaaaaa",
          vaultRoot,
        });
        await writeLegacyDeviceEventRawRef({
          eventId: "evt_44444444444444444444444444",
          rawRef: receiptPath,
          vaultRoot,
        });
      },
    },
    {
      expectedCode: "LEGACY_ARTIFACT_MISSING",
      label: "symlink artifact",
      mutate: async ({ bundle, vaultRoot }) => {
        const outsideFile = path.join(vaultRoot, "outside-symlink-target.json");
        await fs.writeFile(outsideFile, "{}\n", "utf8");
        await fs.rm(path.join(vaultRoot, bundle.artifactPath));
        await fs.symlink(outsideFile, path.join(vaultRoot, bundle.artifactPath));
      },
    },
    {
      expectedCode: "LEGACY_RECEIPT_INVALID",
      label: "invalid receipt",
      mutate: async ({ bundle, vaultRoot }) => {
        await appendLegacyBundleArtifact({
          bundle,
          content: { schemaVersion: "wearable.raw_ingest_receipt.v1", provider: "wearable-provider" },
          fileName: "receipt.json",
          role: "wearable-raw-receipt:wearable_raw_bad",
          vaultRoot,
        });
      },
    },
    {
      expectedCode: "LEGACY_ARTIFACT_HASH_MISMATCH",
      label: "size or hash mismatch",
      mutate: async ({ bundle, vaultRoot }) => {
        await fs.writeFile(path.join(vaultRoot, bundle.artifactPath), "{\"changed\":true}\n", "utf8");
      },
    },
    {
      expectedCode: "JOURNAL_ROW_CONFLICT",
      label: "existing journal conflict",
      mutate: async ({ bundle, vaultRoot }) => {
        await writeConflictingIntegrationJournalRow({
          importId: bundle.importId,
          importedAt: "2026-05-04T00:00:00.000Z",
          vaultRoot,
        });
      },
    },
  ];

  for (const testCase of cases) {
    const vaultRoot = await makeTempDirectory(`murph-integration-ingest-migration-${testCase.label.replaceAll(" ", "-")}`);
    await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
    await writeLegacyVaultFormat(vaultRoot);
    const bundle = await writeLegacyIntegrationBundle({
      vaultRoot,
      importId: "xfm_44444444444444444444444444",
      importedAt: "2026-05-04T00:00:00.000Z",
      resource: "heart_rate",
    });
    await testCase.mutate({ bundle, vaultRoot });

    const detection = await detectIntegrationIngestMigration({ vaultRoot });
    assert.equal(detection.blockersByCode[testCase.expectedCode], 1, testCase.label);

    const result = await runIntegrationIngestMigration({
      apply: true,
      vaultRoot,
    });

    assert.equal(result.mutated, false, testCase.label);
    assert.equal(result.finalized, false, testCase.label);
    assert.equal(result.blockersByCode[testCase.expectedCode], 1, testCase.label);
    assert.equal(await readVaultMetadataFormatVersion(vaultRoot), LEGACY_VAULT_FORMAT_VERSION, testCase.label);
    assert.equal(await fileExists(path.join(vaultRoot, bundle.manifestPath)), true, testCase.label);
  }
});

test("integration ingest migration reports oversized legacy evidence as a blocker", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-oversized-legacy");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  await writeLegacyVaultFormat(vaultRoot);
  const bundle = await writeLegacyIntegrationBundle({
    vaultRoot,
    importId: IMPORT_ID,
    importedAt: IMPORTED_AT,
    resource: "heart_rate",
  });
  await replaceLegacyBundleArtifactText({
    artifactPath: bundle.artifactPath,
    bundle,
    text: "a".repeat(MAX_INTEGRATION_EVIDENCE_PART_BYTES + 1),
    vaultRoot,
  });

  const detection = await detectIntegrationIngestMigration({ vaultRoot });
  assert.equal((detection.blockersByCode.MIGRATION_EVIDENCE_TOO_LARGE ?? 0) > 0, true);
  assert.equal(detection.copiedBundleCount, 0);

  const result = await runIntegrationIngestMigration({ vaultRoot, apply: true });
  assert.equal(result.mutated, false);
  assert.equal((result.blockersByCode.MIGRATION_EVIDENCE_TOO_LARGE ?? 0) > 0, true);
  assert.equal(await readVaultMetadataFormatVersion(vaultRoot), LEGACY_VAULT_FORMAT_VERSION);
}, 30_000);

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

test("pruneWearableDenseRawTimeseries runs only old dense raw retention", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-distance",
    denseSampleValues: Array.from({ length: 512 }, (_, index) => index),
  });
  await createLegacyReceiptPayloadFixture(vaultRoot);

  const result = await pruneWearableDenseRawTimeseries({
    maxFiles: 5,
    now: REPAIR_NOW,
    vaultRoot,
  });

  assert.equal(result.compactedReceiptCount, 0);
  assert.equal(result.tombstonedCanonicalArtifactCount, 0);
  assert.equal(result.tombstonedDenseRawArtifactCount, 1);
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "02-legacy-raw-ingest-envelope.json"), "utf8"),
    /payload/u,
  );
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "03-canonical-wearable-records.json"), "utf8"),
    /sampleValues/u,
  );
});

test("dense raw pruning allows one oversized candidate to avoid no-progress loops", async () => {
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

  assert.equal(result.mutated, true);
  assert.equal(result.hasMore, false);
  assert.equal(result.tombstonedDenseRawArtifactCount, 1);
  assert.ok(result.denseRawBytesBefore > 1);
  assert.ok(result.denseRawBytesFreed > 0);
  const rawTombstone = JSON.parse(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(rawTombstone.schemaVersion, "wearable.dense_provider_timeseries_pruned.v1");
});

test("dense raw pruning reports more work after one oversized progress candidate", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-heartrate",
    denseSampleValues: Array.from({ length: 512 }, (_, index) => index),
  });
  await addSecondDenseRawArtifact(vaultRoot);

  const result = await runWearableStorageMigrationPass({
    maxBytes: 1,
    maxFiles: 5,
    now: REPAIR_NOW,
    pruneDenseRaw: true,
    repairClasses: ["dense_raw_timeseries"],
    vaultRoot,
  });

  assert.equal(result.mutated, true);
  assert.equal(result.hasMore, true);
  assert.equal(result.tombstonedDenseRawArtifactCount, 1);
});

test("dense raw pruning never stages manifest changes for deadline-rejected candidates", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-heartrate",
    denseSampleValues: Array.from({ length: 512 }, (_, index) => index),
  });
  await addSecondDenseRawArtifact(vaultRoot);

  let nowCallCount = 0;
  const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
    nowCallCount += 1;
    return nowCallCount >= 65 ? 2 : 0;
  });

  try {
    const result = await runWearableStorageMigrationPass({
      deadlineMs: 1,
      includeRecentDenseRaw: true,
      maxFiles: 5,
      now: REPAIR_NOW,
      pruneDenseRaw: true,
      repairClasses: ["dense_raw_timeseries"],
      vaultRoot,
    });

    assert.equal(result.tombstonedDenseRawArtifactCount, 1);
    assert.equal(result.hasMore, true);
  } finally {
    dateNow.mockRestore();
  }

  await assertManifestArtifactMatchesFile(vaultRoot, "01-provider-timeseries-heart-rate.json");
  await assertManifestArtifactMatchesFile(vaultRoot, "04-provider-timeseries-steps.json");
  const manifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"), "utf8")),
  );
  const secondArtifact = manifest.artifacts.find((artifact) =>
    artifact.relativePath.endsWith("/04-provider-timeseries-steps.json")
  );
  assert.equal(secondArtifact?.role, "junction-timeseries-steps");
  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "04-provider-timeseries-steps.json"), "utf8"),
    /sampleValues/u,
  );
});

test("dense raw pruning skips manifest scans when the deadline is already exhausted", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-heartrate",
    denseSampleValues: Array.from({ length: 512 }, (_, index) => index),
  });
  const readFile = vi.spyOn(fs, "readFile");

  try {
    const result = await runWearableStorageMigrationPass({
      deadlineMs: 0,
      maxFiles: 5,
      now: REPAIR_NOW,
      pruneDenseRaw: true,
      repairClasses: ["dense_raw_timeseries"],
      vaultRoot,
    });

    assert.equal(result.mutated, false);
    assert.equal(result.hasMore, false);
    assert.equal(result.tombstonedDenseRawArtifactCount, 0);
    assert.equal(
      readFile.mock.calls.some(([file]) => String(file).endsWith("manifest.json")),
      false,
    );
  } finally {
    readFile.mockRestore();
  }

  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    /sampleValues/u,
  );
});

test("dense raw pruning reports interrupted proof without tombstoning", async () => {
  const vaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-heartrate",
    denseSampleValues: Array.from({ length: 512 }, (_, index) => index),
  });
  let nowCallCount = 0;
  const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
    nowCallCount += 1;
    return nowCallCount >= 3 ? 2 : 0;
  });

  try {
    const result = await runWearableStorageMigrationPass({
      deadlineMs: 1,
      maxFiles: 5,
      now: REPAIR_NOW,
      pruneDenseRaw: true,
      repairClasses: ["dense_raw_timeseries"],
      vaultRoot,
    });

    assert.equal(result.mutated, false);
    assert.equal(result.hasMore, true);
    assert.equal(result.tombstonedDenseRawArtifactCount, 0);
    assert.equal(result.touchedPaths.length, 0);
  } finally {
    dateNow.mockRestore();
  }

  assert.match(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "01-provider-timeseries-heart-rate.json"), "utf8"),
    /sampleValues/u,
  );
  await assertManifestArtifactMatchesFile(vaultRoot, "01-provider-timeseries-heart-rate.json");
});

test("dense raw classifier uses retention metadata before role fallback", async () => {
  const metadataDenseVaultRoot = await createRawArtifactFixture({
    denseRole: "provider-debug-payload",
    rawArtifactMetadata: {
      artifactClass: "dense_provider_timeseries",
      resource: "heartrate",
      resourceCategory: "timeseries",
      retentionClass: "debug_temporary",
    },
  });
  const metadataDenseDetection = await detectWearableStorageMigrationCandidates({
    now: REPAIR_NOW,
    vaultRoot: metadataDenseVaultRoot,
  });
  assert.equal(metadataDenseDetection.denseProviderRawTimeseriesCount, 1);

  const metadataSparseVaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-heartrate",
    rawArtifactMetadata: {
      artifactClass: "sparse_provider_timeseries",
      resource: "heartrate",
      resourceCategory: "timeseries",
      retentionClass: "provider_evidence",
    },
  });
  const metadataSparseDetection = await detectWearableStorageMigrationCandidates({
    includeRecentDenseRaw: true,
    now: REPAIR_NOW,
    vaultRoot: metadataSparseVaultRoot,
  });
  assert.equal(metadataSparseDetection.denseProviderRawTimeseriesCount, 0);

  const incompleteMetadataVaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-heartrate",
    rawArtifactMetadata: {
      artifactClass: "sparse_provider_timeseries",
    },
  });
  const incompleteMetadataDetection = await detectWearableStorageMigrationCandidates({
    includeRecentDenseRaw: true,
    now: REPAIR_NOW,
    vaultRoot: incompleteMetadataVaultRoot,
  });
  assert.equal(incompleteMetadataDetection.denseProviderRawTimeseriesCount, 0);

  const malformedMetadataVaultRoot = await createRawArtifactFixture({
    denseRole: "junction-timeseries-heartrate",
    rawArtifactMetadata: null,
  });
  const malformedMetadataDetection = await detectWearableStorageMigrationCandidates({
    includeRecentDenseRaw: true,
    now: REPAIR_NOW,
    vaultRoot: malformedMetadataVaultRoot,
  });
  assert.equal(malformedMetadataDetection.denseProviderRawTimeseriesCount, 0);
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

test("raw tombstoning allows one oversized candidate to avoid no-progress loops", async () => {
  const vaultRoot = await createRawArtifactFixture();

  const result = await runWearableStorageMigrationPass({
    maxBytes: 1,
    maxFiles: 1,
    now: REPAIR_NOW,
    vaultRoot,
  });

  assert.equal(result.mutated, true);
  assert.equal(result.hasMore, false);
  assert.equal(result.tombstonedCanonicalArtifactCount, 1);
  assert.ok(result.bytesBefore > 1);
  const rawTombstone = JSON.parse(
    await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "03-canonical-wearable-records.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(rawTombstone.schemaVersion, "wearable.legacy_canonical_records_pruned.v1");
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

test("dense raw timeseries tombstoning treats symlinked ledger shards as blockers", async () => {
  const vaultRoot = await createRawArtifactFixture();
  await runWearableStorageMigrationPass({
    vaultRoot,
    maxFiles: 1,
    now: REPAIR_NOW,
  });
  const rawPath = `${RAW_DIRECTORY}/01-provider-timeseries-heart-rate.json`;
  const eventShardPath = "ledger/events/2026/2026-05.jsonl";
  const externalLedgerPath = path.join(
    await makeTempDirectory("murph-wearable-storage-external-ledger"),
    "external.jsonl",
  );
  await fs.writeFile(externalLedgerPath, `{"rawRef":"elsewhere"}\n`, "utf8");
  await fs.mkdir(path.dirname(path.join(vaultRoot, eventShardPath)), { recursive: true });
  await fs.symlink(externalLedgerPath, path.join(vaultRoot, eventShardPath));

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

async function writeLegacyVaultFormat(vaultRoot: string): Promise<void> {
  const metadataPath = path.join(vaultRoot, "vault.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Record<string, unknown>;
  await fs.writeFile(
    metadataPath,
    `${JSON.stringify({ ...metadata, formatVersion: LEGACY_VAULT_FORMAT_VERSION }, null, 2)}\n`,
    "utf8",
  );
}

async function readVaultMetadataFormatVersion(vaultRoot: string): Promise<unknown> {
  const metadata = JSON.parse(await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8")) as Record<string, unknown>;
  return metadata.formatVersion;
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function writeLegacyIntegrationBundle(input: {
  eventCount?: number;
  vaultRoot: string;
  importId: string;
  importedAt: string;
  resource: string;
  sampleCount?: number;
}): Promise<{
  artifactPath: string;
  artifactRole: string;
  importId: string;
  importedAt: string;
  manifestPath: string;
  rawDirectory: string;
}> {
  const provider = "wearable-provider";
  const rawDirectory = `raw/integrations/${provider}/2026/05/${input.importId}`;
  await fs.mkdir(path.join(input.vaultRoot, rawDirectory), { recursive: true });

  const artifactContent = `${JSON.stringify({ resource: input.resource, values: [1, 2, 3] }, null, 2)}\n`;
  const artifactPath = `${rawDirectory}/payload.json`;
  const artifact: RawImportManifestArtifact = {
    byteSize: Buffer.byteLength(artifactContent, "utf8"),
    mediaType: "application/json",
    originalFileName: "payload.json",
    relativePath: artifactPath,
    role: `provider-${input.resource}`,
    sha256: sha256Hex(artifactContent),
  };
  const manifest: RawImportManifest = {
    artifacts: [artifact],
    importId: input.importId,
    importKind: "device_batch",
    importedAt: input.importedAt,
    owner: {
      id: input.importId,
      kind: "device_batch",
      partition: provider,
    },
    provenance: {
      eventCount: input.eventCount ?? 0,
      provider,
      sampleCount: input.sampleCount ?? 0,
    },
    rawDirectory,
    schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
    source: "device",
  };
  const manifestPath = `${rawDirectory}/manifest.json`;

  await fs.writeFile(path.join(input.vaultRoot, artifactPath), artifactContent, "utf8");
  await fs.writeFile(
    path.join(input.vaultRoot, manifestPath),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return {
    artifactPath,
    artifactRole: artifact.role,
    importId: input.importId,
    importedAt: input.importedAt,
    manifestPath,
    rawDirectory,
  };
}

async function writeLegacyDeviceEventRawRef(input: {
  eventId: string;
  rawRef: string;
  vaultRoot: string;
}): Promise<string> {
  const relativePath = "ledger/events/2026/2026-05.jsonl";
  const record: EventRecord = {
    schemaVersion: CONTRACT_SCHEMA_VERSION.event,
    id: input.eventId,
    kind: "note",
    occurredAt: "2026-05-03T00:00:00.000Z",
    recordedAt: "2026-05-03T00:00:00.000Z",
    dayKey: "2026-05-03",
    timeZone: "UTC",
    source: "device",
    title: "Legacy device event",
    note: "Uses legacy integration raw evidence.",
    rawRefs: [input.rawRef],
  };
  await fs.mkdir(path.join(input.vaultRoot, path.dirname(relativePath)), { recursive: true });
  await fs.appendFile(path.join(input.vaultRoot, relativePath), `${JSON.stringify(record)}\n`, "utf8");
  return relativePath;
}

async function appendLegacyBundleArtifact(input: {
  bundle: Awaited<ReturnType<typeof writeLegacyIntegrationBundle>>;
  content: unknown;
  fileName: string;
  role: string;
  vaultRoot: string;
}): Promise<string> {
  const text = `${JSON.stringify(input.content, null, 2)}\n`;
  const artifactPath = `${input.bundle.rawDirectory}/${input.fileName}`;
  const artifact: RawImportManifestArtifact = {
    byteSize: Buffer.byteLength(text, "utf8"),
    mediaType: "application/json",
    originalFileName: input.fileName,
    relativePath: artifactPath,
    role: input.role,
    sha256: sha256Hex(text),
  };
  await fs.writeFile(path.join(input.vaultRoot, artifactPath), text, "utf8");
  const manifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(path.join(input.vaultRoot, input.bundle.manifestPath), "utf8")),
  );
  await fs.writeFile(
    path.join(input.vaultRoot, input.bundle.manifestPath),
    `${JSON.stringify({ ...manifest, artifacts: [...manifest.artifacts, artifact] }, null, 2)}\n`,
    "utf8",
  );
  return artifactPath;
}

async function replaceLegacyBundleArtifactText(input: {
  artifactPath: string;
  bundle: Awaited<ReturnType<typeof writeLegacyIntegrationBundle>>;
  text: string;
  vaultRoot: string;
}): Promise<void> {
  await fs.writeFile(path.join(input.vaultRoot, input.artifactPath), input.text, "utf8");
  const manifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(path.join(input.vaultRoot, input.bundle.manifestPath), "utf8")),
  );
  for (const artifact of manifest.artifacts) {
    if (artifact.relativePath !== input.artifactPath) {
      continue;
    }
    artifact.byteSize = Buffer.byteLength(input.text, "utf8");
    artifact.sha256 = sha256Hex(input.text);
  }
  await fs.writeFile(
    path.join(input.vaultRoot, input.bundle.manifestPath),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function writeConflictingIntegrationJournalRow(input: {
  importId: string;
  importedAt: string;
  vaultRoot: string;
}): Promise<void> {
  const relativePath = "ledger/integration-ingests/2026/2026-05.jsonl";
  const record: IntegrationIngestRecord = {
    schemaVersion: CONTRACT_SCHEMA_VERSION.integrationIngest,
    id: input.importId,
    provider: "wearable-provider",
    source: "device",
    importedAt: input.importedAt,
    parts: [],
    outputs: {
      events: [],
      eventIdsComplete: true,
      sampleIds: [],
      sampleIdsComplete: true,
    },
    counts: {
      eventCount: 0,
      sampleCount: 0,
    },
  };
  await fs.mkdir(path.join(input.vaultRoot, path.dirname(relativePath)), { recursive: true });
  await fs.writeFile(path.join(input.vaultRoot, relativePath), `${JSON.stringify(record)}\n`, "utf8");
}

async function createRawArtifactFixture(
  options: {
    denseRole?: string;
    denseSampleValues?: number[];
    importedAt?: string;
    rawArtifactMetadata?: JsonObject | null;
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
    rawArtifactMetadata: options.rawArtifactMetadata,
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

async function addSecondDenseRawArtifact(vaultRoot: string): Promise<void> {
  const secondArtifact = await writeRawJsonArtifact({
    content: {
      resource: "steps",
      sampleValues: Array.from({ length: 512 }, (_, index) => index),
    },
    fileName: "04-provider-timeseries-steps.json",
    role: "junction-timeseries-steps",
    vaultRoot,
  });
  await replaceRawArtifactContent(vaultRoot, "02-raw-ingest-receipt.json", {
    payloadHash: "payload_hash",
    rawArtifactCount: 2,
    rawArtifactRoles: [
      "junction-timeseries-heartrate",
      "junction-timeseries-steps",
    ],
    schemaVersion: "wearable.raw_ingest_receipt.v1",
  });
  const manifest = parseRawImportManifest(
    JSON.parse(await fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"), "utf8")),
  );
  await fs.writeFile(
    path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"),
    `${JSON.stringify({
      ...manifest,
      artifacts: [...manifest.artifacts, secondArtifact],
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
  options: {
    importedAt: string;
    rawArtifactMetadata?: JsonObject | null;
  },
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
    provenance: buildManifestProvenance(artifacts, options.rawArtifactMetadata),
    rawDirectory: RAW_DIRECTORY,
    schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
    source: "device",
  };
}

function buildManifestProvenance(
  artifacts: RawImportManifestArtifact[],
  rawArtifactMetadata: JsonObject | null | undefined,
): RawImportManifest["provenance"] {
  if (rawArtifactMetadata === undefined) {
    return {
      provider: "wearable-provider",
    };
  }
  const [rawArtifact] = artifacts;
  assert.ok(rawArtifact);
  return {
    provider: "wearable-provider",
    rawArtifacts: [
      {
        metadata: rawArtifactMetadata,
        relativePath: rawArtifact.relativePath,
        role: rawArtifact.role,
        sha256: rawArtifact.sha256,
      },
    ],
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

function readRawArtifactProvenanceEntries(
  manifest: RawImportManifest,
): Array<Record<string, unknown>> {
  const rawArtifacts = manifest.provenance.rawArtifacts;
  assert.ok(Array.isArray(rawArtifacts));
  return rawArtifacts.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new TypeError("Expected raw artifact provenance entry to be an object.");
    }
    return Object.fromEntries(Object.entries(entry));
  });
}

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
