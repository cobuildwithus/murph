import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import type { EventRecord, RawImportManifestArtifact } from "@murphai/contracts";

import {
  buildIntegrationIngestRecord,
  initializeVault,
  migrateIntegrationStorage,
  readIntegrationIngestById,
  readJsonlRecords,
  stableSerializeIntegrationIngestRecord,
  validateVault,
} from "../src/index.ts";
import { buildRawImportManifest } from "../src/operations/raw-manifests.ts";

const IMPORT_ID = "xfm_01JQ9R7WF97M1WAB2B4QF2Q1AB";
const EVENT_ID = "evt_01JQ9R7WF97M1WAB2B4QF2Q1AC";
const IMPORTED_AT = "2026-03-16T09:30:00.000Z";
const RAW_DIRECTORY = `raw/integrations/whoop/2026/03/${IMPORT_ID}`;
const EVENT_SHARD = "ledger/events/2026/2026-03.jsonl";
const INGEST_SHARD = "ledger/integration-ingests/2026/2026-03.jsonl";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function writeVaultJson(vaultRoot: string, relativePath: string, value: unknown): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeVaultText(vaultRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}

function artifactFor(input: {
  content: string;
  fileName: string;
  rawDirectory?: string;
  role: string;
}): RawImportManifestArtifact {
  const rawDirectory = input.rawDirectory ?? RAW_DIRECTORY;
  return {
    role: input.role,
    relativePath: `${rawDirectory}/${input.fileName}`,
    originalFileName: input.fileName,
    mediaType: "application/json",
    byteSize: Buffer.byteLength(input.content, "utf8"),
    sha256: sha256Hex(input.content),
  };
}

async function createLegacyIntegrationVault(input: {
  corruptArtifact?: boolean;
  eventId?: string;
  formatVersion?: unknown;
  includeReceiptPayload?: boolean;
  importId?: string;
  malformedEventWithRawRef?: boolean;
  omitFormatVersion?: boolean;
  providerContent?: string;
  rawDirectory?: string;
} = {}): Promise<{
  artifact: RawImportManifestArtifact;
  manifestPath: string;
  providerContent: string;
  vaultRoot: string;
}> {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-migration");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const metadata = JSON.parse(await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8")) as Record<string, unknown>;
  const nextMetadata = { ...metadata };
  if (input.omitFormatVersion) {
    delete nextMetadata.formatVersion;
  } else {
    nextMetadata.formatVersion = input.formatVersion ?? 1;
  }
  await writeVaultJson(vaultRoot, "vault.json", nextMetadata);

  const importId = input.importId ?? IMPORT_ID;
  const rawDirectory = input.rawDirectory ?? (importId === IMPORT_ID
    ? RAW_DIRECTORY
    : `raw/integrations/whoop/2026/03/${importId}`);
  const providerContent = input.providerContent ?? '{"id":"sleep-1","score":67}\n';
  const providerArtifact = artifactFor({
    content: providerContent,
    fileName: "01-provider-snapshot.json",
    rawDirectory,
    role: "provider-snapshot",
  });
  const artifacts = [providerArtifact];
  await writeVaultText(
    vaultRoot,
    providerArtifact.relativePath,
    input.corruptArtifact ? '{"id":"sleep-1","score":68}\n' : providerContent,
  );

  if (input.includeReceiptPayload) {
    const receiptContent = `${JSON.stringify({
      schemaVersion: "wearable.raw_ingest_receipt.v1",
      id: "wearable_raw_test",
      provider: "whoop",
      sourceKind: "poll",
      deliveryMode: "full_payload",
      observedAt: IMPORTED_AT,
      payloadHash: "0".repeat(64),
      payload: { secret: "raw" },
    })}\n`;
    const receiptArtifact = artifactFor({
      content: receiptContent,
      fileName: "02-receipt.json",
      rawDirectory,
      role: "wearable-raw-receipt:wearable_raw_test",
    });
    artifacts.push(receiptArtifact);
    await writeVaultText(vaultRoot, receiptArtifact.relativePath, receiptContent);
  }

  const manifest = buildRawImportManifest({
    importId,
    importKind: "device_batch",
    importedAt: IMPORTED_AT,
    owner: {
      kind: "device_batch",
      id: importId,
      partition: "whoop",
    },
    rawDirectory,
    source: "device",
    artifacts,
    provenance: {
      provider: "whoop",
      accountId: "whoop-user-1",
      importedAt: IMPORTED_AT,
      eventCount: 1,
      sampleCount: 0,
      rawArtifacts: [
        {
          role: providerArtifact.role,
          relativePath: providerArtifact.relativePath,
          sha256: providerArtifact.sha256,
          metadata: { upstreamId: "sleep-1" },
        },
      ],
    },
  });
  const manifestPath = `${rawDirectory}/manifest.json`;
  await writeVaultJson(vaultRoot, manifestPath, manifest);

  const eventId = input.eventId ?? EVENT_ID;
  await writeVaultText(
    vaultRoot,
    EVENT_SHARD,
    input.malformedEventWithRawRef
      ? `${JSON.stringify({
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "not_a_real_event_kind",
          rawRefs: [providerArtifact.relativePath],
        })}\n`
      : `${JSON.stringify({
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "note",
          occurredAt: "2026-03-16T09:30:00.000Z",
          recordedAt: "2026-03-16T09:30:00.000Z",
          dayKey: "2026-03-16",
          timeZone: "UTC",
          source: "device",
          title: "Legacy device note",
          note: "legacy",
          rawRefs: [providerArtifact.relativePath],
        } satisfies EventRecord)}\n`,
  );

  return { artifact: providerArtifact, manifestPath, providerContent, vaultRoot };
}

test("migrateIntegrationStorage dry-runs existing v1 integration raw bundles without mutating files", async () => {
  const { artifact, manifestPath, vaultRoot } = await createLegacyIntegrationVault();

  const result = await migrateIntegrationStorage({ vaultRoot });

  assert.equal(result.mode, "dry-run");
  assert.equal(result.mutated, false);
  assert.equal(result.formatVersionBefore, 1);
  assert.equal(result.formatVersionAfter, 2);
  assert.equal(result.legacyBundleCount, 1);
  assert.equal(result.journalAppendCount, 1);
  assert.equal(result.eventShardRewriteCount, 1);
  assert.equal(result.deletedLegacyFileCount, 2);
  assert.equal(result.blockerCount, 0);
  assert.ok(result.touchedPaths.includes(INGEST_SHARD));
  assert.ok(result.touchedPaths.includes(EVENT_SHARD));
  assert.ok(result.touchedPaths.includes(artifact.relativePath));
  assert.ok(result.touchedPaths.includes(manifestPath));
  assert.equal(JSON.parse(await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8")).formatVersion, 1);
  await fs.access(path.join(vaultRoot, artifact.relativePath));
  await fs.access(path.join(vaultRoot, manifestPath));
});

test("migrateIntegrationStorage applies v1 bundle migration byte-for-byte and removes legacy refs", async () => {
  const { artifact, manifestPath, providerContent, vaultRoot } = await createLegacyIntegrationVault();

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

  assert.equal(result.mode, "apply");
  assert.equal(result.mutated, true);
  assert.equal(result.blockerCount, 0);
  assert.equal(JSON.parse(await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8")).formatVersion, 2);
  await assert.rejects(() => fs.access(path.join(vaultRoot, artifact.relativePath)));
  await assert.rejects(() => fs.access(path.join(vaultRoot, manifestPath)));
  await assert.rejects(() => fs.access(path.join(vaultRoot, "raw/integrations")));

  const eventRows = await readJsonlRecords({ vaultRoot, relativePath: EVENT_SHARD }) as EventRecord[];
  assert.equal(Object.hasOwn(eventRows[0] ?? {}, "rawRefs"), false);

  const ingest = await readIntegrationIngestById({ vaultRoot, id: IMPORT_ID });
  assert.ok(ingest);
  assert.equal(ingest.shardPath, INGEST_SHARD);
  assert.equal(ingest.record.parts.length, 1);
  assert.equal(ingest.record.parts[0]?.role, "provider-snapshot");
  assert.equal(ingest.record.parts[0]?.fileName, "01-provider-snapshot.json");
  assert.equal(ingest.record.parts[0]?.content, providerContent);
  assert.equal(ingest.record.parts[0]?.byteSize, Buffer.byteLength(providerContent, "utf8"));
  assert.equal(ingest.record.parts[0]?.sha256, artifact.sha256);
  assert.deepEqual(ingest.record.parts[0]?.metadata, { upstreamId: "sleep-1" });
  assert.deepEqual(ingest.record.outputs?.events, [
    { id: EVENT_ID, roles: ["provider-snapshot"] },
  ]);
  assert.deepEqual(ingest.record.counts, {
    eventCount: 1,
    sampleCount: 0,
  });
  assert.equal((await validateVault({ vaultRoot })).valid, true);
});

test("migrateIntegrationStorage preserves BOM-prefixed legacy evidence bytes", async () => {
  const providerContent = '\uFEFF{"id":"sleep-1","score":67}\n';
  const { artifact, vaultRoot } = await createLegacyIntegrationVault({ providerContent });

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

  assert.equal(result.mutated, true);
  const ingest = await readIntegrationIngestById({ vaultRoot, id: IMPORT_ID });
  assert.ok(ingest);
  assert.equal(ingest.record.parts[0]?.content, providerContent);
  assert.equal(ingest.record.parts[0]?.byteSize, Buffer.byteLength(providerContent, "utf8"));
  assert.equal(ingest.record.parts[0]?.sha256, artifact.sha256);
});

test("migrateIntegrationStorage no-ops current vaults without writing audit records", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-current-noop");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

  assert.equal(result.mode, "apply");
  assert.equal(result.mutated, false);
  assert.equal(result.formatVersionBefore, 2);
  assert.equal(result.formatVersionAfter, 2);
  assert.equal(result.legacyBundleCount, 0);
  assert.equal(result.journalAppendCount, 0);
  assert.equal(result.eventShardRewriteCount, 0);
  assert.equal(result.deletedLegacyFileCount, 0);
  assert.equal(result.blockerCount, 0);
  assert.deepEqual(result.touchedPaths, []);
  assert.equal(result.auditPath, null);
});

for (const scenario of [
  { name: "future", formatVersion: 3 },
  { name: "missing", omitFormatVersion: true },
  { name: "non-integer", formatVersion: 1.5 },
  { name: "unrelated old", formatVersion: 0 },
]) {
  test(`migrateIntegrationStorage blocks ${scenario.name} vault format versions`, async () => {
    const { artifact, manifestPath, vaultRoot } = await createLegacyIntegrationVault(scenario);

    const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

    assert.equal(result.mutated, false);
    assert.equal(result.auditPath, null);
    assert.ok(result.blockerCount >= 1);
    assert.ok(result.blockers.some((blocker) => blocker.includes("formatVersion")));
    await fs.access(path.join(vaultRoot, artifact.relativePath));
    await fs.access(path.join(vaultRoot, manifestPath));
    await assert.rejects(() => fs.access(path.join(vaultRoot, INGEST_SHARD)));

    const metadata = JSON.parse(await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8")) as Record<string, unknown>;
    if (scenario.omitFormatVersion) {
      assert.equal(Object.hasOwn(metadata, "formatVersion"), false);
    } else {
      assert.equal(metadata.formatVersion, scenario.formatVersion);
    }
  });
}

test("migrateIntegrationStorage accepts matching duplicate legacy manifests", async () => {
  const { artifact, manifestPath, vaultRoot } = await createLegacyIntegrationVault();
  const duplicateManifestPath = `${RAW_DIRECTORY}/manifest.copy.json`;
  await fs.copyFile(path.join(vaultRoot, manifestPath), path.join(vaultRoot, duplicateManifestPath));

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

  assert.equal(result.mutated, true);
  assert.equal(result.blockerCount, 0);
  assert.equal(result.deletedLegacyFileCount, 3);
  assert.ok(result.touchedPaths.includes(duplicateManifestPath));
  await assert.rejects(() => fs.access(path.join(vaultRoot, artifact.relativePath)));
  await assert.rejects(() => fs.access(path.join(vaultRoot, manifestPath)));
  await assert.rejects(() => fs.access(path.join(vaultRoot, duplicateManifestPath)));
  assert.equal((await validateVault({ vaultRoot })).valid, true);
});

test("migrateIntegrationStorage blocks conflicting duplicate legacy manifests", async () => {
  const { artifact, manifestPath, vaultRoot } = await createLegacyIntegrationVault();
  const duplicateManifestPath = `${RAW_DIRECTORY}/manifest.copy.json`;
  const manifest = JSON.parse(await fs.readFile(path.join(vaultRoot, manifestPath), "utf8")) as Record<string, unknown>;
  await writeVaultJson(vaultRoot, duplicateManifestPath, {
    ...manifest,
    provenance: {
      ...(manifest.provenance as Record<string, unknown>),
      sampleCount: 99,
    },
  });

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

  assert.equal(result.mutated, false);
  assert.ok(result.blockerCount >= 1);
  assert.ok(result.blockers.some((blocker) => blocker.includes("conflicting manifests")));
  await fs.access(path.join(vaultRoot, artifact.relativePath));
  await fs.access(path.join(vaultRoot, manifestPath));
  await fs.access(path.join(vaultRoot, duplicateManifestPath));
});

test("migrateIntegrationStorage blocks duplicate legacy import ids across directories", async () => {
  const { artifact, manifestPath, vaultRoot } = await createLegacyIntegrationVault();
  const duplicateRawDirectory = `raw/integrations/whoop/2026/04/${IMPORT_ID}`;
  const duplicateContent = '{"id":"sleep-2","score":68}\n';
  const duplicateArtifact = artifactFor({
    content: duplicateContent,
    fileName: "01-provider-snapshot.json",
    rawDirectory: duplicateRawDirectory,
    role: "provider-snapshot",
  });
  await writeVaultText(vaultRoot, duplicateArtifact.relativePath, duplicateContent);
  const duplicateManifestPath = `${duplicateRawDirectory}/manifest.json`;
  await writeVaultJson(
    vaultRoot,
    duplicateManifestPath,
    buildRawImportManifest({
      importId: IMPORT_ID,
      importKind: "device_batch",
      importedAt: "2026-04-01T09:30:00.000Z",
      owner: {
        kind: "device_batch",
        id: IMPORT_ID,
        partition: "whoop",
      },
      rawDirectory: duplicateRawDirectory,
      source: "device",
      artifacts: [duplicateArtifact],
      provenance: {
        provider: "whoop",
        accountId: "whoop-user-1",
        importedAt: "2026-04-01T09:30:00.000Z",
        eventCount: 0,
        sampleCount: 0,
        rawArtifacts: [
          {
            role: duplicateArtifact.role,
            relativePath: duplicateArtifact.relativePath,
            sha256: duplicateArtifact.sha256,
          },
        ],
      },
    }),
  );

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true, validateAfter: false });

  assert.equal(result.mutated, false);
  assert.equal(result.auditPath, null);
  assert.ok(result.blockerCount >= 1);
  assert.ok(result.blockers.some((blocker) => blocker.includes("appears in multiple raw integration directories")));
  await fs.access(path.join(vaultRoot, artifact.relativePath));
  await fs.access(path.join(vaultRoot, manifestPath));
  await fs.access(path.join(vaultRoot, duplicateArtifact.relativePath));
  await fs.access(path.join(vaultRoot, duplicateManifestPath));
  await assert.rejects(() => fs.access(path.join(vaultRoot, INGEST_SHARD)));
});

test("migrateIntegrationStorage blocks unknown legacy raw integration files without partial migration", async () => {
  const { artifact, manifestPath, vaultRoot } = await createLegacyIntegrationVault();
  const unknownRawPath = `${RAW_DIRECTORY}/unmanifested-provider-response.json`;
  await writeVaultText(vaultRoot, unknownRawPath, '{"unexpected":true}\n');

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

  assert.equal(result.mutated, false);
  assert.equal(result.auditPath, null);
  assert.ok(result.blockerCount >= 1);
  assert.ok(result.blockers.some((blocker) => blocker.includes("not covered by a verified device manifest")));
  await fs.access(path.join(vaultRoot, artifact.relativePath));
  await fs.access(path.join(vaultRoot, manifestPath));
  await fs.access(path.join(vaultRoot, unknownRawPath));
  await assert.rejects(() => fs.access(path.join(vaultRoot, INGEST_SHARD)));

  const metadata = JSON.parse(await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8")) as Record<string, unknown>;
  assert.equal(metadata.formatVersion, 1);

  const eventRows = await readJsonlRecords({ vaultRoot, relativePath: EVENT_SHARD }) as EventRecord[];
  assert.deepEqual(eventRows[0]?.rawRefs, [artifact.relativePath]);
});

test("migrateIntegrationStorage blocks invalid legacy event rows with integration raw refs", async () => {
  const { artifact, manifestPath, vaultRoot } = await createLegacyIntegrationVault({
    malformedEventWithRawRef: true,
  });

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

  assert.equal(result.mutated, false);
  assert.equal(result.auditPath, null);
  assert.ok(result.blockerCount >= 1);
  assert.ok(result.blockers.some((blocker) => blocker.includes("Invalid event row")));
  await fs.access(path.join(vaultRoot, artifact.relativePath));
  await fs.access(path.join(vaultRoot, manifestPath));
  await assert.rejects(() => fs.access(path.join(vaultRoot, INGEST_SHARD)));

  const eventRows = await readJsonlRecords({ vaultRoot, relativePath: EVENT_SHARD }) as Array<{ rawRefs?: string[] }>;
  assert.deepEqual(eventRows[0]?.rawRefs, [artifact.relativePath]);
});

test("migrateIntegrationStorage blocks corrupted legacy artifact hashes", async () => {
  const { artifact, vaultRoot } = await createLegacyIntegrationVault({ corruptArtifact: true });

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

  assert.equal(result.mutated, false);
  assert.ok(result.blockerCount >= 1);
  assert.ok(result.blockers.some((blocker) => blocker.includes("bytes or sha256")));
  await fs.access(path.join(vaultRoot, artifact.relativePath));
});

test("migrateIntegrationStorage blocks receipt artifacts that still contain raw payloads", async () => {
  const { vaultRoot } = await createLegacyIntegrationVault({ includeReceiptPayload: true });

  const result = await migrateIntegrationStorage({ vaultRoot, apply: true });

  assert.equal(result.mutated, false);
  assert.ok(result.blockerCount >= 1);
  assert.ok(result.blockers.some((blocker) => blocker.includes("still contains a raw payload")));
});

test("validateVault rejects v2 legacy integration raw files and event refs", async () => {
  const { vaultRoot } = await createLegacyIntegrationVault();
  await writeVaultJson(vaultRoot, "vault.json", {
    ...JSON.parse(await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8")),
    formatVersion: 2,
  });

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "RAW_INTEGRATIONS_LEGACY_FORBIDDEN"));
  assert.ok(validation.issues.some((issue) => issue.code === "INTEGRATION_RAW_REF_FORBIDDEN"));
});

test("validateVault rejects duplicate integration ingest ids", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-duplicates");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const record = buildIntegrationIngestRecord({
    id: IMPORT_ID,
    provider: "whoop",
    source: "device",
    importedAt: IMPORTED_AT,
    parts: [],
    outputs: {
      events: [],
      sampleIds: [],
      sampleIdsComplete: true,
    },
    counts: {
      eventCount: 0,
      sampleCount: 0,
    },
  });
  await writeVaultText(
    vaultRoot,
    INGEST_SHARD,
    stableSerializeIntegrationIngestRecord(record) + stableSerializeIntegrationIngestRecord(record),
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "INTEGRATION_INGEST_DUPLICATE"));
});

test("validateVault rejects complete integration ingest sample outputs that reference missing samples", async () => {
  const vaultRoot = await makeTempDirectory("murph-integration-ingest-missing-sample");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const record = buildIntegrationIngestRecord({
    id: IMPORT_ID,
    provider: "whoop",
    source: "device",
    importedAt: IMPORTED_AT,
    parts: [],
    outputs: {
      events: [],
      sampleIds: ["smp_VJ3AZR2JBQVE89Z6B84EA60H0G"],
      sampleIdsComplete: true,
    },
    counts: {
      eventCount: 0,
      sampleCount: 1,
    },
  });
  await writeVaultText(
    vaultRoot,
    INGEST_SHARD,
    stableSerializeIntegrationIngestRecord(record),
  );

  const validation = await validateVault({ vaultRoot });

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "INTEGRATION_INGEST_SAMPLE_MISSING"));
});
