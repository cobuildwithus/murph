import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "vitest";

import {
  CONTRACT_SCHEMA_VERSION,
  type RawImportManifest,
  type RawImportManifestArtifact,
} from "@murphai/contracts";

import {
  acquireCanonicalWriteLock,
  compactLegacyWearableReceiptEnvelopes,
  detectLegacyWearableReceiptCompaction,
  hashWearableRawPayload,
  initializeVault,
  readJsonlRecords,
  validateVault,
} from "../src/index.ts";
import {
  parseRawImportManifest,
} from "../src/operations/raw-manifests.ts";

const IMPORTED_AT = "2026-04-22T12:00:00.000Z";
const IMPORT_ID = "xfm_FKXWJ9CRVED58RA9QVF2QHA1WE";
const RAW_DIRECTORY = `raw/integrations/garmin/2026/04/${IMPORT_ID}`;
const COMPACTION_NOW = new Date("2026-04-22T13:00:00.000Z");

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("compactLegacyWearableReceiptEnvelopes removes only legacy envelope payloads with exact duplicate proof", async () => {
  const vaultRoot = await createLegacyWearableFixture();
  const before = await snapshotVaultFiles(vaultRoot);
  const providerBefore = await readRawText(vaultRoot, "01-garmin-provider-snapshot.json");
  const canonicalBefore = await readRawText(vaultRoot, "03-garmin-canonical-wearable-records.json");
  const epochBefore = await readRawText(vaultRoot, "04-epoch-summary-abc.json");
  const detection = await detectLegacyWearableReceiptCompaction({ vaultRoot });

  assert.equal(detection.hasWork, true);
  assert.equal(detection.suspectedCount, 1);

  const result = await compactLegacyWearableReceiptEnvelopes({
    vaultRoot,
    now: COMPACTION_NOW,
  });

  assert.equal(result.mutated, true);
  assert.equal(result.compactedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.hasMore, false);
  assert.ok(result.bytesAfter < result.bytesBefore);
  assert.deepEqual(result.touchedPaths.filter((entry) => entry.startsWith("raw/")).sort(), [
    `${RAW_DIRECTORY}/02-garmin-raw-ingest-envelope-legacy.json`,
    `${RAW_DIRECTORY}/manifest.json`,
  ]);

  const envelope = await readRawJson(vaultRoot, "02-garmin-raw-ingest-envelope-legacy.json");
  assert.equal(Object.hasOwn(envelope, "payload"), false);
  assert.equal(envelope.payloadHash, hashWearableRawPayload(buildProviderPayload()));
  assert.deepEqual(envelope.rawArtifactRoles, ["provider-snapshot"]);

  assert.equal(await readRawText(vaultRoot, "01-garmin-provider-snapshot.json"), providerBefore);
  assert.equal(await readRawText(vaultRoot, "03-garmin-canonical-wearable-records.json"), canonicalBefore);
  assert.equal(await readRawText(vaultRoot, "04-epoch-summary-abc.json"), epochBefore);

  const after = await snapshotVaultFiles(vaultRoot);
  assertRawFileSetPreserved(before, after);

  const manifest = await readManifest(vaultRoot, "manifest.json");
  const envelopeArtifact = manifest.artifacts.find((artifact) =>
    artifact.role.startsWith("wearable-raw-envelope:")
  );
  assert.ok(envelopeArtifact);
  await assertArtifactMatchesFile(vaultRoot, envelopeArtifact);
  assert.equal(
    manifest.artifacts.find((artifact) => artifact.role === "provider-snapshot")?.sha256,
    before.get(`${RAW_DIRECTORY}/01-garmin-provider-snapshot.json`),
  );

  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: "audit/2026/2026-04.jsonl",
  });
  const compactionAudit = auditRecords.find((record) =>
    typeof record === "object"
    && record !== null
    && "commandName" in record
    && record.commandName === "core.compactLegacyWearableReceiptEnvelopes"
  );
  assert.ok(compactionAudit);
  assert.equal(JSON.stringify(compactionAudit).includes("dense-sentinel"), false);
  assert.equal(JSON.stringify(compactionAudit).includes(RAW_DIRECTORY), false);

  const validation = await validateVault({ vaultRoot, allowLegacyIntegrationRaw: true });
  assert.equal(validation.valid, true);
});

test("compactLegacyWearableReceiptEnvelopes is idempotent after a successful compaction", async () => {
  const vaultRoot = await createLegacyWearableFixture();
  const first = await compactLegacyWearableReceiptEnvelopes({
    vaultRoot,
    now: COMPACTION_NOW,
  });
  const afterFirst = await snapshotVaultFiles(vaultRoot);

  const second = await compactLegacyWearableReceiptEnvelopes({
    vaultRoot,
    now: COMPACTION_NOW,
  });
  const afterSecond = await snapshotVaultFiles(vaultRoot);

  assert.equal(first.compactedCount, 1);
  assert.equal(second.compactedCount, 0);
  assert.equal(second.mutated, false);
  assert.deepEqual(afterSecond, afterFirst);

  const detection = await detectLegacyWearableReceiptCompaction({ vaultRoot });
  assert.deepEqual(detection, {
    hasWork: false,
    largestSuspectByteSize: undefined,
    suspectedCount: 0,
  });
});

test("compactLegacyWearableReceiptEnvelopes resumes bounded batches without a durable cursor", async () => {
  const vaultRoot = await createLegacyWearableFixture({
    envelopeCount: 3,
  });

  const first = await compactLegacyWearableReceiptEnvelopes({
    maxEnvelopes: 1,
    now: COMPACTION_NOW,
    vaultRoot,
  });
  const second = await compactLegacyWearableReceiptEnvelopes({
    maxEnvelopes: 1,
    now: COMPACTION_NOW,
    vaultRoot,
  });
  const third = await compactLegacyWearableReceiptEnvelopes({
    maxEnvelopes: 1,
    now: COMPACTION_NOW,
    vaultRoot,
  });
  const fourth = await compactLegacyWearableReceiptEnvelopes({
    maxEnvelopes: 1,
    now: COMPACTION_NOW,
    vaultRoot,
  });

  assert.deepEqual(
    [first.compactedCount, first.hasMore],
    [1, true],
  );
  assert.deepEqual(
    [second.compactedCount, second.hasMore],
    [1, true],
  );
  assert.deepEqual(
    [third.compactedCount, third.hasMore],
    [1, true],
  );
  assert.deepEqual(
    [fourth.compactedCount, fourth.hasMore],
    [0, false],
  );
});

test("compactLegacyWearableReceiptEnvelopes scans manifests under the canonical write lock", async () => {
  const vaultRoot = await createLegacyWearableFixture();
  const lock = await acquireCanonicalWriteLock(vaultRoot);
  const compactionPromise = compactLegacyWearableReceiptEnvelopes({
    vaultRoot,
    now: COMPACTION_NOW,
  });

  let concurrentArtifact: RawImportManifestArtifact | null = null;
  try {
    await sleep(25);
    concurrentArtifact = await writeRawJsonArtifact({
      content: {
        retained: true,
      },
      fileName: "99-concurrent-provider-note.json",
      role: "provider-concurrent-note",
      vaultRoot,
    });
    const manifest = await readManifest(vaultRoot, "manifest.json");
    await fs.writeFile(
      path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"),
      `${JSON.stringify({
        ...manifest,
        artifacts: [...manifest.artifacts, concurrentArtifact],
      }, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await lock.release();
  }

  const result = await compactionPromise;
  assert.ok(concurrentArtifact);
  assert.equal(result.compactedCount, 1);
  const afterManifest = await readManifest(vaultRoot, "manifest.json");
  assert.ok(
    afterManifest.artifacts.some((artifact) => artifact.role === "provider-concurrent-note"),
  );
  await assertArtifactMatchesFile(vaultRoot, concurrentArtifact);
});

test("compactLegacyWearableReceiptEnvelopes drains later candidates after prior batches compact", async () => {
  const vaultRoot = await createLegacyWearableFixture({
    envelopeCount: 30,
  });
  let totalCompacted = 0;
  let hasMore = true;

  for (let run = 1; run <= 10 && hasMore; run += 1) {
    const result = await compactLegacyWearableReceiptEnvelopes({
      maxEnvelopes: 5,
      now: COMPACTION_NOW,
      vaultRoot,
    });

    assert.notDeepEqual(
      [result.compactedCount, result.hasMore],
      [0, true],
      `run ${run} stalled with no progress`,
    );
    totalCompacted += result.compactedCount;
    hasMore = result.hasMore;
  }

  assert.equal(hasMore, false);
  assert.equal(totalCompacted, 30);
  assert.equal(
    (await detectLegacyWearableReceiptCompaction({ vaultRoot })).hasWork,
    false,
  );
});

test("compactLegacyWearableReceiptEnvelopes honors deadline and candidate byte bounds", async () => {
  const deadlineVault = await createLegacyWearableFixture({
    envelopeCount: 2,
  });
  const beforeDeadline = await snapshotVaultFiles(deadlineVault);
  const deadlineResult = await compactLegacyWearableReceiptEnvelopes({
    deadlineMs: 0,
    now: COMPACTION_NOW,
    vaultRoot: deadlineVault,
  });

  assert.equal(deadlineResult.mutated, false);
  assert.equal(deadlineResult.compactedCount, 0);
  assert.equal(deadlineResult.hasMore, true);
  assert.deepEqual(await snapshotVaultFiles(deadlineVault), beforeDeadline);

  const byteBoundVault = await createLegacyWearableFixture();
  const byteBoundBefore = await snapshotVaultFiles(byteBoundVault);
  const byteBoundResult = await compactLegacyWearableReceiptEnvelopes({
    maxCandidateBytes: 1,
    now: COMPACTION_NOW,
    vaultRoot: byteBoundVault,
  });

  assert.equal(byteBoundResult.mutated, false);
  assert.equal(byteBoundResult.compactedCount, 0);
  assert.equal(byteBoundResult.skippedCount, 1);
  assert.equal(byteBoundResult.oversizedEnvelopeSkippedCount, 1);
  assert.equal(byteBoundResult.hasMore, false);
  assert.deepEqual(await snapshotVaultFiles(byteBoundVault), byteBoundBefore);
});

test("compactLegacyWearableReceiptEnvelopes terminally skips an envelope larger than total read budget", async () => {
  const vaultRoot = await createLegacyWearableFixture();
  const before = await snapshotVaultFiles(vaultRoot);
  const result = await compactLegacyWearableReceiptEnvelopes({
    maxBytesRead: 1,
    maxCandidateBytes: 1024 * 1024,
    now: COMPACTION_NOW,
    vaultRoot,
  });

  assert.equal(result.mutated, false);
  assert.equal(result.compactedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.oversizedEnvelopeSkippedCount, 1);
  assert.equal(result.hasMore, false);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), before);
});

test("compactLegacyWearableReceiptEnvelopes bounds scanned skipped candidates", async () => {
  const vaultRoot = await createLegacyWearableFixture({
    envelopeCount: 3,
    rawArtifactRoles: ["missing-provider-snapshot"],
  });
  const before = await snapshotVaultFiles(vaultRoot);
  const detection = await detectLegacyWearableReceiptCompaction({ vaultRoot });

  assert.equal(detection.hasWork, true);

  const result = await compactLegacyWearableReceiptEnvelopes({
    maxCandidatesScanned: 2,
    now: COMPACTION_NOW,
    vaultRoot,
  });

  assert.equal(result.mutated, false);
  assert.equal(result.compactedCount, 0);
  assert.equal(result.skippedCount, 2);
  assert.equal(result.scannedCount, 2);
  assert.equal(result.hasMore, true);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), before);
});

test("compactLegacyWearableReceiptEnvelopes advances past already compacted scan prefixes", async () => {
  const vaultRoot = await createLegacyWearableFixture({
    envelopeCount: 30,
  });
  let totalCompacted = 0;
  let lastResult: Awaited<ReturnType<typeof compactLegacyWearableReceiptEnvelopes>> | null = null;

  for (let index = 0; index < 10; index += 1) {
    lastResult = await compactLegacyWearableReceiptEnvelopes({
      maxCandidatesScanned: 25,
      maxEnvelopes: 5,
      now: COMPACTION_NOW,
      vaultRoot,
    });
    totalCompacted += lastResult.compactedCount;
    if (!lastResult.hasMore) {
      break;
    }
  }

  assert.ok(lastResult);
  assert.equal(totalCompacted, 30);
  assert.equal(lastResult.hasMore, false);
  assert.deepEqual(await detectLegacyWearableReceiptCompaction({ vaultRoot }), {
    hasWork: false,
    largestSuspectByteSize: undefined,
    suspectedCount: 0,
  });
});

test("compactLegacyWearableReceiptEnvelopes bounds evidence proof reads", async () => {
  const artifactBoundVault = await createLegacyWearableFixture();
  const artifactBoundBefore = await snapshotVaultFiles(artifactBoundVault);
  const providerArtifact = (await readManifest(artifactBoundVault, "manifest.json"))
    .artifacts.find((artifact) => artifact.role === "provider-snapshot");
  assert.ok(providerArtifact);
  assert.ok(providerArtifact.byteSize > 1);

  const artifactBoundResult = await compactLegacyWearableReceiptEnvelopes({
    maxCandidateBytes: 1024 * 1024,
    maxEvidenceArtifactBytes: providerArtifact.byteSize - 1,
    now: COMPACTION_NOW,
    vaultRoot: artifactBoundVault,
  });

  assert.equal(artifactBoundResult.mutated, false);
  assert.equal(artifactBoundResult.compactedCount, 0);
  assert.equal(artifactBoundResult.skippedCount, 1);
  assert.equal(artifactBoundResult.oversizedEvidenceSkippedCount, 1);
  assert.deepEqual(await snapshotVaultFiles(artifactBoundVault), artifactBoundBefore);

  const roleBoundVault = await createLegacyWearableFixture({
    rawArtifactRoles: Array.from(
      { length: 65 },
      (_, index) => (index === 0 ? "provider-snapshot" : `missing-proof-${index}`),
    ),
  });
  const roleBoundBefore = await snapshotVaultFiles(roleBoundVault);
  const roleBoundResult = await compactLegacyWearableReceiptEnvelopes({
    maxEvidenceRoles: 64,
    now: COMPACTION_NOW,
    vaultRoot: roleBoundVault,
  });

  assert.equal(roleBoundResult.mutated, false);
  assert.equal(roleBoundResult.compactedCount, 0);
  assert.equal(roleBoundResult.skippedCount, 1);
  assert.deepEqual(await snapshotVaultFiles(roleBoundVault), roleBoundBefore);
});

test("compactLegacyWearableReceiptEnvelopes validates the vault after mutation", async () => {
  const vaultRoot = await createLegacyWearableFixture();
  await fs.rm(path.join(vaultRoot, "ledger"), { force: true, recursive: true });

  await assert.rejects(
    compactLegacyWearableReceiptEnvelopes({
      now: COMPACTION_NOW,
      vaultRoot,
    }),
    (error) =>
      error instanceof Error
      && "code" in error
      && error.code === "LEGACY_WEARABLE_RECEIPT_COMPACTION_INVALID_VAULT",
  );
});

test("compactLegacyWearableReceiptEnvelopes skips unsafe legacy envelope candidates", async () => {
  const mismatchVault = await createLegacyWearableFixture({
    envelopePayload: {
      ...buildProviderPayload(),
      changed: true,
    },
  });
  const missingEvidenceVault = await createLegacyWearableFixture({
    rawArtifactRoles: ["missing-provider-snapshot"],
  });
  const checksumMismatchVault = await createLegacyWearableFixture();
  await fs.writeFile(
    path.join(checksumMismatchVault, RAW_DIRECTORY, "01-garmin-provider-snapshot.json"),
    `${JSON.stringify({ changed: true })}\n`,
    "utf8",
  );

  for (const vaultRoot of [mismatchVault, missingEvidenceVault, checksumMismatchVault]) {
    const before = await snapshotVaultFiles(vaultRoot);
    const result = await compactLegacyWearableReceiptEnvelopes({
      vaultRoot,
      now: COMPACTION_NOW,
    });
    assert.equal(result.mutated, false);
    assert.equal(result.compactedCount, 0);
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), before);
  }
});

test("compactLegacyWearableReceiptEnvelopes does not reconstruct split provider artifacts", async () => {
  const vaultRoot = await createLegacyWearableFixture({
    providerSnapshotContent: {
      day: "2026-04-22",
      steps: 1234,
    },
    rawArtifactRoles: ["garmin-epoch-summary"],
  });
  const before = await snapshotVaultFiles(vaultRoot);

  const result = await compactLegacyWearableReceiptEnvelopes({
    vaultRoot,
    now: COMPACTION_NOW,
  });

  assert.equal(result.mutated, false);
  assert.equal(result.compactedCount, 0);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), before);
});

test("compactLegacyWearableReceiptEnvelopes updates agreeing duplicate manifests and skips disagreeing ones", async () => {
  const agreeingVault = await createLegacyWearableFixture({
    duplicateManifest: "agree",
  });
  const agreeResult = await compactLegacyWearableReceiptEnvelopes({
    vaultRoot: agreeingVault,
    now: COMPACTION_NOW,
  });
  assert.equal(agreeResult.compactedCount, 1);
  await assertArtifactMatchesFile(
    agreeingVault,
    readEnvelopeArtifact(await readManifest(agreeingVault, "manifest.json")),
  );
  await assertArtifactMatchesFile(
    agreeingVault,
    readEnvelopeArtifact(await readManifest(agreeingVault, "manifest.copy.json")),
  );

  const disagreeingVault = await createLegacyWearableFixture({
    duplicateManifest: "disagree",
  });
  const beforeDisagreeing = await snapshotVaultFiles(disagreeingVault);
  const disagreeResult = await compactLegacyWearableReceiptEnvelopes({
    vaultRoot: disagreeingVault,
    now: COMPACTION_NOW,
  });
  assert.equal(disagreeResult.mutated, false);
  assert.equal(disagreeResult.compactedCount, 0);
  assert.deepEqual(await snapshotVaultFiles(disagreeingVault), beforeDisagreeing);
});

async function createLegacyWearableFixture(options: {
  duplicateManifest?: "agree" | "disagree";
  envelopeCount?: number;
  envelopePayloadPresent?: boolean;
  envelopePayload?: Record<string, unknown>;
  providerSnapshotContent?: unknown;
  rawArtifactRoles?: string[];
} = {}): Promise<string> {
  const vaultRoot = await makeTempDirectory("murph-legacy-wearable-receipts");
  await initializeVault({
    createdAt: "2026-03-12T12:00:00.000Z",
    vaultRoot,
  });
  await fs.mkdir(path.join(vaultRoot, RAW_DIRECTORY), { recursive: true });

  const providerPayload = buildProviderPayload();
  const envelopePayload = options.envelopePayload ?? providerPayload;
  const providerSnapshotContent = options.providerSnapshotContent ?? providerPayload;
  const rawArtifactRoles = options.rawArtifactRoles ?? ["provider-snapshot"];
  const artifacts: RawImportManifestArtifact[] = [];

  artifacts.push(await writeRawJsonArtifact({
    content: providerSnapshotContent,
    fileName: "01-garmin-provider-snapshot.json",
    role: "provider-snapshot",
    vaultRoot,
  }));

  const envelopeCount = options.envelopeCount ?? 1;
  for (let index = 0; index < envelopeCount; index += 1) {
    const suffix = envelopeCount === 1 ? "" : `-${index + 1}`;
    const envelopeContent = {
      id: `wearable_raw_legacy${suffix}`,
      payloadHash: hashWearableRawPayload(providerPayload),
      rawArtifactCount: rawArtifactRoles.length,
      rawArtifactRoles,
      schemaVersion: "wearable.raw_ingest.v1",
      ...(options.envelopePayloadPresent === false
        ? {}
        : { payload: envelopePayload }),
    };
    artifacts.push(await writeRawJsonArtifact({
      content: envelopeContent,
      fileName: `02-garmin-raw-ingest-envelope-legacy${suffix}.json`,
      role: `wearable-raw-envelope:wearable_raw_legacy${suffix}`,
      vaultRoot,
    }));
  }

  artifacts.push(await writeRawJsonArtifact({
    content: {
      records: [{ id: "evt_synthetic_canonical" }],
    },
    fileName: "03-garmin-canonical-wearable-records.json",
    role: "wearable-canonical-records:wearable_raw_legacy",
    vaultRoot,
  }));
  artifacts.push(await writeRawJsonArtifact({
    content: {
      day: "2026-04-22",
      steps: 1234,
    },
    fileName: "04-epoch-summary-abc.json",
    role: "garmin-epoch-summary",
    vaultRoot,
  }));

  const manifest = buildManifest(artifacts);
  await fs.writeFile(
    path.join(vaultRoot, RAW_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (options.duplicateManifest) {
    const duplicate = structuredClone(manifest);
    if (options.duplicateManifest === "disagree") {
      const envelope = duplicate.artifacts.find((artifact) =>
        artifact.role.startsWith("wearable-raw-envelope:")
      );
      if (envelope) {
        envelope.byteSize += 1;
      }
    }
    await fs.writeFile(
      path.join(vaultRoot, RAW_DIRECTORY, "manifest.copy.json"),
      `${JSON.stringify(duplicate, null, 2)}\n`,
      "utf8",
    );
  }

  return vaultRoot;
}

function buildProviderPayload(): Record<string, unknown> {
  return {
    daily: {
      date: "2026-04-22",
      marker: "dense-sentinel",
      steps: 1234,
    },
    provider: "garmin",
  };
}

function buildManifest(artifacts: RawImportManifestArtifact[]): RawImportManifest {
  return {
    artifacts,
    importedAt: IMPORTED_AT,
    importId: IMPORT_ID,
    importKind: "device_batch",
    owner: {
      id: IMPORT_ID,
      kind: "device_batch",
      partition: "garmin",
    },
    provenance: {
      provider: "garmin",
    },
    rawDirectory: RAW_DIRECTORY,
    schemaVersion: CONTRACT_SCHEMA_VERSION.rawImportManifest,
    source: "device",
  };
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

async function readRawJson(vaultRoot: string, fileName: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readRawText(vaultRoot, fileName));
  if (!isRecord(parsed)) {
    throw new Error(`Expected raw JSON object in ${fileName}.`);
  }
  return parsed;
}

async function readRawText(vaultRoot: string, fileName: string): Promise<string> {
  return fs.readFile(path.join(vaultRoot, RAW_DIRECTORY, fileName), "utf8");
}

async function readManifest(vaultRoot: string, fileName: string): Promise<RawImportManifest> {
  return parseRawImportManifest(JSON.parse(await readRawText(vaultRoot, fileName)));
}

async function snapshotVaultFiles(vaultRoot: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  async function walk(relativeDirectory: string): Promise<void> {
    const absoluteDirectory = path.join(vaultRoot, relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(vaultRoot, relativePath);
      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      snapshot.set(relativePath, sha256Hex(await fs.readFile(absolutePath)));
    }
  }

  await walk(".");
  return snapshot;
}

function assertRawFileSetPreserved(before: Map<string, string>, after: Map<string, string>): void {
  const beforeRaw = [...before.keys()].filter((entry) => entry.startsWith(`${RAW_DIRECTORY}/`)).sort();
  const afterRaw = [...after.keys()].filter((entry) => entry.startsWith(`${RAW_DIRECTORY}/`)).sort();
  assert.deepEqual(afterRaw, beforeRaw);
}

async function assertArtifactMatchesFile(
  vaultRoot: string,
  artifact: RawImportManifestArtifact,
): Promise<void> {
  const content = await fs.readFile(path.join(vaultRoot, artifact.relativePath));
  assert.equal(content.byteLength, artifact.byteSize);
  assert.equal(sha256Hex(content), artifact.sha256);
}

function readEnvelopeArtifact(manifest: RawImportManifest): RawImportManifestArtifact {
  const artifact = manifest.artifacts.find((entry) =>
    entry.role.startsWith("wearable-raw-envelope:")
  );
  if (!artifact) {
    throw new Error("Expected wearable raw envelope artifact in manifest.");
  }
  return artifact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
