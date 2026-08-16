import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import { test } from "vitest";

import type {
  AuditRecord,
  EventRecord,
  IntegrationIngestRecord,
  SampleRecord,
} from "@murphai/contracts";
import { isDeletedEventLifecycle } from "@murphai/contracts";

import {
  compactIntegrationIngestReceipt,
  dedupeDeviceEventsByExternalRef,
  deleteEvent,
  deterministicContractId,
  findEventByExternalRef,
  importDeviceBatch,
  initializeVault,
  listIntegrationIngestsForEvent,
  readIntegrationIngestById,
  readJsonlRecords,
  repairJunctionWorkoutHeartRateZones,
  updateVaultSummary,
  upsertEvent,
  VaultError,
  stableStringifyWearableRawPayload,
} from "../src/index.ts";
import {
  selectNovelIntegrationIngestEvidence,
} from "../src/integration-ingests.ts";
import { prepareInlineRawArtifact, prepareRawArtifact } from "../src/raw.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function snapshotVaultFiles(vaultRoot: string): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  for (const relativePath of await fs.readdir(vaultRoot, { recursive: true })) {
    const absolutePath = path.join(vaultRoot, relativePath);
    if ((await fs.stat(absolutePath)).isFile()) {
      snapshot.set(relativePath, await fs.readFile(absolutePath));
    }
  }
  return snapshot;
}

interface DeviceImportManifest {
  ingestId: string;
  importKind: string;
  rawDirectory: string;
  artifacts: Array<{
    role: string;
    relativePath: string;
    originalFileName: string;
  }>;
  provenance: {
    provider?: string;
    accountId?: string | null;
    importedAt?: string;
    eventCount?: number;
    sampleCount?: number;
    evidenceParts?: Array<{
      role: string;
      relativePath: string;
      sha256: string;
      metadata?: Record<string, unknown> | null;
    }>;
    operatorMetadata?: Record<string, unknown>;
  };
}

async function readDeviceImportManifest(
  vaultRoot: string,
  relativePath: string,
): Promise<DeviceImportManifest> {
  return JSON.parse(await fs.readFile(path.join(vaultRoot, relativePath), "utf8")) as DeviceImportManifest;
}

async function readRequiredIntegrationIngest(vaultRoot: string, ingestId: string) {
  const entry = await readIntegrationIngestById(vaultRoot, ingestId);
  assert.ok(entry, `Expected integration ingest "${ingestId}" to exist.`);
  return entry.record;
}

function invalidTestValue<T>(value: unknown): T {
  return value as T;
}

function eventObservationValue(record: EventRecord | undefined): unknown {
  return record?.kind === "observation" ? record.value : undefined;
}

function collapseEventSpines(records: readonly EventRecord[]): EventRecord[] {
  const latestById = new Map<string, EventRecord>();
  for (const record of records) {
    const current = latestById.get(record.id);
    if ((record.lifecycle?.revision ?? 1) >= (current?.lifecycle?.revision ?? 0)) {
      latestById.set(record.id, record);
    }
  }
  return [...latestById.values()];
}

const DENSE_TELEMETRY_NOT_ALLOWED_CODE = "VAULT_DENSE_DEVICE_TELEMETRY_NOT_ALLOWED";
const DENSE_SAMPLE_NOT_ALLOWED_LEGACY_CODE = "VAULT_DENSE_DEVICE_SAMPLES_NOT_ALLOWED";

function isDenseTelemetryPolicyError(error: unknown): error is VaultError {
  if (!(error instanceof VaultError) || error.code !== DENSE_TELEMETRY_NOT_ALLOWED_CODE) {
    return false;
  }

  const codeAliases = error.details.codeAliases;
  return Array.isArray(codeAliases)
    && codeAliases.includes(DENSE_SAMPLE_NOT_ALLOWED_LEGACY_CODE)
    && error.details.legacyCode === DENSE_SAMPLE_NOT_ALLOWED_LEGACY_CODE;
}

function buildDenseHeartRateSamples(count: number): Array<{
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
    timestampSemantics: "utc";
  };
  sample: {
    recordedAt: string;
    value: number;
  };
}> {
  const startMs = Date.parse("2026-03-16T09:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const recordedAt = new Date(startMs + index * 1000).toISOString();
    return {
      stream: "heart_rate",
      recordedAt,
      unit: "bpm",
      quality: "normalized",
      externalRef: {
        system: "wearable-provider",
        resourceType: "timeseries-heart-rate",
        resourceId: "day-2026-03-16",
        version: "2026-03-16",
      },
      dataOrigin: {
        version: 1,
        aggregatorProvider: "wearable-aggregator",
        sourceProviderSlug: "wearable-provider",
        sourceType: "watch",
        sourceInstanceId: "device-test",
        timestampSemantics: "utc",
      },
      sample: {
        recordedAt,
        value: 70 + (index % 5),
      },
    };
  });
}

function buildDenseHeartRateObservations(count: number): Array<{
  kind: "observation";
  occurredAt: string;
  recordedAt: string;
  title: string;
  externalRef?: {
    system: string;
    resourceType: string;
    resourceId: string;
  };
  fields: {
    metric: string;
    observationGrain?: "sample" | "summary" | "derived_fact";
    queryVisibility?: string;
    unit: string;
    value: number;
  };
}> {
  const startMs = Date.parse("2026-03-16T09:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const occurredAt = new Date(startMs + index * 1000).toISOString();
    return {
      kind: "observation",
      occurredAt,
      recordedAt: occurredAt,
      title: "Heart rate",
      externalRef: {
        system: "wearable-provider",
        resourceType: "timeseries-heart-rate",
        resourceId: `day-2026-03-16-${index}`,
      },
      fields: {
        metric: "heart-rate",
        unit: "bpm",
        value: 70 + (index % 5),
      },
    };
  });
}

test("importDeviceBatch rejects dense provider sample firehoses by default", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-dense-samples");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    importDeviceBatch({
      vaultRoot,
      provider: "wearable-provider",
      accountId: "acct-test",
      importedAt: "2026-03-16T09:30:00.000Z",
      samples: buildDenseHeartRateSamples(1001),
    }),
    (error) => isDenseTelemetryPolicyError(error) && !JSON.stringify(error).includes("bpm"),
  );
});

test("importDeviceBatch allows sample batches at the provider row limit", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-sample-limit");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "wearable-provider",
    accountId: "acct-test",
    importedAt: "2026-03-16T09:30:00.000Z",
    samples: buildDenseHeartRateSamples(1000),
  });

  assert.equal(result.samples.length, 1000);
  assert.equal(result.events.length, 0);
});

test("importDeviceBatch dense sample guard does not trust caller-provided source", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-dense-samples");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    importDeviceBatch({
      vaultRoot,
      provider: "wearable-provider",
      accountId: "acct-test",
      importedAt: "2026-03-16T09:30:00.000Z",
      source: "manual",
      samples: buildDenseHeartRateSamples(1001),
    }),
    isDenseTelemetryPolicyError,
  );
});

test("importDeviceBatch allows large numeric observation batches", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-observation-events");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const events = buildDenseHeartRateObservations(1001).map(({ externalRef: _externalRef, ...event }) => ({
    ...event,
    fields: {
      ...event.fields,
      observationGrain: "sample" as const,
    },
  }));

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "wearable-provider",
    accountId: "acct-test",
    importedAt: "2026-03-16T09:30:00.000Z",
    events,
  });

  assert.equal(result.events.length, 1001);
  assert.equal(result.samples.length, 0);
  assert.equal(result.events.every((event) => event.kind === "observation" && event.observationGrain === "sample"), true);
  assert.equal(result.events.some((event) => event.kind === "observation" && event.queryVisibility === "default"), false);
  assert.equal(result.events.some((event) => event.kind === "observation" && event.canonicalFact === true), false);
});

test("importDeviceBatch rejects device event query promotion fields", async () => {
  const promotionCases = [
    { field: "queryVisibility", value: "default" },
    { field: "visibility", value: "display" },
    { field: "canonicalFact", value: true },
  ] as const;

  for (const promotionCase of promotionCases) {
    const vaultRoot = await makeTempDirectory(`murph-device-import-promotion-${promotionCase.field}`);
    await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
    const event = buildDenseHeartRateObservations(1)[0];
    assert.ok(event);

    await assert.rejects(
      importDeviceBatch({
        vaultRoot,
        provider: "wearable-provider",
        accountId: "acct-test",
        importedAt: "2026-03-16T09:30:00.000Z",
        events: [
          {
            ...event,
            fields: {
              ...event.fields,
              [promotionCase.field]: promotionCase.value,
            },
          },
        ],
      }),
      (error) =>
        error instanceof VaultError &&
        error.code === "VAULT_INVALID_EVENT_FIELDS" &&
        error.details.field === promotionCase.field,
    );
  }
});

test("importDeviceBatch allows compact summary observations without display visibility", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-summary-events");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const startMs = Date.parse("2024-01-01T08:00:00.000Z");
  const metrics = [
    { metric: "daily-steps", unit: "count", value: 8000 },
    { metric: "resting-heart-rate", unit: "bpm", value: 58 },
    { metric: "sleep-score", unit: "%", value: 84 },
  ] as const;
  const events = Array.from({ length: 1095 }, (_, index) => {
    const timestamp = new Date(startMs + index * 86_400_000).toISOString();
    const metric = metrics[index % metrics.length] ?? metrics[0];

    return {
      kind: "observation" as const,
      occurredAt: timestamp,
      recordedAt: timestamp,
      title: "Daily wearable summary",
      externalRef: {
        system: "wearable-provider",
        resourceType: "daily-summary",
        resourceId: `summary-${index}`,
      },
      fields: {
        metric: metric.metric,
        observationGrain: "summary" as const,
        unit: metric.unit,
        value: metric.value,
      },
    };
  });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "wearable-provider",
    accountId: "acct-test",
    importedAt: "2026-03-16T09:30:00.000Z",
    events,
  });

  assert.equal(result.events.length, 1095);
  assert.equal(result.events.every((event) => event.kind === "observation" && event.observationGrain === "summary"), true);
  assert.equal(result.events.some((event) => event.kind === "observation" && event.queryVisibility === "default"), false);
  assert.equal(result.events.some((event) => event.kind === "observation" && event.canonicalFact === true), false);
});

test("importDeviceBatch allows compact derived fact observations without display visibility", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-derived-fact-events");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });
  const startMs = Date.parse("2024-01-01T08:00:00.000Z");
  const events = Array.from({ length: 1001 }, (_, index) => {
    const timestamp = new Date(startMs + index * 86_400_000).toISOString();

    return {
      kind: "observation" as const,
      occurredAt: timestamp,
      recordedAt: timestamp,
      title: "Derived wearable fact",
      externalRef: {
        system: "wearable-provider",
        resourceType: "derived-daily-fact",
        resourceId: `derived-fact-${index}`,
      },
      fields: {
        metric: "weekly-resting-heart-rate-baseline",
        observationGrain: "derived_fact" as const,
        unit: "bpm",
        value: 58,
      },
    };
  });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "wearable-provider",
    accountId: "acct-test",
    importedAt: "2026-03-16T09:30:00.000Z",
    events,
  });

  assert.equal(result.events.length, 1001);
  assert.equal(result.events.every((event) => event.kind === "observation" && event.observationGrain === "derived_fact"), true);
  assert.equal(result.events.some((event) => event.kind === "observation" && event.queryVisibility === "default"), false);
  assert.equal(result.events.some((event) => event.kind === "observation" && event.canonicalFact === true), false);
});

test("importDeviceBatch writes inline raw integration payloads and compact records", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-03-16T09:30:00.000Z",
    source: "device",
    events: [
      {
        kind: "sleep_session",
        occurredAt: "2026-03-15T22:00:00.000Z",
        recordedAt: "2026-03-16T07:30:00.000Z",
        title: "WHOOP sleep",
        evidenceRoles: ["sleep:sleep-1"],
        externalRef: {
          system: "whoop",
          resourceType: "sleep",
          resourceId: "sleep-1",
          version: "2026-03-16T07:30:00.000Z",
        },
        fields: {
          startAt: "2026-03-15T22:00:00.000Z",
          endAt: "2026-03-16T07:00:00.000Z",
          durationMinutes: 540,
        },
      },
      {
        kind: "observation",
        occurredAt: "2026-03-16T07:30:00.000Z",
        recordedAt: "2026-03-16T07:30:00.000Z",
        title: "WHOOP recovery score",
        evidenceRoles: ["recovery:sleep-1"],
        externalRef: {
          system: "whoop",
          resourceType: "recovery",
          resourceId: "sleep-1",
          version: "2026-03-16T07:30:00.000Z",
          facet: "recovery-score",
        },
        fields: {
          metric: "recovery-score",
          value: 67,
          unit: "%",
        },
      },
    ],
    samples: [
      {
        stream: "hrv",
        recordedAt: "2026-03-16T07:30:00.000Z",
        unit: "ms",
        quality: "normalized",
        externalRef: {
          system: "whoop",
          resourceType: "recovery",
          resourceId: "sleep-1",
          version: "2026-03-16T07:30:00.000Z",
          facet: "hrv",
        },
        sample: {
          recordedAt: "2026-03-16T07:30:00.000Z",
          value: 42.5,
        },
      },
    ],
    evidenceParts: [
      {
        role: "sleep:sleep-1",
        fileName: "sleep-sleep-1.json",
        mediaType: "application/json",
        content: {
          id: "sleep-1",
          start: "2026-03-15T22:00:00.000Z",
          end: "2026-03-16T07:00:00.000Z",
        },
      },
      {
        role: "recovery:sleep-1",
        fileName: "recovery-sleep-1.json",
        mediaType: "application/json",
        content: {
          sleep_id: "sleep-1",
          updated_at: "2026-03-16T07:30:00.000Z",
          score: { recovery_score: 67, hrv_rmssd_milli: 42.5 },
        },
      },
    ],
    provenance: {
      syncMode: "test",
    },
  });

  assert.ok(result.applied);

  assert.equal(result.ingestId, "xfm_ARQV9NAR6P2P3YA7VGCB3V1NSF");
  assert.equal(result.events.length, 2);
  assert.equal(result.samples.length, 1);
  assert.equal(result.evidencePartCount, 2);
  assert.equal(result.provider, "whoop");
  assert.equal(result.accountId, "whoop-user-1");
  await assert.rejects(
    () => fs.access(path.join(vaultRoot, "raw", "integrations")),
    (error) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT",
  );
  assert.deepEqual(
    result.events.map((record) => record.id),
    ["evt_KBKEHWQT2XXW0K5XZCS1T5X9KA", "evt_S5K01TSPA86JJVS1DWVHT9RRZ1"],
  );
  assert.deepEqual(result.samples.map((record) => record.id), ["smp_VJ3AZR2JBQVE89Z6B84EA60H0G"]);
  const ingest = await readRequiredIntegrationIngest(vaultRoot, result.ingestId);
  assert.equal(result.ingestShardPath, "ledger/integration-ingests/2026/2026-03.jsonl");
  const sleepPart = ingest.parts.find((part) => part.role === "sleep:sleep-1");
  assert.equal(sleepPart?.fileName, "sleep-sleep-1.json");
  const sleepRawText = sleepPart?.content ?? "";
  assert.equal(
    sleepRawText,
    '{"end":"2026-03-16T07:00:00.000Z","id":"sleep-1","start":"2026-03-15T22:00:00.000Z"}\n',
  );
  assert.equal(sleepRawText.includes("\n  "), false);

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.eventShardPaths[0] as string,
  })) as EventRecord[];
  const sampleRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.sampleShardPaths[0] as string,
  })) as SampleRecord[];
  const auditRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.auditPath,
  })) as AuditRecord[];

  assert.deepEqual(eventRecords, [
    {
      schemaVersion: "murph.event.v1",
      id: "evt_KBKEHWQT2XXW0K5XZCS1T5X9KA",
      kind: "sleep_session",
      occurredAt: "2026-03-15T22:00:00.000Z",
      recordedAt: "2026-03-16T07:30:00.000Z",
      dayKey: "2026-03-15",
      timeZone: "UTC",
      source: "device",
      title: "WHOOP sleep",
      externalRef: {
        system: "whoop",
        resourceType: "sleep",
        resourceId: "sleep-1",
        version: "2026-03-16T07:30:00.000Z",
      },
      startAt: "2026-03-15T22:00:00.000Z",
      endAt: "2026-03-16T07:00:00.000Z",
      durationMinutes: 540,
    },
    {
      schemaVersion: "murph.event.v1",
      id: "evt_S5K01TSPA86JJVS1DWVHT9RRZ1",
      kind: "observation",
      occurredAt: "2026-03-16T07:30:00.000Z",
      recordedAt: "2026-03-16T07:30:00.000Z",
      dayKey: "2026-03-16",
      timeZone: "UTC",
      source: "device",
      title: "WHOOP recovery score",
      externalRef: {
        system: "whoop",
        resourceType: "recovery",
        resourceId: "sleep-1",
        version: "2026-03-16T07:30:00.000Z",
        facet: "recovery-score",
      },
      metric: "recovery-score",
      value: 67,
      unit: "%",
    },
  ]);
  assert.deepEqual(sampleRecords, [
    {
      schemaVersion: "murph.sample.v1",
      id: "smp_VJ3AZR2JBQVE89Z6B84EA60H0G",
      dayKey: "2026-03-16",
      timeZone: "UTC",
      stream: "hrv",
      recordedAt: "2026-03-16T07:30:00.000Z",
      source: "device",
      quality: "normalized",
      externalRef: {
        system: "whoop",
        resourceType: "recovery",
        resourceId: "sleep-1",
        version: "2026-03-16T07:30:00.000Z",
        facet: "hrv",
      },
      value: 42.5,
      unit: "ms",
    },
  ]);
  assert.equal(auditRecords.at(-1)?.action, "device_import");
  assert.deepEqual(auditRecords.at(-1)?.targetIds, [result.ingestId]);
  assert.equal(ingest.counts.eventCount, 2);
  assert.equal(ingest.counts.sampleCount, 1);
  assert.deepEqual(ingest.provenance, {
    syncMode: "test",
  });
});

test("importDeviceBatch validates only target integration ingest shards while appending", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-target-ingest-shard");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });
  const unrelatedShard = path.join(vaultRoot, "ledger/integration-ingests/2025/2025-12.jsonl");
  await fs.mkdir(path.dirname(unrelatedShard), { recursive: true });
  await fs.writeFile(unrelatedShard, "{\"not\":\"an integration ingest\"}\n", "utf8");

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "oura",
    importedAt: "2026-03-16T09:30:00.000Z",
    evidenceParts: [
      {
        role: "daily-summary:2026-03-16",
        fileName: "daily-summary-2026-03-16.json",
        content: { steps: 4321 },
      },
    ],
  });

  assert.equal(result.ingestShardPath, "ledger/integration-ingests/2026/2026-03.jsonl");
  const targetRows = await readJsonlRecords({ vaultRoot, relativePath: result.ingestShardPath });
  assert.equal(targetRows.length, 1);
  assert.equal((targetRows[0] as { id?: string }).id, result.ingestId);
});

test("importDeviceBatch preserves explicit sleep session identity through canonical persistence", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-sleep-type");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "sleep-type-test",
    importedAt: "2026-03-16T09:30:00.000Z",
    events: [{
      kind: "sleep_session",
      occurredAt: "2026-03-15T22:00:00.000Z",
      recordedAt: "2026-03-16T07:30:00.000Z",
      title: "Sleep session",
      externalRef: {
        system: "whoop",
        resourceType: "sleep",
        resourceId: "sleep-type-1",
      },
      fields: {
        startAt: "2026-03-15T22:00:00.000Z",
        endAt: "2026-03-16T07:00:00.000Z",
        durationMinutes: 540,
        sleepType: "main_sleep",
      },
    }],
  });

  const sleep = result.events[0];
  assert.equal(sleep?.kind, "sleep_session");
  assert.equal(sleep?.kind === "sleep_session" ? sleep.sleepType : undefined, "main_sleep");

  const records = await readJsonlRecords({
    vaultRoot,
    relativePath: result.eventShardPaths[0] as string,
  });
  const persisted = records[0] as EventRecord | undefined;
  assert.equal(persisted?.kind === "sleep_session" ? persisted.sleepType : undefined, "main_sleep");
});

test("importDeviceBatch streams target ingest duplicate checks without rehashing unrelated rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-stream-target-ingest-shard");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });
  const targetShardPath = "ledger/integration-ingests/2026/2026-03.jsonl";
  await fs.mkdir(path.dirname(path.join(vaultRoot, targetShardPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, targetShardPath),
    `${JSON.stringify({
      schemaVersion: "murph.integration-ingest.v1",
      id: "xfm_existing_bad_integrity",
      provider: "oura",
      source: "device",
      importedAt: "2026-03-01T00:00:00.000Z",
      parts: [
        {
          role: "daily-summary:2026-03-01",
          fileName: "daily-summary-2026-03-01.json",
          mediaType: "application/json",
          content: "{}",
          byteSize: 999,
          sha256: "bad",
        },
      ],
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
    })}\n`,
    "utf8",
  );

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "oura",
    importedAt: "2026-03-16T09:30:00.000Z",
    evidenceParts: [
      {
        role: "daily-summary:2026-03-16",
        fileName: "daily-summary-2026-03-16.json",
        content: { steps: 4321 },
      },
    ],
  });

  assert.equal(result.ingestShardPath, targetShardPath);
  const entry = await readIntegrationIngestById(vaultRoot, result.ingestId);
  assert.equal(entry?.record.id, result.ingestId);
  const rows = await readJsonlRecords({ vaultRoot, relativePath: targetShardPath });
  assert.equal(rows.length, 2);
  assert.equal((rows[1] as { id?: string }).id, result.ingestId);
});

test("listIntegrationIngestsForEvent streams provenance lookup without rehashing unrelated rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-stream-event-provenance");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });
  const targetShardPath = "ledger/integration-ingests/2026/2026-03.jsonl";
  await fs.mkdir(path.dirname(path.join(vaultRoot, targetShardPath)), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, targetShardPath),
    `${JSON.stringify({
      schemaVersion: "murph.integration-ingest.v1",
      id: "xfm_existingbadintegrityforotherevent",
      provider: "junction",
      source: "device",
      importedAt: "2026-03-01T00:00:00.000Z",
      parts: [
        {
          role: "junction-summary-workouts",
          fileName: "junction-summary-workouts.json",
          mediaType: "application/json",
          content: "{}",
          byteSize: 2,
          sha256: "0".repeat(64),
        },
      ],
      outputs: {
        events: [
          {
            id: "evt_unrelated",
            roles: ["junction-summary-workouts"],
          },
        ],
        eventIdsComplete: true,
        sampleIds: [],
        sampleIdsComplete: true,
      },
      counts: {
        eventCount: 1,
        sampleCount: 0,
      },
    })}\n`,
    "utf8",
  );

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-03-16T09:30:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workouts-stream-event-provenance" }),
        evidenceRoles: ["junction-summary-workouts"],
      },
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: { id: "workouts-stream-event-provenance", sport: "running" },
      },
    ],
  });

  const entries = await listIntegrationIngestsForEvent(
    vaultRoot,
    result.events[0]?.id ?? "missing",
  );
  assert.deepEqual(entries.map((entry) => entry.record.id), [result.ingestId]);
});

test("importDeviceBatch fails closed on malformed target ingest shards while streaming", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-malformed-target-ingest-shard");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });
  const targetShardPath = "ledger/integration-ingests/2026/2026-03.jsonl";
  await fs.mkdir(path.dirname(path.join(vaultRoot, targetShardPath)), { recursive: true });
  await fs.writeFile(path.join(vaultRoot, targetShardPath), "{\"id\":", "utf8");

  await assert.rejects(
    importDeviceBatch({
      vaultRoot,
      provider: "oura",
      importedAt: "2026-03-16T09:30:00.000Z",
      evidenceParts: [
        {
          role: "daily-summary:2026-03-16",
          fileName: "daily-summary-2026-03-16.json",
          content: { steps: 4321 },
        },
      ],
    }),
    (error) => error instanceof VaultError && error.code === "VAULT_INVALID_JSONL",
  );
});

test("importDeviceBatch separates a complete final ingest row that lacks its newline", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-missing-ingest-newline");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });
  const buildInput = (importedAt: string, role: string) => ({
    vaultRoot,
    provider: "oura",
    importedAt,
    evidenceParts: [{
      role,
      fileName: `${role}.json`,
      content: { role },
    }],
  });
  const first = await importDeviceBatch(buildInput("2026-03-16T09:30:00.000Z", "daily-summary-a"));
  const shardPath = first.ingestShardPath;
  assert.ok(shardPath);
  const firstBytes = await fs.readFile(path.join(vaultRoot, shardPath));
  assert.equal(firstBytes.at(-1), 0x0a);
  await fs.writeFile(path.join(vaultRoot, shardPath), firstBytes.subarray(0, -1));

  const secondInput = buildInput("2026-03-17T09:30:00.000Z", "daily-summary-b");
  const second = await importDeviceBatch(secondInput);
  assert.ok(second.applied);
  const rows = (await fs.readFile(path.join(vaultRoot, shardPath), "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((row) => row.id), [first.ingestId, second.ingestId]);

  const beforeReplay = await fs.readFile(path.join(vaultRoot, shardPath));
  const replay = await importDeviceBatch(secondInput);
  assert.equal(replay.applied, false);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, shardPath)), beforeReplay);
});

test("importDeviceBatch accepts high-cardinality evidence within the total byte cap", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-many-evidence-parts");
  await initializeVault({ vaultRoot, createdAt: "2026-03-01T00:00:00.000Z" });
  const evidenceParts = Array.from({ length: 90 }, (_, index) => ({
    role: `daily-summary:${index + 1}`,
    fileName: `daily-summary-${index + 1}.json`,
    content: { index, value: index + 1 },
  }));

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "oura",
    importedAt: "2026-03-16T09:30:00.000Z",
    evidenceParts,
  });

  assert.ok(result.applied);

  const ingest = await readRequiredIntegrationIngest(vaultRoot, result.ingestId);
  assert.equal(result.evidencePartCount, 90);
  assert.equal(ingest.parts.length, 90);
  assert.deepEqual(
    ingest.parts.slice(0, 3).map((part) => part.role),
    ["daily-summary:1", "daily-summary:2", "daily-summary:3"],
  );
});

test("importDeviceBatch preserves Garmin-style explicit day keys in non-UTC vaults", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-garmin-daykey");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-03-12T12:00:00.000Z",
    timezone: "America/Los_Angeles",
  });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "garmin",
    importedAt: "2026-03-16T12:00:00.000Z",
    source: "device",
    events: [
      {
        kind: "observation",
        occurredAt: "2026-03-15T00:00:00.000Z",
        recordedAt: "2026-03-15T00:00:00.000Z",
        dayKey: "2026-03-15",
        title: "Garmin daily steps",
        evidenceRoles: ["daily-summary:2026-03-15"],
        externalRef: {
          system: "garmin",
          resourceType: "daily-summary",
          resourceId: "2026-03-15",
          version: "2026-03-15T00:00:00.000Z",
          facet: "daily-steps",
        },
        fields: {
          metric: "daily-steps",
          value: 5432,
          unit: "count",
        },
      },
    ],
    samples: [
      {
        stream: "sleep_stage",
        recordedAt: "2026-03-15T00:00:30.000Z",
        unit: "stage",
        quality: "normalized",
        externalRef: {
          system: "garmin",
          resourceType: "sleep",
          resourceId: "sleep-1",
          version: "2026-03-15T00:01:35.000Z",
          facet: "sleep-stage-light",
        },
        sample: {
          stage: "light",
          startAt: "2026-03-15T00:00:30.000Z",
          endAt: "2026-03-15T00:01:35.000Z",
          durationMinutes: 1,
        },
      },
    ],
    evidenceParts: [
      {
        role: "daily-summary:2026-03-15",
        fileName: "daily-summary-2026-03-15.json",
        mediaType: "application/json",
        content: {
          summaryDate: "2026-03-15",
          steps: 5432,
        },
      },
      {
        role: "activity-file-descriptor:activity-1:fit",
        fileName: "activity-1-fit-descriptor.json",
        mediaType: "application/json",
        content: {
          activityId: "activity-1",
          fileType: "fit",
        },
      },
    ],
  });

  assert.ok(result.applied);
  assert.equal(result.events[0]?.dayKey, "2026-03-15");
  assert.equal(result.events[0]?.timeZone, "America/Los_Angeles");
  assert.equal(result.samples[0]?.dayKey, "2026-03-14");
  assert.equal(result.samples[0]?.timeZone, "America/Los_Angeles");
  const ingest = await readRequiredIntegrationIngest(vaultRoot, result.ingestId);
  assert.ok(ingest.parts.some((part) => part.fileName === "activity-1-fit-descriptor.json"));
});

test("importDeviceBatch preserves versioned device data origin on events and samples", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-data-origin");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const dataOrigin = {
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: "dexcom-v3",
    sourceType: "cgm",
    sourceInstanceId: "source-dexcom-v3-01",
    observedAtRaw: "2026-03-16 07:30:00",
    timeZoneOffsetMinutes: null,
    timestampSemantics: "floating" as const,
    originConfidence: "high" as const,
    normalizerVersion: "junction-normalizer.v1",
  };

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-03-16T09:30:00.000Z",
    events: [{
      kind: "observation",
      occurredAt: "2026-03-16T07:30:00.000Z",
      recordedAt: "2026-03-16T07:31:00.000Z",
      title: "Junction glucose",
      externalRef: {
        system: "junction",
        resourceType: "junction-dexcom-v3-glucose",
        resourceId: "glucose-1",
        facet: "glucose",
      },
      dataOrigin,
      fields: {
        metric: "glucose",
        value: 101,
        unit: "mg_dL",
      },
    }],
    samples: [{
      stream: "glucose",
      recordedAt: "2026-03-16T07:30:00.000Z",
      unit: "mg_dL",
      externalRef: {
        system: "junction",
        resourceType: "junction-dexcom-v3-glucose",
        resourceId: "glucose-sample-1",
        facet: "sample",
      },
      dataOrigin,
      sample: {
        value: 101,
      },
    }],
  });

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.eventShardPaths[0] as string,
  })) as EventRecord[];
  const sampleRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.sampleShardPaths[0] as string,
  })) as SampleRecord[];

  assert.deepEqual(eventRecords[0]?.dataOrigin, dataOrigin);
  assert.deepEqual(sampleRecords[0]?.dataOrigin, dataOrigin);
});

test("importDeviceBatch rejects raw upstream identifiers in device data origin", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-data-origin-raw-id");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    importDeviceBatch({
      vaultRoot,
      provider: "junction",
      importedAt: "2026-03-16T09:30:00.000Z",
      events: [{
        kind: "observation",
        occurredAt: "2026-03-16T07:30:00.000Z",
        dataOrigin: {
          version: 1,
          aggregatorProvider: "junction",
          sourceProviderSlug: "dexcom-v3",
          sourceDeviceId: "raw-device-id",
        },
        fields: {
          metric: "glucose",
          value: 101,
          unit: "mg_dL",
        },
      }],
    }),
    (error) => error instanceof VaultError && error.code === "VAULT_INVALID_DATA_ORIGIN",
  );
});

test("importDeviceBatch keeps canonical manifest provenance authoritative over caller overrides", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-provenance");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const attemptedOverrides = {
    provider: "spoofed-provider",
    accountId: "spoofed-account",
    importedAt: "1900-01-01T00:00:00.000Z",
    eventCount: 999,
    sampleCount: 888,
    eventIds: ["evt_spoofed"],
    sampleIds: ["sample_spoofed"],
    evidenceParts: [
      {
        role: "spoofed-role",
        relativePath: "raw/integrations/spoofed/1900/01/xfm_spoofed/spoofed.json",
        sha256: "0".repeat(64),
        metadata: {
          upstreamId: "spoofed-upstream-id",
        },
      },
    ],
    syncMode: "manual",
  };
  const result = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-03-16T09:30:00.000Z",
    events: [
      {
        kind: "observation",
        occurredAt: "2026-03-16T07:30:00.000Z",
        recordedAt: "2026-03-16T07:30:00.000Z",
        title: "WHOOP recovery score",
        fields: {
          metric: "recovery-score",
          value: 67,
          unit: "%",
        },
      },
    ],
    samples: [
      {
        stream: "hrv",
        recordedAt: "2026-03-16T07:30:00.000Z",
        unit: "ms",
        sample: {
          recordedAt: "2026-03-16T07:30:00.000Z",
          value: 42.5,
        },
      },
    ],
    evidenceParts: [
      {
        role: "recovery:sleep-1",
        content: {
          sleep_id: "sleep-1",
          updated_at: "2026-03-16T07:30:00.000Z",
          score: { recovery_score: 67, hrv_rmssd_milli: 42.5 },
        },
        metadata: {
          upstreamId: "sleep-1",
        },
      },
    ],
    provenance: attemptedOverrides,
  });

  assert.ok(result.applied);
  const ingest = await readRequiredIntegrationIngest(vaultRoot, result.ingestId);

  assert.equal(ingest.provider, "whoop");
  assert.equal(ingest.accountId, "whoop-user-1");
  assert.equal(ingest.importedAt, "2026-03-16T09:30:00.000Z");
  assert.equal(ingest.counts.eventCount, result.events.length);
  assert.equal(ingest.counts.sampleCount, result.samples.length);
  assert.equal(ingest.parts.length, 1);
  assert.equal(ingest.parts[0]?.role, "recovery:sleep-1");
  assert.notEqual(
    ingest.parts[0]?.sha256,
    attemptedOverrides.evidenceParts[0]?.sha256,
  );
  assert.deepEqual(ingest.parts[0]?.metadata, {
    upstreamId: "sleep-1",
  });
  assert.deepEqual(ingest.provenance, attemptedOverrides);
});

test("importDeviceBatch retries reuse deterministic ids without duplicating ledgers", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-retry");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const input = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-03-16T09:30:00.000Z",
    events: [
      {
        kind: "observation",
        occurredAt: "2026-03-16T07:30:00.000Z",
        recordedAt: "2026-03-16T07:30:00.000Z",
        title: "WHOOP recovery score",
        externalRef: {
          system: "whoop",
          resourceType: "recovery",
          resourceId: "sleep-1",
          version: "2026-03-16T07:30:00.000Z",
          facet: "recovery-score",
        },
        fields: {
          metric: "recovery-score",
          value: 67,
          unit: "%",
        },
      },
    ],
    samples: [
      {
        stream: "hrv",
        recordedAt: "2026-03-16T07:30:00.000Z",
        unit: "ms",
        quality: "normalized",
        externalRef: {
          system: "whoop",
          resourceType: "recovery",
          resourceId: "sleep-1",
          version: "2026-03-16T07:30:00.000Z",
          facet: "hrv",
        },
        sample: {
          recordedAt: "2026-03-16T07:30:00.000Z",
          value: 42.5,
        },
      },
    ],
    evidenceParts: [
      {
        role: "recovery:sleep-1",
        fileName: "recovery-sleep-1.json",
        content: {
          sleep_id: "sleep-1",
          updated_at: "2026-03-16T07:30:00.000Z",
          score: { recovery_score: 67, hrv_rmssd_milli: 42.5 },
        },
      },
    ],
  } as const;

  const [first, second] = await Promise.all([importDeviceBatch(input), importDeviceBatch(input)]);
  const results = [first, second];
  const applied = results.find((result) => result.applied);
  const noop = results.find((result) => !result.applied);

  assert.ok(applied?.applied);
  assert.ok(noop && !noop.applied);

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];
  const sampleRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.sampleShardPaths[0] as string,
  })) as SampleRecord[];

  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal(noop.ingestId, null);
  assert.equal(noop.auditPath, null);
  assert.equal(noop.persistedEvidencePartCount, 0);
  assert.equal(first.events[0]?.id, second.events[0]?.id);
  assert.equal(first.samples[0]?.id, second.samples[0]?.id);
  assert.equal(applied.ingestId, "xfm_W9VPQSQBYY653RHF4V96TWF0F6");
  assert.equal(first.events[0]?.id, "evt_30XC16ZG27S0ZM4TMPHDKJX7KP");
  assert.equal(first.samples[0]?.id, "smp_VJ3AZR2JBQVE89Z6B84EA60H0G");
  assert.equal(eventRecords.length, 1);
  assert.equal(sampleRecords.length, 1);
  const storedDelivery = await readRequiredIntegrationIngest(vaultRoot, applied.ingestId);
  assert.deepEqual(storedDelivery.outputs.events, [
    { id: applied.events[0]?.id, roles: ["recovery:sleep-1"] },
  ]);
  assert.deepEqual(storedDelivery.outputs.sampleIds, [applied.samples[0]?.id]);
});

test("importDeviceBatch falls back to the sole raw artifact when events omit explicit roles", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-single-raw");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    importedAt: "2026-03-16T09:30:00.000Z",
    events: [
      {
        kind: "note",
        occurredAt: "2026-03-16T09:30:00.000Z",
        recordedAt: "2026-03-16T09:30:00.000Z",
        note: "single raw fallback",
      },
    ],
    evidenceParts: [
      {
        content: {
          upstream: "payload",
        },
      },
    ],
  });

  assert.ok(result.applied);
  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.eventShardPaths[0] as string,
  })) as EventRecord[];
  const ingest = await readRequiredIntegrationIngest(vaultRoot, result.ingestId);

  assert.equal(result.ingestId, "xfm_RJYQQADKR5GN1K6R0ZJ4W9ETEB");
  assert.equal(result.events[0]?.id, "evt_2TSF1SDWFHHSQ8503JWDHCF47K");
  assert.equal(eventRecords[0]?.kind, "note");
  assert.deepEqual(eventRecords, [
    {
      schemaVersion: "murph.event.v1",
      id: "evt_2TSF1SDWFHHSQ8503JWDHCF47K",
      kind: "note",
      occurredAt: "2026-03-16T09:30:00.000Z",
      recordedAt: "2026-03-16T09:30:00.000Z",
      dayKey: "2026-03-16",
      timeZone: "UTC",
      source: "device",
      title: "note",
      note: "single raw fallback",
    },
  ]);
  assert.deepEqual(ingest.outputs.events, [
    { id: "evt_2TSF1SDWFHHSQ8503JWDHCF47K", roles: ["artifact-1"] },
  ]);
  assert.equal(ingest.parts[0]?.role, "artifact-1");
  assert.equal(ingest.parts[0]?.fileName, "whoop-01.json");
});

test("importDeviceBatch writes Date raw artifact values as ISO strings", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-date-raw");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-04-22T12:00:00.000Z",
    evidenceParts: [
      {
        role: "provider-snapshot",
        fileName: "snapshot.json",
        content: {
          importedAt: new Date("2026-04-22T12:00:00.000Z"),
          nested: {
            windowStart: new Date("2026-04-22T00:00:00.000Z"),
          },
        },
      },
    ],
  });

  assert.ok(result.applied);
  const ingest = await readRequiredIntegrationIngest(vaultRoot, result.ingestId);
  const rawText = ingest.parts[0]?.content ?? "";

  assert.equal(
    rawText,
    '{"importedAt":"2026-04-22T12:00:00.000Z","nested":{"windowStart":"2026-04-22T00:00:00.000Z"}}\n',
  );
});

test("importDeviceBatch rejects invalid Date raw artifact values", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-invalid-date-raw");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "junction",
        importedAt: "2026-04-22T12:00:00.000Z",
        evidenceParts: [
          {
            role: "provider-snapshot",
            fileName: "snapshot.json",
            content: {
              importedAt: new Date("not-a-date"),
            },
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_RAW_CONTENT",
  );
});

test("importDeviceBatch does not implicitly attach synthetic wearable receipts as raw evidence", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-receipt-fallback");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-03-16T09:30:00.000Z",
    source: "device",
    events: [
      {
        kind: "note",
        occurredAt: "2026-03-16T09:30:00.000Z",
        title: "implicit receipt fallback",
        note: "receipt should not become provider evidence",
      },
      {
        kind: "note",
        occurredAt: "2026-03-16T09:31:00.000Z",
        title: "explicit receipt reference",
        note: "explicit references are still honored",
        evidenceRoles: ["wearable-raw-receipt:wearable_raw_test"],
      },
    ],
    evidenceParts: [
      {
        role: "wearable-raw-receipt:wearable_raw_test",
        fileName: "receipt.json",
        mediaType: "application/json",
        content: {
          schemaVersion: "wearable.raw_ingest_receipt.v1",
          id: "wearable_raw_test",
          payloadHash: "sha256:test",
        },
      },
    ],
  });

  assert.ok(result.applied);
  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(eventRecords[0]?.title, "implicit receipt fallback");
  assert.equal(Object.hasOwn(eventRecords[0] ?? {}, "rawRefs"), false);
  assert.equal(Object.hasOwn(eventRecords[1] ?? {}, "rawRefs"), false);
  const ingest = await readRequiredIntegrationIngest(vaultRoot, result.ingestId);
  const rolesByEventId = new Map(ingest.outputs.events.map((event) => [event.id, event.roles]));
  assert.deepEqual(rolesByEventId.get(eventRecords[0]?.id ?? ""), []);
  assert.deepEqual(rolesByEventId.get(eventRecords[1]?.id ?? ""), ["wearable-raw-receipt:wearable_raw_test"]);
});

test("importDeviceBatch supports sample-only batches without raw artifacts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-sample-only");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    importedAt: "2026-03-16T09:30:00.000Z",
    samples: [
      {
        stream: "respiratory_rate",
        unit: "breaths_per_minute",
        sample: {
          recordedAt: "2026-03-16T07:30:00.000Z",
          value: 14.8,
        },
      },
    ],
  });

  const sampleRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.sampleShardPaths[0] as string,
  })) as SampleRecord[];

  assert.equal(result.ingestId, "xfm_FXSGXYHNPXP927CSE1YHR3YD0T");
  assert.equal(result.samples[0]?.id, "smp_Z2ZBJH4EBC7QVGQ5CQ8G95M8R4");
  assert.equal(result.ingestShardPath, "ledger/integration-ingests/2026/2026-03.jsonl");
  assert.equal(result.evidencePartCount, 0);
  assert.deepEqual(sampleRecords, [
    {
      schemaVersion: "murph.sample.v1",
      id: "smp_Z2ZBJH4EBC7QVGQ5CQ8G95M8R4",
      dayKey: "2026-03-16",
      timeZone: "UTC",
      stream: "respiratory_rate",
      recordedAt: "2026-03-16T07:30:00.000Z",
      source: "device",
      quality: "normalized",
      value: 14.8,
      unit: "breaths_per_minute",
    },
  ]);
});

test("importDeviceBatch rejects empty batches", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-empty");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    () => importDeviceBatch({ vaultRoot, provider: "whoop" }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_DEVICE_BATCH",
  );
});

test("importDeviceBatch rejects unsupported event kinds and invalid event fields", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-event-errors");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        events: [
          {
            kind: "bogus",
            occurredAt: "2026-03-16T07:30:00.000Z",
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_UNSUPPORTED_EVENT_KIND",
  );

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        events: [
          {
            kind: "note",
            occurredAt: "2026-03-16T07:30:00.000Z",
            note: "bad fields",
            fields: invalidTestValue<Record<string, unknown>>("not-an-object"),
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_EVENT_FIELDS",
  );
});

test("importDeviceBatch rejects unsupported sample streams and missing sample payloads", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-sample-errors");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        samples: [
          {
            stream: invalidTestValue<"hrv">("oxygen"),
            unit: "%",
            sample: {
              recordedAt: "2026-03-16T07:30:00.000Z",
              value: 97,
            },
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_UNSUPPORTED_SAMPLE_STREAM",
  );

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        samples: [
          {
            stream: "hrv",
            unit: "ms",
            sample: invalidTestValue<Record<string, unknown>>(null),
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_SAMPLE",
  );
});

test("importDeviceBatch validates canonical payloads before raw artifact errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-validation-order");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        events: [
          {
            kind: "note",
            occurredAt: "2026-03-16T07:30:00.000Z",
            evidenceRoles: ["missing"],
          },
        ],
        evidenceParts: [
          { role: "other", content: { payload: true } },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EVENT_INVALID",
  );

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        samples: [
          {
            stream: "heart_rate",
            unit: "bpm",
            sample: {
              recordedAt: "2026-03-16T07:30:00.000Z",
              value: 72.5,
            },
          },
        ],
        evidenceParts: [
          {
            content: { payload: true },
            metadata: invalidTestValue<Record<string, unknown>>("bad"),
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "SAMPLE_INVALID",
  );
});

test("importDeviceBatch rejects duplicate raw roles and missing raw-role references", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-raw-errors");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        evidenceParts: [
          { role: "dup", content: { one: true } },
          { role: "dup", content: { two: true } },
        ],
    }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_DUPLICATE_EVIDENCE_ROLE",
  );

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        events: [
          {
            kind: "note",
            occurredAt: "2026-03-16T07:30:00.000Z",
            note: "missing role",
            evidenceRoles: ["missing"],
          },
        ],
        evidenceParts: [
          { role: "other", content: { payload: true } },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_EVIDENCE_ROLE_MISSING",
  );
});

test("importDeviceBatch rejects invalid provenance, raw metadata, and empty raw content", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-metadata-errors");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        provenance: invalidTestValue<Record<string, unknown>>("not-an-object"),
        evidenceParts: [
          { content: { payload: true } },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_DEVICE_PROVENANCE",
  );

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        evidenceParts: [
          {
            content: { payload: true },
            metadata: invalidTestValue<Record<string, unknown>>("bad"),
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_RAW_ARTIFACT",
  );

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        evidenceParts: [
          {
            content: invalidTestValue<string>(undefined),
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_RAW_CONTENT",
  );
});

test("prepareRawArtifact and prepareInlineRawArtifact support integration snapshots", () => {
  const copied = prepareRawArtifact({
    sourcePath: "/tmp/snapshot.json",
    owner: {
      kind: "device_batch",
      id: "xfm_01JQ9R7WF97M1WAB2B4QF2Q1AB",
      partition: "whoop",
    },
    occurredAt: "2026-03-16T09:30:00.000Z",
    targetName: "snapshot.json",
  });
  const inline = prepareInlineRawArtifact({
    fileName: "payload.json",
    owner: {
      kind: "device_batch",
      id: "xfm_01JQ9R7WF97M1WAB2B4QF2Q1AB",
      partition: "whoop",
    },
    occurredAt: "2026-03-16T09:30:00.000Z",
    targetName: "01-payload.json",
    mediaType: "application/json",
  });

  assert.equal(
    copied.relativePath,
    "raw/integrations/whoop/2026/03/xfm_01JQ9R7WF97M1WAB2B4QF2Q1AB/snapshot.json",
  );
  assert.equal(
    inline.relativePath,
    "raw/integrations/whoop/2026/03/xfm_01JQ9R7WF97M1WAB2B4QF2Q1AB/01-payload.json",
  );
  assert.equal(inline.originalFileName, "payload.json");
  assert.equal(inline.mediaType, "application/json");
});

test("raw artifact helpers normalize category paths and inferred media types", () => {
  const occurredAt = "2026-03-16T09:30:00.000Z";

  const cases = [
    {
      artifact: prepareRawArtifact({
        sourcePath: "/tmp/Lab Result.PDF",
        owner: {
          kind: "document",
          id: "doc_01JQ9R7WF97M1WAB2B4QF2Q1A1",
        },
        occurredAt,
        targetName: "Lab Result.PDF",
      }),
      relativePath: "raw/documents/2026/03/doc_01JQ9R7WF97M1WAB2B4QF2Q1A1/lab-result.pdf",
      originalFileName: "Lab Result.PDF",
      mediaType: "application/pdf",
    },
    {
      artifact: prepareRawArtifact({
        sourcePath: "/tmp/Breakfast Photo.JPG",
        owner: {
          kind: "meal",
          id: "meal_01JQ9R7WF97M1WAB2B4QF2Q1A2",
        },
        occurredAt,
        role: "Photo 01",
        targetName: "Breakfast Photo.JPG",
      }),
      relativePath:
        "raw/meals/2026/03/meal_01JQ9R7WF97M1WAB2B4QF2Q1A2/photo-01-breakfast-photo.jpg",
      originalFileName: "Breakfast Photo.JPG",
      mediaType: "image/jpeg",
    },
    {
      artifact: prepareRawArtifact({
        sourcePath: "/tmp/Voice Note.M4A",
        owner: {
          kind: "meal",
          id: "meal_01JQ9R7WF97M1WAB2B4QF2Q1A3",
        },
        occurredAt,
        role: "Audio 02",
        targetName: "Voice Note.M4A",
      }),
      relativePath:
        "raw/meals/2026/03/meal_01JQ9R7WF97M1WAB2B4QF2Q1A3/audio-02-voice-note.m4a",
      originalFileName: "Voice Note.M4A",
      mediaType: "audio/mp4",
    },
    {
      artifact: prepareRawArtifact({
        sourcePath: "/tmp/Resting HRV.JSON",
        owner: {
          kind: "sample_batch",
          id: "xfm_01JQ9R7WF97M1WAB2B4QF2Q1A4",
          partition: "hrv",
        },
        occurredAt,
        targetName: "Resting HRV.JSON",
      }),
      relativePath: "raw/samples/hrv/2026/03/xfm_01JQ9R7WF97M1WAB2B4QF2Q1A4/resting-hrv.json",
      originalFileName: "Resting HRV.JSON",
      mediaType: "application/json",
    },
    {
      artifact: prepareRawArtifact({
        sourcePath: "/tmp/Assessment Source.TXT",
        owner: {
          kind: "assessment",
          id: "asmt_01JQ9R7WF97M1WAB2B4QF2Q1A5",
        },
        occurredAt,
        targetName: "Assessment Source.TXT",
      }),
      relativePath: "raw/assessments/2026/03/asmt_01JQ9R7WF97M1WAB2B4QF2Q1A5/source.json",
      originalFileName: "Assessment Source.TXT",
      mediaType: "text/plain",
    },
    {
      artifact: prepareRawArtifact({
        sourcePath: "/tmp/Snapshot.JSON",
        owner: {
          kind: "device_batch",
          id: "xfm_01JQ9R7WF97M1WAB2B4QF2Q1AB",
          partition: "whoop",
        },
        occurredAt,
        targetName: "Snapshot.JSON",
      }),
      relativePath: "raw/integrations/whoop/2026/03/xfm_01JQ9R7WF97M1WAB2B4QF2Q1AB/snapshot.json",
      originalFileName: "Snapshot.JSON",
      mediaType: "application/json",
    },
    {
      artifact: prepareRawArtifact({
        sourcePath: "/tmp/Body Weight.CSV",
        owner: {
          kind: "measurement",
          id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1A6",
        },
        occurredAt,
        targetName: "Body Weight.CSV",
      }),
      relativePath: "raw/measurements/2026/03/evt_01JQ9R7WF97M1WAB2B4QF2Q1A6/body-weight.csv",
      originalFileName: "Body Weight.CSV",
      mediaType: "text/csv",
    },
    {
      artifact: prepareRawArtifact({
        sourcePath: "/tmp/Workout Session.WEBM",
        owner: {
          kind: "workout",
          id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1A7",
        },
        occurredAt,
        targetName: "Workout Session.WEBM",
      }),
      relativePath: "raw/workouts/2026/03/evt_01JQ9R7WF97M1WAB2B4QF2Q1A7/workout-session.webm",
      originalFileName: "Workout Session.WEBM",
      mediaType: "video/webm",
    },
  ] as const;

  for (const { artifact, relativePath, originalFileName, mediaType } of cases) {
    assert.equal(artifact.relativePath, relativePath);
    assert.equal(artifact.originalFileName, originalFileName);
    assert.equal(artifact.mediaType, mediaType);
  }

  const inferredInline = prepareInlineRawArtifact({
    fileName: "Payload.BIN",
    owner: {
      kind: "document",
      id: "doc_01JQ9R7WF97M1WAB2B4QF2Q1A8",
    },
    occurredAt,
    targetName: "Payload.BIN",
  });
  const explicitInline = prepareInlineRawArtifact({
    fileName: "Payload.JSON",
    owner: {
      kind: "device_batch",
      id: "xfm_01JQ9R7WF97M1WAB2B4QF2Q1AB",
      partition: "whoop",
    },
    occurredAt,
    targetName: "Payload.JSON",
    mediaType: "application/json",
  });

  assert.equal(
    inferredInline.relativePath,
    "raw/documents/2026/03/doc_01JQ9R7WF97M1WAB2B4QF2Q1A8/payload.bin",
  );
  assert.equal(inferredInline.mediaType, "application/octet-stream");
  assert.equal(
    explicitInline.relativePath,
    "raw/integrations/whoop/2026/03/xfm_01JQ9R7WF97M1WAB2B4QF2Q1AB/payload.json",
  );
  assert.equal(explicitInline.mediaType, "application/json");
});

function buildJunctionStyleWorkoutEvent(overrides: {
  occurredAt?: string;
  recordedAt?: string;
  durationMinutes?: number;
  heartRateZones?: Array<{
    zone?: number;
    label?: string;
    minHeartRate?: number;
    maxHeartRate?: number;
    durationMinutes?: number;
  }>;
  resourceId?: string;
  resourceType?: string;
  sourceApp?: string;
  sourceWorkoutId?: string;
} = {}) {
  return {
    kind: "activity_session",
    occurredAt: overrides.occurredAt ?? "2026-06-03T19:55:00.000Z",
    recordedAt: overrides.recordedAt ?? "2026-06-03T20:30:00.000Z",
    title: "Running",
    externalRef: {
      system: "junction",
      resourceType: overrides.resourceType ?? "junction-whoop-v2-workouts",
      resourceId: overrides.resourceId ?? "workouts-393350f4b34bad8c",
      facet: "session",
    },
    fields: {
      durationMinutes: overrides.durationMinutes ?? 34,
      activityType: "running",
      workout: {
        sourceApp: overrides.sourceApp ?? "whoop",
        sourceWorkoutId: overrides.sourceWorkoutId ?? "whoop-workout-1",
        startedAt: "2026-06-03T19:55:00.000Z",
        endedAt: "2026-06-03T20:29:00.000Z",
        heartRateZones: overrides.heartRateZones,
        exercises: [],
      },
    },
  } as const;
}

test("importDeviceBatch dedupes overlapping re-imports by externalRef across unstable accountIds", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-externalref-dedupe");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (accountId: string, importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId,
    importedAt,
    events: [buildJunctionStyleWorkoutEvent()],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: { id: "whoop-workout-1", sport: "running" },
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("jxn_acct_cold_start_a", "2026-06-03T21:00:00.000Z"));
  const second = await importDeviceBatch(buildInput("jxn_acct_cold_start_b", "2026-06-04T21:00:00.000Z"));
  const third = await importDeviceBatch(buildInput("jxn_acct_cold_start_c", "2026-06-05T21:00:00.000Z"));

  assert.ok(first.applied);
  assert.ok(second.applied);
  assert.ok(third.applied);
  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];
  const auditRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: second.auditPath,
  })) as AuditRecord[];

  assert.equal(eventRecords.length, 1);
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 1);
  assert.equal(third.events.length, 1);
  assert.equal(second.events[0]?.id, first.events[0]?.id);
  assert.equal(third.events[0]?.id, first.events[0]?.id);
  assert.ok(first.eventShardPaths.length > 0);
  assert.deepEqual(second.eventShardPaths, first.eventShardPaths);
  assert.deepEqual(third.eventShardPaths, first.eventShardPaths);
  assert.ok(
    auditRecords.some((record) =>
      record.summary.includes("1 duplicate event(s) skipped by externalRef"),
    ),
    "expected the device import audit summary to surface externalRef dedupe",
  );
});

test("importDeviceBatch rejects changed content for immutable externalRefs while keeping exact replay idempotent", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-immutable-externalref");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const immutableEvent = {
    ...buildJunctionStyleWorkoutEvent(),
    externalRefUpdatePolicy: "immutable" as const,
  };
  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [immutableEvent],
  });
  const replay = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [immutableEvent],
  });

  assert.equal(replay.events[0]?.id, first.events[0]?.id);

  await assert.rejects(
    () => importDeviceBatch({
      vaultRoot,
      provider: "junction",
      importedAt: "2026-06-05T21:00:00.000Z",
      events: [{
        ...immutableEvent,
        fields: {
          ...immutableEvent.fields,
          durationMinutes: 35,
        },
      }],
    }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EVENT_IMMUTABLE_EXTERNAL_REF_CONFLICT",
  );

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];
  assert.equal(eventRecords.length, 1);
});

test("importDeviceBatch retracts omitted facets from a newer bounded authoritative snapshot", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-authoritative-facets");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  const identity = {
    system: "junction",
    resourceType: "junction-apple-health-profile",
    resourceId: "profile-stable-1",
  } as const;
  const facet = "profile-demographics";
  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-05-01T09:00:00.000Z",
    events: [{
      kind: "note",
      occurredAt: "2026-05-01T08:00:00.000Z",
      recordedAt: "2026-05-01T09:00:00.000Z",
      title: "Junction profile",
      note: "Reported gender: other.",
      externalRef: {
        ...identity,
        facet,
        version: "2026-05-01T08:00:00.000Z",
      },
      fields: { reportedGender: "other" },
    }],
    authoritativeEventSets: [{
      ...identity,
      version: "2026-05-01T08:00:00.000Z",
      facetPrefixes: [facet],
      currentFacets: [facet],
    }],
    evidenceParts: [{
      role: "junction-summary-profile",
      fileName: "profile.json",
      content: { revision: 1 },
    }],
  });
  const correctionInput = {
    vaultRoot,
    provider: "junction",
    importedAt: "2026-05-02T09:00:00.000Z",
    events: [],
    authoritativeEventSets: [{
      ...identity,
      version: "2026-05-02T08:00:00.000Z",
      facetPrefixes: [facet],
      currentFacets: [],
    }],
    evidenceParts: [{
      role: "junction-summary-profile",
      fileName: "profile.json",
      content: { revision: 2 },
    }],
  };
  const correction = await importDeviceBatch(correctionInput);
  const replay = await importDeviceBatch(correctionInput);
  const eventShardPath = first.eventShardPaths[0];
  assert.ok(eventShardPath);
  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  })) as EventRecord[];
  const tombstone = eventRecords.find((record) => record.lifecycle?.revision === 2);

  assert.equal(correction.applied, true);
  assert.equal(correction.events.length, 0);
  assert.deepEqual(correction.eventShardPaths, [eventShardPath]);
  assert.equal(replay.applied, false);
  assert.equal(replay.ingestId, null);
  assert.equal(eventRecords.length, 2);
  assert.equal(tombstone?.id, first.events[0]?.id);
  assert.equal(tombstone?.lifecycle?.state, "deleted");
});

test("importDeviceBatch rejects authoritative resources above the composed 514-facet maximum", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-authoritative-facet-limit");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  const identity = {
    system: "junction",
    resourceType: "junction-apple-health-menstrual-cycle",
    resourceId: "cycle-over-limit",
  } as const;
  const version = "2026-05-02T08:00:00.000Z";
  const facets = Array.from(
    { length: 515 },
    (_, index) => `menstrual-flow-2026-05-01-${String(index).padStart(3, "0")}`,
  );
  const before = await snapshotVaultFiles(vaultRoot);

  await assert.rejects(
    importDeviceBatch({
      vaultRoot,
      provider: "junction",
      importedAt: "2026-05-02T09:00:00.000Z",
      events: facets.map((facet, index) => ({
        kind: "measurement",
        occurredAt: "2026-05-01T12:00:00.000Z",
        recordedAt: version,
        title: "Junction menstrual flow",
        externalRef: { ...identity, facet, version },
        fields: {
          measurements: [{
            metric: "menstrual-flow",
            value: (index % 3) + 1,
            unit: "score",
          }],
        },
      })),
      authoritativeEventSets: [{
        ...identity,
        version,
        facetPrefixes: ["menstrual-flow"],
        currentFacets: facets,
      }],
    }),
    (error) => error instanceof VaultError && error.code === "VAULT_INVALID_INPUT",
  );

  assert.deepEqual(await snapshotVaultFiles(vaultRoot), before);
});

test("importDeviceBatch makes byte-identical overlap a storage no-op for one provider account", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-storage-idempotency");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt,
    events: [
      {
        ...buildJunctionStyleWorkoutEvent(),
        evidenceRoles: ["junction-summary-workouts"],
      },
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: { id: "whoop-workout-1", sport: "running" },
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z"));
  assert.ok(first.applied);
  const eventShardPath = first.eventShardPaths[0];
  assert.ok(eventShardPath);
  const persistedPaths = [first.ingestShardPath, first.auditPath, eventShardPath];
  const beforeReplay = await Promise.all(
    persistedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath), "utf8")),
  );

  const replay = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z"));
  const afterReplay = await Promise.all(
    persistedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath), "utf8")),
  );

  assert.equal(replay.applied, false);
  assert.equal(replay.ingestId, null);
  assert.equal(replay.ingestShardPath, null);
  assert.equal(replay.auditPath, null);
  assert.equal(replay.evidencePartCount, 1);
  assert.equal(replay.persistedEvidencePartCount, 0);
  assert.equal(replay.events[0]?.id, first.events[0]?.id);
  assert.deepEqual(afterReplay, beforeReplay);
});

test("importDeviceBatch retains changed evidence for an unchanged event and maps it to that event", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-changed-evidence");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (importedAt: string, rawScore: number) => ({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt,
    events: [
      {
        ...buildJunctionStyleWorkoutEvent(),
        evidenceRoles: ["junction-summary-workouts"],
      },
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: { id: "whoop-workout-1", rawScore, sport: "running" },
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z", 10));
  const changedEvidence = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z", 11));
  const replay = await importDeviceBatch(buildInput("2026-06-05T21:00:00.000Z", 11));

  assert.ok(first.applied);
  assert.ok(changedEvidence.applied);
  assert.equal(replay.applied, false);
  assert.equal(changedEvidence.persistedEvidencePartCount, 1);
  const changedIngest = await readRequiredIntegrationIngest(vaultRoot, changedEvidence.ingestId);
  assert.deepEqual(changedIngest.outputs.events, [
    {
      id: first.events[0]?.id,
      roles: ["junction-summary-workouts"],
    },
  ]);
  const eventRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];
  assert.equal(eventRows.length, 1);
});

test("importDeviceBatch retains only changed evidence from a repeated multi-part delivery and exact replay no-ops", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-incremental-evidence");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const unchangedRole = "junction-summary-activity";
  const changedRole = "junction-summary-sleep-cycle";
  const buildInput = (importedAt: string, sleepRevision: number) => ({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt,
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({
          resourceId: "activity-incremental-evidence",
          sourceWorkoutId: "activity-incremental-evidence",
        }),
        evidenceRoles: [unchangedRole],
      },
      {
        ...buildJunctionStyleWorkoutEvent({
          occurredAt: "2026-06-03T22:00:00.000Z",
          recordedAt: "2026-06-03T22:35:00.000Z",
          resourceId: "sleep-incremental-evidence",
          sourceWorkoutId: "sleep-incremental-evidence",
        }),
        evidenceRoles: [changedRole],
      },
    ],
    evidenceParts: [
      {
        role: unchangedRole,
        fileName: "junction-summary-activity.json",
        content: { date: "2026-06-03", steps: 8_000 },
      },
      {
        role: changedRole,
        fileName: "junction-summary-sleep-cycle.json",
        content: { date: "2026-06-03", revision: sleepRevision },
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z", 1));
  const changedInput = buildInput("2026-06-04T21:00:00.000Z", 2);
  const changed = await importDeviceBatch(changedInput);
  assert.ok(changed.ingestId);
  const changedIngest = await readRequiredIntegrationIngest(vaultRoot, changed.ingestId);
  const beforeReplay = await snapshotVaultFiles(vaultRoot);
  const replay = await importDeviceBatch(changedInput);

  assert.ok(first.applied);
  assert.ok(changed.applied);
  assert.equal(first.persistedEvidencePartCount, 2);
  assert.equal(changed.evidencePartCount, 2);
  assert.equal(changed.persistedEvidencePartCount, 1);
  assert.equal(replay.applied, false);
  assert.equal(replay.ingestId, null);
  assert.equal(replay.auditPath, null);
  assert.equal(replay.persistedEvidencePartCount, 0);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplay);
  assert.deepEqual(changedIngest.parts.map((part) => part.role), [changedRole]);
  assert.deepEqual(changedIngest.outputs.events, [
    { id: first.events[0]?.id, roles: [] },
    { id: first.events[1]?.id, roles: [changedRole] },
  ].sort((left, right) => (left.id ?? "").localeCompare(right.id ?? "")));
});

test("importDeviceBatch retains unchanged evidence for a newly appended event revision", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-revised-event-evidence");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const evidenceRole = "junction-summary-workouts";
  const evidencePart = {
    role: evidenceRole,
    fileName: "junction-summary-workouts.json",
    content: { id: "workouts-revised-event", sport: "running" },
  };
  const buildInput = (importedAt: string, durationMinutes: number) => ({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt,
    events: [{
      ...buildJunctionStyleWorkoutEvent({
        durationMinutes,
        resourceId: "workouts-revised-event",
      }),
      evidenceRoles: [evidenceRole],
    }],
    evidenceParts: [evidencePart],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z", 34));
  const revised = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z", 35));
  const replay = await importDeviceBatch(buildInput("2026-06-05T21:00:00.000Z", 35));

  assert.ok(first.applied);
  assert.ok(revised.applied);
  assert.equal(revised.events[0]?.id, first.events[0]?.id);
  assert.equal(revised.events[0]?.lifecycle?.revision, 2);
  assert.equal(revised.persistedEvidencePartCount, 1);
  assert.equal(replay.applied, false);
  const revisedIngest = await readRequiredIntegrationIngest(vaultRoot, revised.ingestId);
  assert.deepEqual(revisedIngest.parts.map((part) => part.role), [evidenceRole]);
  assert.deepEqual(revisedIngest.outputs.events, [{
    id: first.events[0]?.id,
    roles: [evidenceRole],
  }]);
});

test.each(["earlier-shard", "complete-spine"] as const)(
  "filtered incremental replay fails closed after %s loss",
  async (lossMode) => {
    const vaultRoot = await makeTempDirectory(
      `murph-device-import-filtered-replay-${lossMode}`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T12:00:00.000Z" });
    const unchangedRole = "junction-summary-activity";
    const changedRole = "junction-summary-workouts";
    const buildInput = (importedAt: string, workoutRevision: number) => ({
      vaultRoot,
      provider: "junction",
      accountId: "jxn_acct_filtered_replay",
      importedAt,
      events: [
        {
          ...buildJunctionStyleWorkoutEvent({
            occurredAt: "2026-01-03T19:55:00.000Z",
            recordedAt: "2026-01-03T20:30:00.000Z",
            resourceId: "filtered-replay-activity",
            sourceWorkoutId: "filtered-replay-activity",
          }),
          evidenceRoles: [unchangedRole],
        },
        {
          ...buildJunctionStyleWorkoutEvent({
            occurredAt: "2026-02-03T19:55:00.000Z",
            recordedAt: "2026-02-03T20:30:00.000Z",
            resourceId: "filtered-replay-workout",
            sourceWorkoutId: "filtered-replay-workout",
          }),
          evidenceRoles: [changedRole],
        },
      ],
      evidenceParts: [
        {
          role: unchangedRole,
          fileName: "junction-summary-activity.json",
          content: { date: "2026-01-03", steps: 8_000 },
        },
        {
          role: changedRole,
          fileName: "junction-summary-workouts.json",
          content: {
            id: "filtered-replay-workout",
            revision: workoutRevision,
            sport: "running",
          },
        },
      ],
    });

    const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z", 1));
    const filteredInput = buildInput("2026-06-04T21:00:00.000Z", 2);
    const filtered = await importDeviceBatch(filteredInput);

    assert.equal(filtered.events[0]?.id, first.events[0]?.id);
    assert.equal(filtered.events[1]?.id, first.events[1]?.id);
    assert.equal(filtered.persistedEvidencePartCount, 1);
    assert.ok(filtered.ingestId);
    const filteredIngest = await readRequiredIntegrationIngest(vaultRoot, filtered.ingestId);
    assert.deepEqual(filteredIngest.parts.map((part) => part.role), [changedRole]);
    assert.deepEqual(filteredIngest.outputs.events, [
      { id: first.events[0]?.id, roles: [] },
      { id: first.events[1]?.id, roles: [changedRole] },
    ].sort((left, right) => (left.id ?? "").localeCompare(right.id ?? "")));
    const beforeIntactReplay = await snapshotVaultFiles(vaultRoot);
    const intactReplay = await importDeviceBatch(filteredInput);
    assert.equal(intactReplay.applied, false);
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeIntactReplay);

    const filteredEventShardPath = filtered.eventShardPaths[0];
    assert.ok(filteredEventShardPath);
    if (lossMode === "earlier-shard") {
      await fs.unlink(path.join(vaultRoot, filteredEventShardPath));
    } else {
      for (const eventShardPath of new Set([
        ...first.eventShardPaths,
        ...filtered.eventShardPaths,
      ])) {
        await fs.unlink(path.join(vaultRoot, eventShardPath));
      }
    }
    const beforeRejectedReplay = await snapshotVaultFiles(vaultRoot);

    await assert.rejects(
      importDeviceBatch(filteredInput),
      (error) =>
        error instanceof VaultError
        && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
    );
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedReplay);
  },
);

test("importDeviceBatch retains complete evidence when novel evidence has no event association", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-unassociated-evidence");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const associatedRole = "junction-summary-workouts";
  const unassociatedRole = "junction-summary-activity";
  const associatedPart = {
    role: associatedRole,
    fileName: "junction-summary-workouts.json",
    content: { id: "workouts-unassociated-evidence", sport: "running" },
  };
  const event = {
    ...buildJunctionStyleWorkoutEvent({ resourceId: "workouts-unassociated-evidence" }),
    evidenceRoles: [associatedRole],
  };

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [event],
    evidenceParts: [associatedPart],
  });
  const expandedInput = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [event],
    evidenceParts: [
      associatedPart,
      {
        role: unassociatedRole,
        fileName: "junction-summary-activity.json",
        content: { date: "2026-06-03", steps: 8_000 },
      },
    ],
  } as const;
  const expanded = await importDeviceBatch(expandedInput);
  const replay = await importDeviceBatch(expandedInput);

  assert.ok(first.applied);
  assert.ok(expanded.applied);
  assert.equal(expanded.evidencePartCount, 2);
  assert.equal(expanded.persistedEvidencePartCount, 2);
  assert.equal(replay.applied, false);
  const expandedIngest = await readRequiredIntegrationIngest(vaultRoot, expanded.ingestId);
  assert.deepEqual(
    expandedIngest.parts.map((part) => part.role),
    [associatedRole, unassociatedRole],
  );
  assert.deepEqual(expandedIngest.outputs.events, [{
    id: first.events[0]?.id,
    roles: [associatedRole],
  }]);
});

test("importDeviceBatch retains complete evidence when prepared events share one canonical owner", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-shared-event-owner");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const firstRole = "junction-summary-workouts";
  const secondRole = "junction-summary-activity";
  const firstPart = {
    role: firstRole,
    fileName: "junction-summary-workouts.json",
    content: { id: "workouts-shared-owner", sport: "running" },
  };
  const event = buildJunctionStyleWorkoutEvent({ resourceId: "workouts-shared-owner" });
  const revisedEvent = buildJunctionStyleWorkoutEvent({
    durationMinutes: 35,
    resourceId: "workouts-shared-owner",
  });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [{ ...event, evidenceRoles: [firstRole] }],
    evidenceParts: [firstPart],
  });
  const sharedOwnerInput = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      { ...event, evidenceRoles: [firstRole] },
      { ...revisedEvent, evidenceRoles: [secondRole] },
    ],
    evidenceParts: [
      firstPart,
      {
        role: secondRole,
        fileName: "junction-summary-activity.json",
        content: { date: "2026-06-03", steps: 8_000 },
      },
    ],
  } as const;
  const sharedOwner = await importDeviceBatch(sharedOwnerInput);
  const replay = await importDeviceBatch(sharedOwnerInput);

  assert.ok(first.applied);
  assert.ok(sharedOwner.applied);
  assert.equal(sharedOwner.events[0]?.id, first.events[0]?.id);
  assert.equal(sharedOwner.events[1]?.id, first.events[0]?.id);
  assert.equal(sharedOwner.persistedEvidencePartCount, 2);
  assert.equal(replay.applied, false);
  const sharedOwnerIngest = await readRequiredIntegrationIngest(vaultRoot, sharedOwner.ingestId);
  assert.deepEqual(
    sharedOwnerIngest.parts.map((part) => part.role),
    [firstRole, secondRole],
  );
  assert.deepEqual(sharedOwnerIngest.outputs.events, [{
    id: first.events[0]?.id,
    roles: [secondRole, firstRole],
  }]);
});

test("importDeviceBatch retains an existing raw-only part when an event gains its provenance link", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-new-evidence-link");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const evidencePart = {
    role: "junction-summary-workouts",
    fileName: "junction-summary-workouts.json",
    content: { id: "whoop-workout-1", sport: "running" },
  };

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const rawOnly = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    evidenceParts: [evidencePart],
  });
  const linked = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-05T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent(),
        evidenceRoles: [evidencePart.role],
      },
    ],
    evidenceParts: [evidencePart],
  });
  const replay = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-06T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent(),
        evidenceRoles: [evidencePart.role],
      },
    ],
    evidenceParts: [evidencePart],
  });

  assert.ok(first.applied);
  assert.ok(rawOnly.applied);
  assert.ok(linked.applied);
  assert.equal(replay.applied, false);
  const linkedIngest = await readRequiredIntegrationIngest(vaultRoot, linked.ingestId);
  assert.deepEqual(linkedIngest.outputs.events, [
    {
      id: first.events[0]?.id,
      roles: [evidencePart.role],
    },
  ]);
});

test("importDeviceBatch retains novel raw-only evidence once and skips its replay", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-raw-only-idempotency");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (importedAt: string, revision: number) => ({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt,
    evidenceParts: [
      {
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: { revision, stages: [] },
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z", 1));
  const replay = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z", 1));
  const changed = await importDeviceBatch(buildInput("2026-06-05T21:00:00.000Z", 2));
  const monthBoundaryReplay = await importDeviceBatch(
    buildInput("2026-07-01T21:00:00.000Z", 2),
  );
  const currentMonthReplay = await importDeviceBatch(
    buildInput("2026-07-02T21:00:00.000Z", 2),
  );

  assert.ok(first.applied);
  assert.equal(replay.applied, false);
  assert.ok(changed.applied);
  assert.ok(monthBoundaryReplay.applied);
  assert.equal(currentMonthReplay.applied, false);
  assert.equal(first.persistedEvidencePartCount, 1);
  assert.equal(changed.persistedEvidencePartCount, 1);
  const rows = await readJsonlRecords({ vaultRoot, relativePath: first.ingestShardPath });
  assert.equal(rows.length, 2);
  assert.notEqual(monthBoundaryReplay.ingestShardPath, first.ingestShardPath);
  assert.equal(
    (await readJsonlRecords({
      vaultRoot,
      relativePath: monthBoundaryReplay.ingestShardPath,
    })).length,
    1,
  );
});

test("importDeviceBatch fails open beyond the novelty row budget, then dedupes the new tail proof", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-novelty-tail-row-budget");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    evidenceParts: [
      {
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: { revision: 1, stages: [] },
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z"));
  assert.ok(first.applied);
  const firstRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const unrelatedRow = `${JSON.stringify({
    ...firstRecord,
    provider: "unrelated-provider",
    accountId: "unrelated-account",
  })}\n`;
  await fs.appendFile(
    path.join(vaultRoot, first.ingestShardPath),
    unrelatedRow.repeat(65),
    "utf8",
  );

  const outsideBudget = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z"));
  assert.ok(outsideBudget.applied);
  assert.equal(outsideBudget.persistedEvidencePartCount, 1);

  const tailReplay = await importDeviceBatch(buildInput("2026-06-05T21:00:00.000Z"));
  assert.equal(tailReplay.applied, false);
  assert.equal(tailReplay.persistedEvidencePartCount, 0);
});

test("importDeviceBatch makes an exact retry a no-op beyond the novelty row budget", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-exact-retry-row-budget");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    evidenceParts: [{
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      content: { revision: 1, stages: [] },
    }],
  } as const;

  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  const firstRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const unrelatedRow = `${JSON.stringify({
    ...firstRecord,
    id: "xfm_00000000000000000000000000",
    provider: "unrelated-provider",
    accountId: "unrelated-account",
  })}\n`;
  await fs.appendFile(path.join(vaultRoot, first.ingestShardPath), unrelatedRow.repeat(65), "utf8");
  const persistedPaths = [first.ingestShardPath, first.auditPath];
  const beforeReplay = await Promise.all(
    persistedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  const replay = await importDeviceBatch(input);
  const afterReplay = await Promise.all(
    persistedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  assert.equal(replay.applied, false);
  assert.equal(replay.ingestId, null);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(afterReplay, beforeReplay);
});

test("importDeviceBatch rejects an exact retry when the complete canonical spine is missing", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-exact-retry-missing-output");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  } as const;

  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  const eventShardPath = first.eventShardPaths[0];
  assert.ok(eventShardPath);
  const firstRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const unrelatedRow = `${JSON.stringify({
    ...firstRecord,
    id: "xfm_00000000000000000000000001",
    provider: "unrelated-provider",
  })}\n`;
  await fs.appendFile(path.join(vaultRoot, first.ingestShardPath), unrelatedRow.repeat(65), "utf8");
  await fs.rm(path.join(vaultRoot, eventShardPath));
  const beforeRejectedRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  await assert.rejects(fs.access(path.join(vaultRoot, eventShardPath)));
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedRepair);
});

test("exact repair rejects one stored event output claimed by two missing events", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-ambiguous-stored-output-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const sharedEvidenceRole = "junction-summary-workouts";
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-missing-a" }),
        evidenceRoles: [sharedEvidenceRole],
      },
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-missing-b" }),
        evidenceRoles: [sharedEvidenceRole],
      },
    ],
    evidenceParts: [{
      role: sharedEvidenceRole,
      fileName: "junction-summary-workouts.json",
      content: { ids: ["workout-missing-a", "workout-missing-b"] },
    }],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  const eventShardPath = first.eventShardPaths[0];
  assert.ok(eventShardPath);
  const stored = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const retainedOutput = stored.outputs.events[0];
  assert.ok(retainedOutput);
  const ambiguousStoredDelivery: IntegrationIngestRecord = {
    ...stored,
    outputs: {
      ...stored.outputs,
      events: [retainedOutput],
    },
    counts: {
      ...stored.counts,
      eventCount: 1,
    },
  };
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    `${JSON.stringify(ambiguousStoredDelivery)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(vaultRoot, eventShardPath), "", "utf8");
  const watchedPaths = [first.ingestShardPath, eventShardPath];
  const beforeRepair = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeRepair,
  );
});

test("exact repair rejects one stored empty-role output claimed by two missing events", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-empty-role-output-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-empty-role-a" }),
        evidenceRoles: [],
      },
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-empty-role-b" }),
        evidenceRoles: [],
      },
    ],
    evidenceParts: [],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  const eventShardPath = first.eventShardPaths[0];
  assert.ok(eventShardPath);
  const stored = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  assert.equal(stored.outputs.events.length, 2);
  assert.deepEqual(stored.outputs.events.map((output) => output.roles), [[], []]);
  const retainedOutput = stored.outputs.events[0];
  assert.ok(retainedOutput);
  const partialStoredDelivery: IntegrationIngestRecord = {
    ...stored,
    outputs: {
      ...stored.outputs,
      events: [retainedOutput],
    },
    counts: {
      ...stored.counts,
      eventCount: 1,
    },
  };
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    `${JSON.stringify(partialStoredDelivery)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(vaultRoot, eventShardPath), "", "utf8");
  const beforeRepair = await snapshotVaultFiles(vaultRoot);

  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRepair);
});

test("exact repair rejects stored event outputs swapped across missing owners", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-swapped-output-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const roleA = "junction-summary-workout-a";
  const roleB = "junction-summary-workout-b";
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-missing-a" }),
        evidenceRoles: [roleA],
      },
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-missing-b" }),
        evidenceRoles: [roleB],
      },
    ],
    evidenceParts: [
      { role: roleA, fileName: "workout-a.json", content: { id: "workout-missing-a" } },
      { role: roleB, fileName: "workout-b.json", content: { id: "workout-missing-b" } },
    ],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  assert.ok(first.auditPath);
  const eventShardPath = first.eventShardPaths[0];
  assert.ok(eventShardPath);
  const stored = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const outputA = stored.outputs.events.find((output) => output.roles.includes(roleA));
  const outputB = stored.outputs.events.find((output) => output.roles.includes(roleB));
  assert.ok(outputA);
  assert.ok(outputB);
  const swappedStoredDelivery: IntegrationIngestRecord = {
    ...stored,
    outputs: {
      ...stored.outputs,
      events: [
        { ...outputA, id: outputB.id },
        { ...outputB, id: outputA.id },
      ],
    },
  };
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    `${JSON.stringify(swappedStoredDelivery)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(vaultRoot, eventShardPath), "", "utf8");
  const watchedPaths = [first.ingestShardPath, eventShardPath, first.auditPath];
  const beforeRepair = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeRepair,
  );
});

test("exact repair rejects an output id owned by an unrelated vault event", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-unrelated-output-owner");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const unrelated = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-05-02T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent({
      occurredAt: "2026-05-02T19:55:00.000Z",
      recordedAt: "2026-05-02T20:30:00.000Z",
      resourceId: "workout-unrelated-owner",
    })],
  });
  const unrelatedId = unrelated.events[0]?.id;
  assert.ok(unrelatedId);
  const evidenceRole = "junction-summary-target-workout";
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [{
      ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-missing-target" }),
      evidenceRoles: [evidenceRole],
    }],
    evidenceParts: [{
      role: evidenceRole,
      fileName: "target-workout.json",
      content: { id: "workout-missing-target" },
    }],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  assert.ok(first.auditPath);
  const eventShardPath = first.eventShardPaths[0];
  assert.ok(eventShardPath);
  assert.notEqual(unrelated.eventShardPaths[0], eventShardPath);
  const targetId = first.events[0]?.id;
  assert.ok(targetId);
  const stored = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const [storedOutput] = stored.outputs.events;
  assert.ok(storedOutput);
  const unrelatedOwnedDelivery: IntegrationIngestRecord = {
    ...stored,
    outputs: {
      ...stored.outputs,
      events: [{ ...storedOutput, id: unrelatedId }],
    },
  };
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    `${JSON.stringify(unrelatedOwnedDelivery)}\n`,
    "utf8",
  );
  const eventRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  })) as EventRecord[];
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    eventRows
      .filter((record) => record.id !== targetId)
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
    "utf8",
  );
  const watchedPaths = [first.ingestShardPath, eventShardPath, first.auditPath];
  const beforeRepair = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeRepair,
  );
});

test("exact repair rejects its prepared id when unrelated content occupies it", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-prepared-id-collision");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const evidenceRole = "junction-summary-colliding-workout";
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [{
      ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-missing-target" }),
      evidenceRoles: [evidenceRole],
    }],
    evidenceParts: [{
      role: evidenceRole,
      fileName: "colliding-workout.json",
      content: { id: "workout-missing-target" },
    }],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  assert.ok(first.ingestShardPath);
  assert.ok(first.auditPath);
  const eventShardPath = first.eventShardPaths[0];
  const preparedRecord = first.events[0];
  assert.ok(eventShardPath);
  assert.ok(preparedRecord);
  if (preparedRecord.kind !== "activity_session") {
    throw new Error("expected prepared workout event");
  }
  const preparedExternalRef = preparedRecord.externalRef;
  assert.ok(preparedExternalRef);
  const occupantSeed = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-05-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent({
      occurredAt: "2026-05-03T19:55:00.000Z",
      recordedAt: "2026-05-03T20:30:00.000Z",
      resourceId: "workout-occupant-seed",
    })],
  });
  const occupantShardPath = occupantSeed.eventShardPaths[0];
  assert.ok(occupantShardPath);
  assert.notEqual(occupantShardPath, eventShardPath);
  const unrelatedOccupant: EventRecord = {
    ...preparedRecord,
    occurredAt: "2026-05-03T19:55:00.000Z",
    recordedAt: "2026-05-03T20:30:00.000Z",
    dayKey: "2026-05-03",
    durationMinutes: 99,
    externalRef: {
      ...preparedExternalRef,
      resourceId: "workout-unrelated-occupant",
    },
  };
  await fs.writeFile(
    path.join(vaultRoot, occupantShardPath),
    `${JSON.stringify(unrelatedOccupant)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(vaultRoot, eventShardPath), "", "utf8");
  const watchedPaths = [
    first.ingestShardPath,
    eventShardPath,
    occupantShardPath,
    first.auditPath,
  ];
  const beforeRepair = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeRepair,
  );
});

test("exact corrected replay rejects an unproven surviving prefix and complete spine loss", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-corrected-owner-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (input: {
    importedAt: string;
    sourceVersion: string;
    durationMinutes: number;
  }) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: input.importedAt,
    events: [{
      ...buildJunctionStyleWorkoutEvent({ durationMinutes: input.durationMinutes }),
      externalRef: {
        ...buildJunctionStyleWorkoutEvent().externalRef,
        version: input.sourceVersion,
      },
      evidenceRoles: ["junction-summary-workouts"],
    }],
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { durationMinutes: input.durationMinutes, version: input.sourceVersion },
    }],
  });
  const v1Input = buildInput({
    importedAt: "2026-06-03T21:00:00.000Z",
    sourceVersion: "2026-06-03T20:30:00.000Z",
    durationMinutes: 34,
  });
  const v2Input = buildInput({
    importedAt: "2026-06-04T21:00:00.000Z",
    sourceVersion: "2026-06-04T20:30:00.000Z",
    durationMinutes: 35,
  });
  const v1 = await importDeviceBatch(v1Input);
  const v2 = await importDeviceBatch(v2Input);
  const canonicalId = v1.events[0]?.id;
  const eventPath = v1.eventShardPaths[0] as string;
  assert.ok(canonicalId);
  assert.equal(v2.events[0]?.id, canonicalId);
  const [v1Row] = (await readJsonlRecords({ vaultRoot, relativePath: eventPath })) as EventRecord[];
  assert.ok(v1Row);
  assert.ok(v2.ingestShardPath);
  assert.ok(v2.auditPath);
  const completeEventBytes = await fs.readFile(path.join(vaultRoot, eventPath));
  const watchedPaths = [eventPath, v2.ingestShardPath, v2.auditPath];

  await fs.writeFile(path.join(vaultRoot, eventPath), `${JSON.stringify(v1Row)}\n`, "utf8");
  const beforeRejectedPrefixRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(v2Input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedPrefixRepair);

  await fs.writeFile(path.join(vaultRoot, eventPath), completeEventBytes);
  const beforeConvergedReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const convergedReplay = await importDeviceBatch(v2Input);
  assert.equal(convergedReplay.applied, false);
  assert.equal(convergedReplay.auditPath, null);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeConvergedReplay,
  );

  await fs.rm(path.join(vaultRoot, eventPath));
  const beforeRejectedRecreation = await Promise.all(
    watchedPaths.slice(1).map((relativePath) =>
      fs.readFile(path.join(vaultRoot, relativePath))
    ),
  );
  await assert.rejects(
    importDeviceBatch(v2Input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  await assert.rejects(fs.access(path.join(vaultRoot, eventPath)));
  assert.deepEqual(
    await Promise.all(
      watchedPaths.slice(1).map((relativePath) =>
        fs.readFile(path.join(vaultRoot, relativePath))
      ),
    ),
    beforeRejectedRecreation,
  );
});

test("delayed v1 evidence does not expose or associate an unappended draft after A moves to B", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-moved-owner-unappended-draft");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const version1 = "2026-06-25T03:00:00.000Z";
  const version2 = "2026-06-26T03:00:00.000Z";
  const externalRefA = {
    system: "junction",
    resourceType: "junction-garmin-sleep",
    resourceId: "sleep-stage-window-a",
    facet: "sleep-deep-minutes",
    version: version1,
  };
  const externalRefB = {
    ...externalRefA,
    resourceId: "sleep-stage-window-b",
    version: version2,
  };
  const evidenceRole = "junction-summary-sleep-cycle";
  const dataOrigin = {
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    sourceInstanceId: "garmin-watch-1",
    observedAtRaw: "2026-06-25T03:00:00.000Z",
    timestampSemantics: "utc" as const,
    normalizerVersion: "junction-sleep-stage-summary.v1",
  };
  const buildEvent = (input: {
    externalRef: typeof externalRefA;
    legacyExternalRefs?: Array<typeof externalRefA>;
    value: number;
  }) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-25T03:00:00.000Z",
    recordedAt: "2026-06-25T03:00:00.000Z",
    dayKey: "2026-06-25",
    title: "Junction deep sleep",
    externalRef: input.externalRef,
    legacyExternalRefs: input.legacyExternalRefs,
    evidenceRoles: [evidenceRole],
    dataOrigin,
    fields: {
      metric: "sleep-deep-minutes",
      observationGrain: "summary" as const,
      value: input.value,
      unit: "minutes",
    },
  });
  const v1Event = buildEvent({ externalRef: externalRefA, value: 90 });
  const importEvent = (input: {
    importedAt: string;
    event: ReturnType<typeof buildEvent>;
    evidenceAttempt: string;
  }) => importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: input.importedAt,
    events: [input.event],
    evidenceParts: [{
      role: evidenceRole,
      fileName: "junction-summary-sleep-cycle.json",
      content: { attempt: input.evidenceAttempt, value: input.event.fields.value },
    }],
  });
  const v1 = await importEvent({
    importedAt: "2026-06-25T11:00:00.000Z",
    event: v1Event,
    evidenceAttempt: "v1",
  });
  const canonicalId = v1.events[0]?.id;
  assert.ok(canonicalId);
  const v2 = await importEvent({
    importedAt: "2026-06-26T11:00:00.000Z",
    event: buildEvent({
      externalRef: externalRefB,
      legacyExternalRefs: [externalRefA],
      value: 92,
    }),
    evidenceAttempt: "v2",
  });
  assert.equal(v2.events[0]?.id, canonicalId);
  const eventPath = v1.eventShardPaths[0] as string;
  const eventRows = (await readJsonlRecords({ vaultRoot, relativePath: eventPath })) as EventRecord[];
  const currentB = eventRows.find((record) => record.externalRef?.resourceId === externalRefB.resourceId);
  assert.ok(currentB);
  assert.equal(currentB.id, canonicalId);
  await fs.writeFile(path.join(vaultRoot, eventPath), `${JSON.stringify(currentB)}\n`, "utf8");
  const currentBytes = await fs.readFile(path.join(vaultRoot, eventPath));
  const delayedInput = {
    importedAt: "2026-07-01T11:00:00.000Z",
    event: v1Event,
    evidenceAttempt: "delayed-v1",
  } as const;

  const delayed = await importEvent(delayedInput);
  assert.ok(delayed.applied);
  assert.ok(delayed.ingestId);
  assert.ok(delayed.ingestShardPath);
  assert.ok(delayed.auditPath);
  assert.deepEqual(delayed.events, []);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, delayed.ingestId)).outputs.events,
    [],
  );
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, eventPath)), currentBytes);
  const currentAfterDelayed = await findEventByExternalRef({
    vaultRoot,
    system: externalRefB.system,
    resourceType: externalRefB.resourceType,
    resourceId: externalRefB.resourceId,
    facet: externalRefB.facet,
  });
  assert.equal(currentAfterDelayed?.id, canonicalId);
  assert.equal(currentAfterDelayed?.externalRef?.version, version2);
  assert.equal(eventObservationValue(currentAfterDelayed), 92);
  const watchedPaths = [eventPath, delayed.ingestShardPath, delayed.auditPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importEvent(delayedInput);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  await fs.unlink(path.join(vaultRoot, eventPath));
  const beforeReplayAfterSpineLoss = await snapshotVaultFiles(vaultRoot);
  const replayAfterSpineLoss = await importEvent(delayedInput);
  assert.equal(replayAfterSpineLoss.applied, false);
  assert.equal(replayAfterSpineLoss.auditPath, null);
  assert.deepEqual(replayAfterSpineLoss.events, []);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplayAfterSpineLoss);
});

test("importDeviceBatch exact historical replay does not supersede a newer provider revision", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-historical-exact-replay");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (importedAt: string, durationMinutes: number) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    events: [buildJunctionStyleWorkoutEvent({ durationMinutes })],
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { durationMinutes, id: "whoop-workout-1" },
    }],
  });
  const originalInput = buildInput("2026-06-03T21:00:00.000Z", 34);
  const first = await importDeviceBatch(originalInput);
  const corrected = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z", 35));
  assert.ok(first.applied);
  assert.ok(corrected.applied);
  const beforeReplay = await Promise.all(
    [first.ingestShardPath, corrected.auditPath, first.eventShardPaths[0] as string].map(
      (relativePath) => fs.readFile(path.join(vaultRoot, relativePath)),
    ),
  );

  const replay = await importDeviceBatch(originalInput);
  const eventRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(replay.events, []);
  assert.equal(eventRows.length, 2);
  const latest = eventRows.at(-1);
  assert.equal(latest?.kind, "activity_session");
  assert.equal(latest?.kind === "activity_session" ? latest.durationMinutes : undefined, 35);
  assert.deepEqual(
    await Promise.all(
      [first.ingestShardPath, corrected.auditPath, first.eventShardPaths[0] as string].map(
        (relativePath) => fs.readFile(path.join(vaultRoot, relativePath)),
      ),
    ),
    beforeReplay,
  );
});

test("later-attempt stale evidence is retained raw-only without relinking a newer event", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-later-attempt-raw-only");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (importedAt: string, durationMinutes: number) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    events: [buildJunctionStyleWorkoutEvent({ durationMinutes })],
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { durationMinutes, id: "whoop-workout-1" },
    }],
  });
  const first = await importDeviceBatch(buildInput("2026-06-30T21:00:00.000Z", 34));
  const corrected = await importDeviceBatch(buildInput("2026-07-01T21:00:00.000Z", 35));
  assert.ok(first.applied);
  assert.ok(corrected.applied);
  const event = first.events[0];
  assert.ok(event);
  const linkedBefore = await listIntegrationIngestsForEvent(vaultRoot, event.id);
  const eventPath = first.eventShardPaths[0] as string;
  const beforeReplay = await fs.readFile(path.join(vaultRoot, eventPath));
  const delayedInput = buildInput("2026-07-02T21:00:00.000Z", 34);

  const delayed = await importDeviceBatch(delayedInput);
  const converged = await importDeviceBatch(delayedInput);

  assert.ok(delayed.applied);
  assert.equal(delayed.persistedEvidencePartCount, 1);
  assert.equal(converged.applied, false);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, eventPath)), beforeReplay);
  const delayedRecord = await readRequiredIntegrationIngest(vaultRoot, delayed.ingestId);
  assert.deepEqual(delayedRecord.outputs.events, []);
  assert.equal((await listIntegrationIngestsForEvent(vaultRoot, event.id)).length, linkedBefore.length);
  assert.deepEqual(delayed.events, []);
  assert.deepEqual(converged.events, []);
});

test("unsafe history cannot recreate an output-empty exact delivery after owner loss", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-unsafe-raw-only-owner-loss");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (importedAt: string, durationMinutes: number) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    events: [buildJunctionStyleWorkoutEvent({
      durationMinutes,
      resourceId: "unsafe-raw-only-owner-loss",
    })],
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { durationMinutes },
    }],
  });
  const first = await importDeviceBatch(buildInput("2026-06-30T21:00:00.000Z", 34));
  await importDeviceBatch(buildInput("2026-07-01T21:00:00.000Z", 35));
  const delayedInput = buildInput("2026-07-02T21:00:00.000Z", 34);
  const delayed = await importDeviceBatch(delayedInput);
  assert.ok(delayed.ingestId);
  assert.ok(delayed.ingestShardPath);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, delayed.ingestId)).outputs.events,
    [],
  );
  await fs.appendFile(
    path.join(vaultRoot, delayed.ingestShardPath),
    "not-json\n",
    "utf8",
  );
  const eventPath = first.eventShardPaths[0] as string;
  await fs.unlink(path.join(vaultRoot, eventPath));
  const beforeRetry = await snapshotVaultFiles(vaultRoot);

  await assert.rejects(
    importDeviceBatch(delayedInput),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  await assert.rejects(fs.access(path.join(vaultRoot, eventPath)));
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRetry);
});

test("later-attempt batches update eligible events without associating stale event evidence", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-mixed-later-attempt");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildEvent = (resourceId: string, durationMinutes: number, evidenceRole: string) => ({
    ...buildJunctionStyleWorkoutEvent({ durationMinutes, resourceId }),
    evidenceRoles: [evidenceRole],
  });
  const original = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-30T21:00:00.000Z",
    events: [
      buildEvent("workout-stale", 34, "workout-stale"),
      buildEvent("workout-current", 40, "workout-current"),
    ],
    evidenceParts: [
      { role: "workout-stale", fileName: "workout-stale.json", content: { revision: 1 } },
      { role: "workout-current", fileName: "workout-current.json", content: { revision: 1 } },
    ],
  });
  const staleEventId = original.events.find(
    (event) => event.externalRef?.resourceId === "workout-stale",
  )?.id;
  const currentEventId = original.events.find(
    (event) => event.externalRef?.resourceId === "workout-current",
  )?.id;
  assert.ok(staleEventId);
  assert.ok(currentEventId);
  const corrected = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-07-01T21:00:00.000Z",
    events: [buildEvent("workout-stale", 35, "workout-stale")],
    evidenceParts: [
      { role: "workout-stale", fileName: "workout-stale.json", content: { revision: 2 } },
    ],
  });
  assert.ok(corrected.applied);
  const staleLinksBefore = await listIntegrationIngestsForEvent(vaultRoot, staleEventId);
  const laterInput = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-07-02T21:00:00.000Z",
    events: [
      buildEvent("workout-stale", 34, "workout-stale"),
      buildEvent("workout-current", 41, "workout-current"),
    ],
    evidenceParts: [
      { role: "workout-stale", fileName: "workout-stale.json", content: { revision: 1 } },
      { role: "workout-current", fileName: "workout-current.json", content: { revision: 2 } },
    ],
  };

  const later = await importDeviceBatch(laterInput);
  const converged = await importDeviceBatch(laterInput);

  assert.ok(later.applied);
  assert.equal(converged.applied, false);
  const laterRecord = await readRequiredIntegrationIngest(vaultRoot, later.ingestId);
  assert.deepEqual(laterRecord.outputs.events, [{ id: currentEventId, roles: ["workout-current"] }]);
  assert.equal((await listIntegrationIngestsForEvent(vaultRoot, staleEventId)).length, staleLinksBefore.length);
  const staleEvent = later.events.find((event) => event.id === staleEventId);
  const currentEvent = later.events.find((event) => event.id === currentEventId);
  assert.equal(staleEvent, undefined);
  assert.equal(
    currentEvent?.kind === "activity_session" ? currentEvent.durationMinutes : undefined,
    41,
  );
  assert.deepEqual(converged.events.map((event) => event.id), [currentEventId]);
});

test("later-attempt evidence stays raw-only for a different-content dedupe survivor", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-later-attempt-dedupe-survivor");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    events: [buildJunctionStyleWorkoutEvent({ durationMinutes: 34 })],
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { durationMinutes: 34, id: "whoop-workout-1" },
    }],
  });
  const first = await importDeviceBatch(buildInput("2026-06-30T21:00:00.000Z"));
  const original = first.events[0];
  assert.ok(first.applied);
  assert.ok(original);
  const survivorId = "evt_0000000000000000000000DP37";
  const eventPath = first.eventShardPaths[0] as string;
  await fs.appendFile(
    path.join(vaultRoot, eventPath),
    `${JSON.stringify({
      ...original,
      id: survivorId,
      durationMinutes: 40,
      lifecycle: { revision: 2 },
    })}\n`,
  );
  const dedupe = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });
  assert.ok(dedupe.applied);
  const beforeReplay = await fs.readFile(path.join(vaultRoot, eventPath));
  const linkedBefore = await listIntegrationIngestsForEvent(vaultRoot, survivorId);
  const delayedInput = buildInput("2026-07-01T21:00:00.000Z");

  const delayed = await importDeviceBatch(delayedInput);
  const converged = await importDeviceBatch(delayedInput);

  assert.ok(delayed.applied);
  assert.equal(converged.applied, false);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, eventPath)), beforeReplay);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, delayed.ingestId)).outputs.events,
    [],
  );
  assert.equal((await listIntegrationIngestsForEvent(vaultRoot, survivorId)).length, linkedBefore.length);
  assert.deepEqual(delayed.events, []);
  assert.deepEqual(converged.events, []);
});

test("importDeviceBatch exact replay remains a no-op after user edit or tombstone", async () => {
  for (const mutation of ["edit", "tombstone"] as const) {
    const vaultRoot = await makeTempDirectory(`murph-device-import-replay-after-${mutation}`);
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const input = {
      vaultRoot,
      provider: "junction",
      accountId: "account-a",
      importedAt: "2026-06-03T21:00:00.000Z",
      events: [buildJunctionStyleWorkoutEvent()],
      evidenceParts: [{
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: { id: "whoop-workout-1" },
      }],
    } as const;
    const first = await importDeviceBatch(input);
    assert.ok(first.applied);
    const event = first.events[0];
    assert.ok(event);
    if (mutation === "edit") {
      await upsertEvent({
        vaultRoot,
        payload: { ...event, note: "User-authored correction", source: "manual" },
      });
    } else {
      await deleteEvent({ vaultRoot, eventId: event.id });
    }
    const eventPath = first.eventShardPaths[0] as string;
    const beforeReplay = await fs.readFile(path.join(vaultRoot, eventPath));

    const replay = await importDeviceBatch(input);

    assert.equal(replay.applied, false, `${mutation} replay must remain a no-op`);
    assert.equal(replay.auditPath, null);
    assert.deepEqual(replay.events, []);
    assert.deepEqual(await fs.readFile(path.join(vaultRoot, eventPath)), beforeReplay);

    await fs.unlink(path.join(vaultRoot, eventPath));
    const beforeMissingSpineReplay = await snapshotVaultFiles(vaultRoot);
    await assert.rejects(
      importDeviceBatch(input),
      (error) =>
        error instanceof VaultError
        && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
      `${mutation} must not be replaced after complete spine loss`,
    );
    await assert.rejects(fs.access(path.join(vaultRoot, eventPath)));
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeMissingSpineReplay);
  }
});

test.each([
  ["partial", "edit"],
  ["partial", "tombstone"],
  ["invalid", "edit"],
  ["invalid", "tombstone"],
] as const)(
  "damaged %s exact evidence cannot recreate a completely lost %s spine",
  async (damage, mutation) => {
    const vaultRoot = await makeTempDirectory(
      `murph-device-import-${damage}-evidence-lost-${mutation}`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const linkedRole = "junction-summary-workouts";
    const input = {
      vaultRoot,
      provider: "junction",
      accountId: "account-a",
      importedAt: "2026-06-03T21:00:00.000Z",
      events: [{
        ...buildJunctionStyleWorkoutEvent({
          resourceId: `damaged-evidence-lost-${mutation}`,
        }),
        evidenceRoles: [linkedRole],
      }],
      evidenceParts: [
        {
          role: linkedRole,
          fileName: "junction-summary-workouts.json",
          content: { id: "whoop-workout-1" },
        },
        {
          role: "wearable-raw-receipt:junction-recovery",
          fileName: "junction-summary-recovery.json",
          content: { score: 67 },
        },
      ],
    } as const;
    const first = await importDeviceBatch(input);
    const event = first.events[0];
    assert.ok(event);
    assert.ok(first.ingestId);
    assert.ok(first.ingestShardPath);
    const stored = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
    const linkedPart = stored.parts.find((part) => part.role === linkedRole);
    assert.ok(linkedPart);
    const damaged = damage === "partial"
      ? { ...stored, parts: [linkedPart] }
      : {
          ...stored,
          parts: [{ ...linkedPart, content: "integrity-invalid" }, stored.parts[1]],
        };
    await fs.writeFile(
      path.join(vaultRoot, first.ingestShardPath),
      `${JSON.stringify(damaged)}\n`,
      "utf8",
    );
    if (mutation === "edit") {
      await upsertEvent({
        vaultRoot,
        payload: { ...event, note: "User-authored correction", source: "manual" },
      });
    } else {
      await deleteEvent({ vaultRoot, eventId: event.id });
    }
    const eventPath = first.eventShardPaths[0] as string;
    await fs.unlink(path.join(vaultRoot, eventPath));
    const beforeRetry = await snapshotVaultFiles(vaultRoot);

    await assert.rejects(
      importDeviceBatch(input),
      (error) =>
        error instanceof VaultError
        && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
    );
    await assert.rejects(fs.access(path.join(vaultRoot, eventPath)));
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRetry);
  },
);

test("later-attempt evidence stays raw-only after user edit or tombstone", async () => {
  for (const mutation of ["edit", "tombstone"] as const) {
    const vaultRoot = await makeTempDirectory(`murph-device-import-later-attempt-${mutation}`);
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const buildInput = (importedAt: string) => ({
      vaultRoot,
      provider: "junction",
      accountId: "account-a",
      importedAt,
      events: [buildJunctionStyleWorkoutEvent()],
      evidenceParts: [{
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: { id: "whoop-workout-1" },
      }],
    });
    const first = await importDeviceBatch(buildInput("2026-06-30T21:00:00.000Z"));
    const event = first.events[0];
    assert.ok(first.applied);
    assert.ok(event);
    if (mutation === "edit") {
      await upsertEvent({
        vaultRoot,
        payload: { ...event, note: "User-authored correction", source: "manual" },
      });
    } else {
      await deleteEvent({ vaultRoot, eventId: event.id });
    }
    const eventPath = first.eventShardPaths[0] as string;
    const beforeReplay = await fs.readFile(path.join(vaultRoot, eventPath));
    const linkedBefore = await listIntegrationIngestsForEvent(vaultRoot, event.id);
    const delayedInput = buildInput("2026-07-01T21:00:00.000Z");

    const delayed = await importDeviceBatch(delayedInput);
    const converged = await importDeviceBatch(delayedInput);

    assert.ok(delayed.applied);
    assert.equal(converged.applied, false);
    assert.deepEqual(await fs.readFile(path.join(vaultRoot, eventPath)), beforeReplay);
    assert.deepEqual(
      (await readRequiredIntegrationIngest(vaultRoot, delayed.ingestId)).outputs.events,
      [],
    );
    assert.deepEqual(delayed.events, []);
    assert.deepEqual(converged.events, []);
    assert.equal((await listIntegrationIngestsForEvent(vaultRoot, event.id)).length, linkedBefore.length);
  }
});

test("importDeviceBatch recognizes legacy metadata-omitting ids without collapsing metadata variants", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-legacy-metadata-id");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const rawReceipt = {
    schemaVersion: "wearable.raw_ingest_receipt.v1",
    id: "wearable_raw_aaaaaaaaaaaaaaaaaaaaaaaa",
    provider: "junction",
    sourceKind: "poll",
    deliveryMode: "full_payload",
    observedAt: "2026-06-03T20:55:00.000Z",
    payloadHash: "a".repeat(64),
    rawArtifactRoles: ["junction-summary-sleep-cycle"],
    rawArtifactCount: 1,
  } as const;
  const baseInput = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    ingestReceipt: rawReceipt,
    evidenceParts: [{
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      content: { stages: [] },
      metadata: { revision: 1 },
    }],
  } as const;
  const historical = await importDeviceBatch(baseInput);
  assert.ok(historical.applied);
  const [historicalRecord] = (await readJsonlRecords({
    vaultRoot,
    relativePath: historical.ingestShardPath,
  })) as IntegrationIngestRecord[];
  assert.ok(historicalRecord?.parts[0]);
  const compactedReceipt = compactIntegrationIngestReceipt(rawReceipt);
  assert.ok(compactedReceipt);
  const evidenceContent = `${stableStringifyWearableRawPayload(baseInput.evidenceParts[0].content)}\n`;
  const receiptContent = `${stableStringifyWearableRawPayload(rawReceipt)}\n`;
  const legacyImportId = deterministicContractId(
    "xfm",
    stableStringifyWearableRawPayload({
      provider: baseInput.provider,
      accountId: baseInput.accountId,
      source: "device",
      importedAt: baseInput.importedAt,
      provenance: {},
      receipt: compactedReceipt,
      eventIds: [],
      sampleIds: [],
      evidenceParts: [
        {
          role: baseInput.evidenceParts[0].role,
          fileName: baseInput.evidenceParts[0].fileName,
          mediaType: null,
          sha256: createHash("sha256").update(evidenceContent).digest("hex"),
        },
        {
          role: `wearable-raw-receipt:${rawReceipt.id}`,
          fileName: `${baseInput.provider}-raw-ingest-receipt-${rawReceipt.id}.json`,
          mediaType: "application/json",
          sha256: createHash("sha256").update(receiptContent).digest("hex"),
        },
      ],
    }),
  );
  const metadataBearingHistoricalRecord: IntegrationIngestRecord = {
    ...historicalRecord,
    id: legacyImportId,
  };
  const unrelatedRows = Array.from({ length: 65 }, (_, index) => ({
    ...metadataBearingHistoricalRecord,
    id: deterministicContractId("xfm", `unrelated-legacy-row-${index}`),
    provider: "unrelated-provider",
  }));
  await fs.writeFile(
    path.join(vaultRoot, historical.ingestShardPath),
    [metadataBearingHistoricalRecord, ...unrelatedRows]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
    "utf8",
  );
  const importRevision = (revision: number) => importDeviceBatch({
    ...baseInput,
    evidenceParts: [{ ...baseInput.evidenceParts[0], metadata: { revision } }],
  });

  const exactLegacyReplay = await importRevision(1);
  const distinctMetadata = await importRevision(2);

  assert.equal(exactLegacyReplay.applied, false);
  assert.ok(distinctMetadata.applied);
  assert.notEqual(distinctMetadata.ingestId, legacyImportId);
  assert.equal(
    (await readJsonlRecords({ vaultRoot, relativePath: historical.ingestShardPath })).length,
    67,
  );
});

test("importDeviceBatch repairs an integrity-invalid exact row once with a self-contained delivery", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-invalid-exact-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    evidenceParts: [{
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      content: { stages: [] },
    }],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  const [record] = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.ingestShardPath,
  })) as IntegrationIngestRecord[];
  assert.ok(record?.parts[0]);
  const invalidRecord = {
    ...record,
    parts: [{ ...record.parts[0], content: "integrity-invalid" }],
  };
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    `${JSON.stringify(invalidRecord)}\n`,
    "utf8",
  );

  const repaired = await importDeviceBatch(input);
  const replay = await importDeviceBatch(input);

  assert.ok(repaired.applied);
  assert.notEqual(repaired.ingestId, first.ingestId);
  assert.equal(repaired.persistedEvidencePartCount, 1);
  assert.equal(replay.applied, false);
  const rows = await readJsonlRecords({ vaultRoot, relativePath: first.ingestShardPath });
  assert.equal(rows.length, 2);
});

test("damaged exact rows cannot revert a newer provider revision beyond the tail budget", async () => {
  for (const damage of ["invalid", "partial"] as const) {
    const vaultRoot = await makeTempDirectory(`murph-device-import-${damage}-historical-replay`);
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const buildInput = (importedAt: string, durationMinutes: number) => ({
      vaultRoot,
      provider: "junction",
      accountId: "account-a",
      importedAt,
      ingestReceipt: {
        schemaVersion: "wearable.raw_ingest_receipt.v1" as const,
        id: `wearable_raw_${(durationMinutes === 34 ? "a" : "b").repeat(24)}`,
        provider: "junction",
        sourceKind: "poll" as const,
        deliveryMode: "full_payload" as const,
        observedAt: importedAt,
        payloadHash: (durationMinutes === 34 ? "a" : "b").repeat(64),
        rawArtifactRoles: ["junction-summary-workouts", "junction-summary-recovery"],
        rawArtifactCount: 2,
      },
      events: [buildJunctionStyleWorkoutEvent({ durationMinutes })],
      evidenceParts: [
        {
          role: "junction-summary-workouts",
          fileName: "junction-summary-workouts.json",
          content: { durationMinutes, id: "whoop-workout-1" },
        },
        {
          role: "junction-summary-recovery",
          fileName: "junction-summary-recovery.json",
          content: { score: 67 },
        },
      ],
    });
    const originalInput = buildInput("2026-06-03T21:00:00.000Z", 34);
    const first = await importDeviceBatch(originalInput);
    assert.ok(first.applied);
    const originalRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
    const [firstPart, secondPart] = originalRecord.parts;
    assert.ok(firstPart);
    assert.ok(secondPart);
    const damagedRecord = damage === "partial"
      ? { ...originalRecord, parts: [secondPart] }
      : {
          ...originalRecord,
          parts: [{ ...firstPart, content: "integrity-invalid" }, secondPart],
        };
    await fs.writeFile(
      path.join(vaultRoot, first.ingestShardPath),
      `${JSON.stringify(damagedRecord)}\n`,
      "utf8",
    );
    const corrected = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z", 35));
    assert.ok(corrected.applied);
    const correctedRecord = await readRequiredIntegrationIngest(vaultRoot, corrected.ingestId);
    const unrelatedRows = Array.from({ length: 65 }, (_, index) => ({
      ...correctedRecord,
      id: deterministicContractId("xfm", `${damage}-historical-tail-${index}`),
      provider: "unrelated-provider",
    }));
    await fs.appendFile(
      path.join(vaultRoot, first.ingestShardPath),
      unrelatedRows.map((record) => JSON.stringify(record)).join("\n") + "\n",
      "utf8",
    );
    const eventPath = first.eventShardPaths[0] as string;
    const beforeReplay = await fs.readFile(path.join(vaultRoot, eventPath));

    const repaired = await importDeviceBatch(originalInput);
    const replay = await importDeviceBatch(originalInput);

    assert.ok(repaired.applied);
    assert.equal(repaired.persistedEvidencePartCount, 2);
    assert.equal(replay.applied, false);
    assert.notEqual(repaired.ingestId, first.ingestId);
    const repairRecord = await readRequiredIntegrationIngest(vaultRoot, repaired.ingestId);
    assert.equal(repairRecord.parts.length, 2);
    assert.deepEqual(repairRecord.receipt, originalRecord.receipt);
    assert.deepEqual(repairRecord.outputs.events, []);
    assert.deepEqual(await fs.readFile(path.join(vaultRoot, eventPath)), beforeReplay);
    const eventRows = (await readJsonlRecords({
      vaultRoot,
      relativePath: eventPath,
    })) as EventRecord[];
    const latest = eventRows.at(-1);
    assert.equal(latest?.kind === "activity_session" ? latest.durationMinutes : undefined, 35);
  }
});

test("importDeviceBatch exact tail replay does not read a malformed historical prefix", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-bounded-exact-tail");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    evidenceParts: [{
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      content: { stages: [] },
    }],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  const absolutePath = path.join(vaultRoot, first.ingestShardPath);
  const exactRow = await fs.readFile(absolutePath, "utf8");
  await fs.writeFile(absolutePath, `not-json\n${exactRow}`, "utf8");

  const replay = await importDeviceBatch(input);

  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.equal(await fs.readFile(absolutePath, "utf8"), `not-json\n${exactRow}`);
});

test("malformed newline-framed ingest history retains one novel delivery and then converges", async () => {
  for (const outsideTail of [false, true]) {
    const vaultRoot = await makeTempDirectory(
      `murph-device-import-malformed-novel-${outsideTail ? "outside" : "inside"}-tail`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const first = await importDeviceBatch({
      vaultRoot,
      provider: "junction",
      accountId: "account-a",
      importedAt: "2026-06-03T21:00:00.000Z",
      evidenceParts: [{
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: { stages: [] },
      }],
    });
    assert.ok(first.applied);
    const firstRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
    const filler = outsideTail
      ? Array.from({ length: 65 }, (_, index) => JSON.stringify({
          ...firstRecord,
          id: deterministicContractId("xfm", `malformed-novel-tail-${index}`),
          provider: "unrelated-provider",
        })).join("\n") + "\n"
      : "";
    const ingestPath = first.ingestShardPath;
    const originalContent = await fs.readFile(path.join(vaultRoot, ingestPath), "utf8");
    await fs.writeFile(
      path.join(vaultRoot, ingestPath),
      `not-json\n${originalContent}${filler}`,
      "utf8",
    );
    const novelInput = {
      vaultRoot,
      provider: "junction",
      accountId: "account-a",
      importedAt: "2026-06-04T21:00:00.000Z",
      events: [buildJunctionStyleWorkoutEvent({
        resourceId: `workout-malformed-history-${outsideTail ? "outside" : "inside"}`,
      })],
      evidenceParts: [{
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: { id: "novel-workout" },
      }],
    } as const;

    const novel = await importDeviceBatch(novelInput);
    assert.ok(novel.applied);
    assert.ok(novel.auditPath);
    const watchedPaths = [ingestPath, novel.eventShardPaths[0] as string, novel.auditPath];
    const afterNovel = await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    );
    const replay = await importDeviceBatch(novelInput);

    assert.equal(replay.applied, false);
    assert.deepEqual(
      await Promise.all(
        watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
      ),
      afterNovel,
    );
    const finalLine = (await fs.readFile(path.join(vaultRoot, ingestPath), "utf8"))
      .trimEnd()
      .split("\n")
      .at(-1);
    assert.ok(finalLine);
    const retained = JSON.parse(finalLine) as IntegrationIngestRecord;
    assert.equal(retained.id, novel.ingestId);
    assert.deepEqual(retained.outputs.events.map((output) => output.id), [novel.events[0]?.id]);
  }
});

test("bounded novelty no-op does not full-scan an invalid exact id beyond the tail", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-bounded-novelty-prefix");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (targetVaultRoot: string, importedAt: string) => ({
    vaultRoot: targetVaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    evidenceParts: [{
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      content: { stages: [] },
    }],
  });
  const first = await importDeviceBatch(buildInput(vaultRoot, "2026-06-03T21:00:00.000Z"));
  assert.ok(first.applied);
  const firstRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);

  const probeVaultRoot = await makeTempDirectory("murph-device-import-bounded-novelty-probe");
  await initializeVault({ vaultRoot: probeVaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const replayInput = buildInput(vaultRoot, "2026-06-04T21:00:00.000Z");
  const probe = await importDeviceBatch(
    buildInput(probeVaultRoot, replayInput.importedAt),
  );
  assert.ok(probe.applied);
  const candidateRecord = await readRequiredIntegrationIngest(probeVaultRoot, probe.ingestId);
  const [candidatePart] = candidateRecord.parts;
  assert.ok(candidatePart);
  const invalidCandidateRecord = {
    ...candidateRecord,
    parts: [{ ...candidatePart, content: "integrity-invalid" }],
  };
  const unrelatedRows = Array.from({ length: 63 }, (_, index) => ({
    ...firstRecord,
    id: deterministicContractId("xfm", `bounded-novelty-tail-${index}`),
    provider: "unrelated-provider",
  }));
  const absolutePath = path.join(vaultRoot, first.ingestShardPath);
  const rows = [invalidCandidateRecord, firstRecord, ...unrelatedRows];
  const beforeReplay = `${rows.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await fs.writeFile(absolutePath, beforeReplay, "utf8");

  const replay = await importDeviceBatch(replayInput);

  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.equal(await fs.readFile(absolutePath, "utf8"), beforeReplay);
});

test("malformed ingest history still rejects an exact id owned by a different delivery", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-exact-id-conflict");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-04T21:00:00.000Z",
    evidenceParts: [{
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      content: { stages: [] },
    }],
  } as const;
  const probeVaultRoot = await makeTempDirectory("murph-device-import-exact-id-conflict-probe");
  await initializeVault({ vaultRoot: probeVaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const probe = await importDeviceBatch({ ...input, vaultRoot: probeVaultRoot });
  assert.ok(probe.applied);

  const seed = await importDeviceBatch({
    vaultRoot,
    provider: "different-provider",
    accountId: "different-account",
    importedAt: input.importedAt,
    evidenceParts: [{
      role: "different-summary",
      fileName: "different-summary.json",
      content: { value: "different-delivery" },
    }],
  });
  assert.ok(seed.applied);
  const seedRecord = await readRequiredIntegrationIngest(vaultRoot, seed.ingestId);
  const conflictingRecord = { ...seedRecord, id: probe.ingestId };
  const absolutePath = path.join(vaultRoot, seed.ingestShardPath);
  const unrelatedRows = Array.from({ length: 65 }, (_, index) => ({
    ...seedRecord,
    id: deterministicContractId("xfm", `malformed-conflict-tail-${index}`),
  }));
  await fs.writeFile(
    absolutePath,
    `not-json\n${JSON.stringify(conflictingRecord)}\n${unrelatedRows
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
    "utf8",
  );
  const beforeReplay = await fs.readFile(absolutePath);

  await assert.rejects(
    importDeviceBatch(input),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      assert.equal((error as VaultError).code, "INTEGRATION_INGEST_ID_CONFLICT");
      return true;
    },
  );
  assert.deepEqual(await fs.readFile(absolutePath), beforeReplay);
});

test("concatenated malformed ingest rows cannot hide current or legacy delivery ids", async () => {
  for (const hiddenIdKind of ["current", "legacy"] as const) {
    const targetVaultRoot = await makeTempDirectory(
      `murph-device-import-concatenated-hidden-${hiddenIdKind}`,
    );
    const probeVaultRoot = await makeTempDirectory(
      `murph-device-import-concatenated-hidden-${hiddenIdKind}-probe`,
    );
    await initializeVault({ vaultRoot: targetVaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    await initializeVault({ vaultRoot: probeVaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const input = {
      provider: "junction",
      accountId: "account-a",
      importedAt: "2026-06-04T21:00:00.000Z",
      evidenceParts: [{
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: { stages: [] },
        metadata: { revision: 1 },
      }],
    } as const;
    const probe = await importDeviceBatch({ ...input, vaultRoot: probeVaultRoot });
    assert.ok(probe.ingestId);
    const probeRecord = await readRequiredIntegrationIngest(probeVaultRoot, probe.ingestId);
    const evidenceContent = `${stableStringifyWearableRawPayload(input.evidenceParts[0].content)}\n`;
    const legacyImportId = deterministicContractId(
      "xfm",
      stableStringifyWearableRawPayload({
        provider: input.provider,
        accountId: input.accountId,
        source: "device",
        importedAt: input.importedAt,
        provenance: {},
        receipt: null,
        eventIds: [],
        sampleIds: [],
        evidenceParts: [{
          role: input.evidenceParts[0].role,
          fileName: input.evidenceParts[0].fileName,
          mediaType: null,
          sha256: createHash("sha256").update(evidenceContent).digest("hex"),
        }],
      }),
    );
    assert.notEqual(legacyImportId, probe.ingestId);
    const hiddenRecord = {
      ...probeRecord,
      id: hiddenIdKind === "current" ? probe.ingestId : legacyImportId,
    };
    const seed = await importDeviceBatch({
      vaultRoot: targetVaultRoot,
      provider: "different-provider",
      accountId: "different-account",
      importedAt: input.importedAt,
      evidenceParts: [{
        role: "different-summary",
        fileName: "different-summary.json",
        content: { value: "different-delivery" },
      }],
    });
    assert.ok(seed.ingestId);
    assert.ok(seed.ingestShardPath);
    const seedRecord = await readRequiredIntegrationIngest(targetVaultRoot, seed.ingestId);
    const validFinalRecord = {
      ...seedRecord,
      id: deterministicContractId("xfm", `concatenated-valid-final-${hiddenIdKind}`),
    };
    const absolutePath = path.join(targetVaultRoot, seed.ingestShardPath);
    await fs.writeFile(
      absolutePath,
      `${JSON.stringify(hiddenRecord)}${JSON.stringify(seedRecord)}\n` +
        `${JSON.stringify(validFinalRecord)}\n`,
      "utf8",
    );
    const beforeReplay = await fs.readFile(absolutePath);

    await assert.rejects(
      importDeviceBatch({ ...input, vaultRoot: targetVaultRoot }),
      (error) => error instanceof VaultError,
    );
    assert.deepEqual(await fs.readFile(absolutePath), beforeReplay);
  }
});

test("importDeviceBatch fails open when an incremental marker is beyond the row budget", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-partial-retention-retry");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const partA = {
    role: "junction-summary-sleep-cycle",
    fileName: "junction-summary-sleep-cycle.json",
    content: { revision: 1, stages: [] },
  } as const;
  const partB = {
    role: "junction-summary-workouts",
    fileName: "junction-summary-workouts.json",
    content: { revision: 1, workouts: [] },
  } as const;
  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    evidenceParts: [partA],
  });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-04T21:00:00.000Z",
    evidenceParts: [partA, partB],
  } as const;
  const filtered = await importDeviceBatch(input);
  assert.ok(filtered.applied);
  assert.equal(filtered.persistedEvidencePartCount, 1);
  const filteredRecord = await readRequiredIntegrationIngest(vaultRoot, filtered.ingestId);
  assert.deepEqual(filteredRecord.parts.map((part) => part.role), [partB.role]);
  const unrelatedRow = `${JSON.stringify({
    ...filteredRecord,
    id: "xfm_00000000000000000000000000",
    provider: "unrelated-provider",
    accountId: "unrelated-account",
  })}\n`;
  await fs.appendFile(path.join(vaultRoot, filtered.ingestShardPath), unrelatedRow.repeat(65), "utf8");
  const replay = await importDeviceBatch(input);
  const convergedReplay = await importDeviceBatch(input);

  assert.ok(replay.applied);
  assert.equal(replay.persistedEvidencePartCount, 2);
  assert.ok(replay.ingestId);
  const replayRecord = await readRequiredIntegrationIngest(vaultRoot, replay.ingestId);
  assert.deepEqual(
    replayRecord.parts.map((part) => part.role),
    [partA.role, partB.role],
  );
  assert.equal(convergedReplay.applied, false);
  assert.equal(convergedReplay.ingestId, null);
});

test.each([
  ["raw-only", "deleted", "tail"],
  ["raw-only", "deleted", "beyond-tail"],
  ["raw-only", "malformed", "tail"],
  ["raw-only", "malformed", "beyond-tail"],
  ["linked-output", "deleted", "tail"],
  ["linked-output", "deleted", "beyond-tail"],
  ["linked-output", "malformed", "tail"],
  ["linked-output", "malformed", "beyond-tail"],
] as const)(
  "filtered %s replay retains complete evidence after %s omitted proof with marker %s",
  async (deliveryKind, damage, markerPlacement) => {
    const vaultRoot = await makeTempDirectory(
      `murph-device-import-filtered-evidence-repair-${deliveryKind}-${damage}-${markerPlacement}`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const partA = {
      role: "junction-summary-activity",
      fileName: "junction-summary-activity.json",
      content: { date: "2026-06-03", steps: 8_000 },
    } as const;
    const partB = {
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { id: "filtered-evidence-repair", sport: "running" },
    } as const;
    const buildInput = (
      importedAt: string,
      evidenceParts: readonly [typeof partA] | readonly [typeof partA, typeof partB],
    ) => ({
      vaultRoot,
      provider: "junction",
      accountId: "jxn_acct_filtered_evidence_repair",
      importedAt,
      ...(deliveryKind === "linked-output"
        ? {
            events: evidenceParts.map((part, index) => ({
              ...buildJunctionStyleWorkoutEvent({
                occurredAt: index === 0
                  ? "2026-06-03T19:55:00.000Z"
                  : "2026-06-03T22:00:00.000Z",
                recordedAt: index === 0
                  ? "2026-06-03T20:30:00.000Z"
                  : "2026-06-03T22:35:00.000Z",
                resourceId: `filtered-evidence-repair-${part.role}`,
                sourceWorkoutId: `filtered-evidence-repair-${part.role}`,
              }),
              evidenceRoles: [part.role],
            })),
          }
        : {}),
      evidenceParts,
    });

    const seed = await importDeviceBatch(buildInput(
      "2026-06-03T21:00:00.000Z",
      [partA],
    ));
    const filteredInput = buildInput(
      "2026-06-04T21:00:00.000Z",
      [partA, partB],
    );
    const filtered = await importDeviceBatch(filteredInput);
    assert.ok(seed.applied);
    assert.ok(filtered.applied);
    assert.equal(filtered.persistedEvidencePartCount, 1);
    assert.ok(filtered.ingestId);
    assert.ok(filtered.ingestShardPath);
    const filteredRecord = await readRequiredIntegrationIngest(vaultRoot, filtered.ingestId);
    assert.deepEqual(filteredRecord.parts.map((part) => part.role), [partB.role]);
    if (deliveryKind === "linked-output") {
      assert.deepEqual(filteredRecord.outputs.events, [
        { id: seed.events[0]?.id, roles: [] },
        { id: filtered.events[1]?.id, roles: [partB.role] },
      ].sort((left, right) => (left.id ?? "").localeCompare(right.id ?? "")));
    }

    const unrelatedRows = markerPlacement === "beyond-tail"
      ? Array.from({ length: 65 }, (_, index) => ({
          ...filteredRecord,
          id: deterministicContractId(
            "xfm",
            `filtered-evidence-repair-tail-${deliveryKind}-${damage}-${index}`,
          ),
          provider: "unrelated-provider",
          accountId: "unrelated-account",
        }))
      : [];
    const damagedPrefix = damage === "malformed" ? "{\"damaged\":\n" : "";
    await fs.writeFile(
      path.join(vaultRoot, filtered.ingestShardPath),
      damagedPrefix
        + [filteredRecord, ...unrelatedRows]
          .map((record) => JSON.stringify(record))
          .join("\n")
        + "\n",
      "utf8",
    );

    const repaired = await importDeviceBatch(filteredInput);

    assert.ok(repaired.applied);
    assert.equal(repaired.persistedEvidencePartCount, 2);
    assert.ok(repaired.ingestId);
    const repairedLines = (await fs.readFile(
      path.join(vaultRoot, filtered.ingestShardPath),
      "utf8",
    )).trimEnd().split("\n");
    const repairedLine = repairedLines.at(-1);
    assert.ok(repairedLine);
    const repairedRecord = JSON.parse(repairedLine) as IntegrationIngestRecord;
    assert.equal(repairedRecord.id, repaired.ingestId);
    assert.deepEqual(
      repairedRecord.parts.map((part) => part.role),
      [partA.role, partB.role],
    );
    const beforeReplay = await snapshotVaultFiles(vaultRoot);
    const replay = await importDeviceBatch(filteredInput);
    assert.equal(replay.applied, false);
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplay);
  },
);

test("importDeviceBatch repairs a valid historical partial exact row with one self-contained delivery", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-historical-partial-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    evidenceParts: [
      {
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: { revision: 1, stages: [] },
      },
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: { revision: 1, workouts: [] },
      },
    ],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  const fullRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const historicalPartial = { ...fullRecord, parts: [fullRecord.parts[1]] };
  const unrelatedRows = Array.from({ length: 65 }, (_, index) => ({
    ...fullRecord,
    id: deterministicContractId("xfm", `historical-partial-tail-${index}`),
    provider: "unrelated-provider",
  }));
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    [historicalPartial, ...unrelatedRows].map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8",
  );

  const repaired = await importDeviceBatch(input);
  assert.ok(repaired.applied);
  assert.notEqual(repaired.ingestId, first.ingestId);
  assert.equal(repaired.persistedEvidencePartCount, 2);
  const repairedRecord = await readRequiredIntegrationIngest(vaultRoot, repaired.ingestId);
  assert.deepEqual(
    repairedRecord.parts.map((part) => part.role),
    input.evidenceParts.map((part) => part.role),
  );

  const beforeReplay = await fs.readFile(path.join(vaultRoot, repaired.ingestShardPath));
  const replay = await importDeviceBatch(input);
  assert.equal(replay.applied, false);
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, repaired.ingestShardPath)),
    beforeReplay,
  );
});

test("exact repair replans when a partial current row hides full legacy member proof", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-partial-current-full-legacy");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T12:00:00.000Z" });
  const roleV1 = "whoop-recovery-legacy-proof-v1";
  const roleV2 = "whoop-recovery-legacy-proof-v2";
  const buildEvent = (input: {
    occurredAt: string;
    role: string;
    value: number;
    version: string;
  }) => ({
    kind: "observation" as const,
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
    title: "WHOOP recovery score",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "partial-current-full-legacy",
      version: input.version,
      facet: "recovery-score",
    },
    evidenceRoles: [input.role],
    fields: {
      metric: "recovery-score",
      value: input.value,
      unit: "%",
    },
  });
  const input = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop_partial_current",
    importedAt: "2026-02-02T11:00:00.000Z",
    events: [
      buildEvent({
        occurredAt: "2026-01-31T23:30:00.000Z",
        role: roleV1,
        value: 67,
        version: "2026-01-31T23:30:00.000Z",
      }),
      buildEvent({
        occurredAt: "2026-02-01T00:30:00.000Z",
        role: roleV2,
        value: 70,
        version: "2026-02-01T00:30:00.000Z",
      }),
    ],
    evidenceParts: [
      {
        role: roleV1,
        fileName: "whoop-recovery-legacy-proof-v1.json",
        content: { value: 67 },
        metadata: { revision: 1 },
      },
      {
        role: roleV2,
        fileName: "whoop-recovery-legacy-proof-v2.json",
        content: { value: 70 },
        metadata: { revision: 1 },
      },
    ],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  const januaryShardPath = first.eventShardPaths.find((relativePath) =>
    relativePath.includes("2026-01")
  );
  const februaryShardPath = first.eventShardPaths.find((relativePath) =>
    relativePath.includes("2026-02")
  );
  assert.ok(januaryShardPath);
  assert.ok(februaryShardPath);
  const canonicalEventId = first.events[0]?.id;
  assert.ok(canonicalEventId);
  const fullRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const [fullOutput] = fullRecord.outputs.events;
  assert.ok(fullOutput);
  const secondEvent = first.events[1];
  assert.ok(secondEvent);
  const {
    id: _secondEventId,
    lifecycle: _secondEventLifecycle,
    rawRefs: _secondEventRawRefs,
    ...secondEventSeedRecord
  } = secondEvent;
  const preparedV2Id = deterministicContractId(
    "evt",
    stableStringifyWearableRawPayload({
      provider: input.provider,
      accountId: input.accountId,
      rawArtifactRoles: [roleV2],
      record: secondEventSeedRecord,
    }),
  );
  assert.notEqual(preparedV2Id, fullOutput.id);

  const legacyVaultRoot = await makeTempDirectory("murph-device-import-legacy-id-proof");
  await initializeVault({ vaultRoot: legacyVaultRoot, createdAt: "2026-01-01T12:00:00.000Z" });
  const legacy = await importDeviceBatch({
    ...input,
    vaultRoot: legacyVaultRoot,
    evidenceParts: [
      {
        role: roleV1,
        fileName: "whoop-recovery-legacy-proof-v1.json",
        content: { value: 67 },
      },
      {
        role: roleV2,
        fileName: "whoop-recovery-legacy-proof-v2.json",
        content: { value: 70 },
      },
    ],
  });
  assert.ok(legacy.ingestId);
  assert.notEqual(legacy.ingestId, first.ingestId);
  const fullLegacyRecord: IntegrationIngestRecord = { ...fullRecord, id: legacy.ingestId };
  const splitLegacyRecord: IntegrationIngestRecord = {
    ...fullLegacyRecord,
    outputs: {
      ...fullLegacyRecord.outputs,
      events: [{ ...fullOutput, roles: [roleV1] }],
    },
  };
  const partialCurrentRecord: IntegrationIngestRecord = {
    ...fullRecord,
    parts: fullRecord.parts.filter((part) => part.role === roleV2),
    outputs: {
      ...fullRecord.outputs,
      events: [{ ...fullOutput, roles: [roleV2] }],
    },
  };
  const strandedAssociationId = deterministicContractId(
    "xfm",
    stableStringifyWearableRawPayload({
      associationRevisionOfDeviceImportId: first.ingestId,
      eventOutputs: partialCurrentRecord.outputs.events,
      sampleIds: [],
    }),
  );
  const strandedAssociationRecord: IntegrationIngestRecord = {
    ...fullRecord,
    id: strandedAssociationId,
    outputs: partialCurrentRecord.outputs,
  };
  const conflictingPartialCurrentRecord: IntegrationIngestRecord = {
    ...partialCurrentRecord,
    parts: fullRecord.parts,
    outputs: {
      ...fullRecord.outputs,
      events: [{ id: preparedV2Id, roles: [roleV1] }],
    },
  };
  const finalAssociationId = deterministicContractId(
    "xfm",
    stableStringifyWearableRawPayload({
      associationRevisionOfDeviceImportId: first.ingestId,
      eventOutputs: [fullOutput],
      sampleIds: [],
    }),
  );
  assert.notEqual(finalAssociationId, strandedAssociationId);
  const unrelatedRows = Array.from({ length: 65 }, (_, index) => ({
    ...fullRecord,
    id: deterministicContractId("xfm", `partial-current-legacy-tail-${index}`),
    provider: "unrelated-provider",
  }));
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    [fullLegacyRecord, ...unrelatedRows, conflictingPartialCurrentRecord, strandedAssociationRecord]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
    "utf8",
  );
  await fs.unlink(path.join(vaultRoot, januaryShardPath));
  const beforeConflictingReplay = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) => error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS"
      && error.message.endsWith("maps to conflicting stored canonical events."),
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeConflictingReplay);

  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    [...unrelatedRows, partialCurrentRecord]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
    "utf8",
  );
  const beforePartialOnlyReplay = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) => error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforePartialOnlyReplay);

  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    [splitLegacyRecord, ...unrelatedRows, partialCurrentRecord, strandedAssociationRecord]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
    "utf8",
  );
  const februaryBytesBeforeRepair = await fs.readFile(path.join(vaultRoot, februaryShardPath));
  const repaired = await importDeviceBatch(input);

  assert.ok(repaired.applied);
  assert.equal(repaired.ingestId, finalAssociationId);
  const repairedJanuaryRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: januaryShardPath,
  })) as EventRecord[];
  assert.equal(repairedJanuaryRows.length, 1);
  assert.equal(repairedJanuaryRows[0]?.id, canonicalEventId);
  assert.equal(repairedJanuaryRows[0]?.lifecycle?.revision ?? 1, 1);
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, februaryShardPath)),
    februaryBytesBeforeRepair,
  );
  const repairedIngest = await readRequiredIntegrationIngest(vaultRoot, repaired.ingestId);
  assert.deepEqual(repairedIngest.outputs.events, [fullOutput]);
  const repairedIngestRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.ingestShardPath,
  })) as IntegrationIngestRecord[];
  assert.equal(
    repairedIngestRows.filter((record) => record.id === finalAssociationId).length,
    1,
  );
  assert.equal(
    repairedIngestRows.filter((record) => record.id === strandedAssociationId).length,
    1,
  );
  assert.equal(new Set(repairedIngestRows.map((record) => record.id)).size, repairedIngestRows.length);
  const beforeConvergedReplay = await snapshotVaultFiles(vaultRoot);
  const converged = await importDeviceBatch(input);
  assert.equal(converged.applied, false);
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, februaryShardPath)),
    februaryBytesBeforeRepair,
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeConvergedReplay);
});

test("exact repair rejects unresolved partial associations after full inspection", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-bounded-noop-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T12:00:00.000Z" });
  const roleV1 = "whoop-bounded-noop-repair-v1";
  const roleV2 = "whoop-bounded-noop-repair-v2";
  const buildEvent = (input: {
    occurredAt: string;
    role: string;
    value: number;
    version: string;
  }) => ({
    kind: "observation" as const,
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
    title: "WHOOP recovery score",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "bounded-noop-repair",
      version: input.version,
      facet: "recovery-score",
    },
    evidenceRoles: [input.role],
    fields: {
      metric: "recovery-score",
      value: input.value,
      unit: "%",
    },
  });
  const input = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop_bounded_noop",
    importedAt: "2026-02-02T11:00:00.000Z",
    events: [
      buildEvent({
        occurredAt: "2026-01-31T23:30:00.000Z",
        role: roleV1,
        value: 67,
        version: "2026-01-31T23:30:00.000Z",
      }),
      buildEvent({
        occurredAt: "2026-02-01T00:30:00.000Z",
        role: roleV2,
        value: 70,
        version: "2026-02-01T00:30:00.000Z",
      }),
    ],
    evidenceParts: [
      {
        role: roleV1,
        fileName: "whoop-bounded-noop-repair-v1.json",
        content: { value: 67 },
      },
      {
        role: roleV2,
        fileName: "whoop-bounded-noop-repair-v2.json",
        content: { value: 70 },
      },
    ],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  const januaryShardPath = first.eventShardPaths.find((relativePath) =>
    relativePath.includes("2026-01")
  );
  const februaryShardPath = first.eventShardPaths.find((relativePath) =>
    relativePath.includes("2026-02")
  );
  assert.ok(januaryShardPath);
  assert.ok(februaryShardPath);
  const canonicalEventId = first.events[0]?.id;
  assert.ok(canonicalEventId);
  const fullRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);

  const later = await importDeviceBatch({
    ...input,
    provenance: { sync: "later" },
    samples: [{
      stream: "hrv",
      recordedAt: "2026-02-02T10:00:00.000Z",
      unit: "ms",
      quality: "normalized",
      sample: {
        recordedAt: "2026-02-02T10:00:00.000Z",
        value: 41,
      },
    }],
  });
  assert.ok(later.applied);
  assert.ok(later.ingestId);
  assert.notEqual(later.ingestId, first.ingestId);
  const laterRecord = await readRequiredIntegrationIngest(vaultRoot, later.ingestId);
  assert.deepEqual(laterRecord.provenance, { sync: "later" });
  assert.deepEqual(laterRecord.parts.map((part) => part.role), [roleV1, roleV2]);
  assert.ok(laterRecord.outputs.events.some((output) =>
    output.id === canonicalEventId && output.roles.includes(roleV2)
  ));
  const boundedReplayAssociationId = deterministicContractId(
    "xfm",
    stableStringifyWearableRawPayload({
      associationRevisionOfDeviceImportId: first.ingestId,
      eventOutputs: [{ id: canonicalEventId, roles: [roleV2] }],
      sampleIds: [],
    }),
  );
  assert.notEqual(later.ingestId, boundedReplayAssociationId);
  const boundedReplayAssociationRecord: IntegrationIngestRecord = {
    ...fullRecord,
    id: boundedReplayAssociationId,
    outputs: {
      ...fullRecord.outputs,
      events: [{ id: canonicalEventId, roles: [roleV2] }],
    },
  };
  const partialCurrentRecord: IntegrationIngestRecord = {
    ...boundedReplayAssociationRecord,
    id: first.ingestId,
  };
  const unrelatedRows = Array.from({ length: 65 }, (_, index) => ({
    ...fullRecord,
    id: deterministicContractId("xfm", `bounded-noop-repair-tail-${index}`),
    provider: "unrelated-provider",
  }));
  await fs.unlink(path.join(vaultRoot, januaryShardPath));
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    [...unrelatedRows, laterRecord, partialCurrentRecord, boundedReplayAssociationRecord]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
    "utf8",
  );
  const februaryBytesBeforeRepair = await fs.readFile(path.join(vaultRoot, februaryShardPath));

  const beforeUnprovenReplay = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) => error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeUnprovenReplay);

  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    [
      `{"malformed":`,
      ...unrelatedRows.map((record) => JSON.stringify(record)),
      JSON.stringify(laterRecord),
      JSON.stringify(partialCurrentRecord),
      JSON.stringify(boundedReplayAssociationRecord),
    ].join("\n") + "\n",
    "utf8",
  );
  const beforeUnsafeReplay = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) => error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeUnsafeReplay);

  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    [fullRecord, ...unrelatedRows, laterRecord]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
    "utf8",
  );
  const repaired = await importDeviceBatch(input);
  assert.ok(repaired.applied);
  const repairedJanuaryRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: januaryShardPath,
  })) as EventRecord[];
  assert.equal(repairedJanuaryRows.length, 1);
  assert.equal(repairedJanuaryRows[0]?.id, canonicalEventId);
  assert.equal(repairedJanuaryRows[0]?.lifecycle?.revision ?? 1, 1);
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, februaryShardPath)),
    februaryBytesBeforeRepair,
  );
  const beforeConvergedReplay = await snapshotVaultFiles(vaultRoot);
  const converged = await importDeviceBatch(input);
  assert.equal(converged.applied, false);
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, februaryShardPath)),
    februaryBytesBeforeRepair,
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeConvergedReplay);
});

test("importDeviceBatch dedupes replayed evidence larger than the ordinary novelty byte budget", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-large-novelty-proof");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const largeContent = "x".repeat(9 * 1024 * 1024);
  const buildInput = (importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    evidenceParts: [
      {
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: largeContent,
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z"));
  const replay = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z"));

  assert.ok(first.applied);
  assert.equal(first.persistedEvidencePartCount, 1);
  assert.equal(replay.applied, false);
  assert.equal(replay.persistedEvidencePartCount, 0);
});

test("importDeviceBatch dedupes replay when JSON escaping expands the tail row past the novelty byte budget", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-escaped-novelty-proof");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const noveltyScanBytes = 8 * 1024 * 1024;
  const escapedContent = "\\".repeat((noveltyScanBytes / 2) + 1024);
  const buildInput = (importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    evidenceParts: [
      {
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: escapedContent,
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z"));
  assert.ok(first.applied);
  const firstRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const [persistedPart] = firstRecord.parts;
  assert.ok(persistedPart);
  assert.ok(persistedPart.byteSize <= noveltyScanBytes);
  assert.ok(
    (await fs.stat(path.join(vaultRoot, first.ingestShardPath))).size > noveltyScanBytes,
    "expected JSON escaping to expand the persisted row past the ordinary scan budget",
  );

  const replay = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z"));

  assert.equal(replay.applied, false);
  assert.equal(replay.persistedEvidencePartCount, 0);
});

test("importDeviceBatch retains evidence when the newest complete row exceeds the novelty byte budget", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-novelty-tail-byte-budget");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    evidenceParts: [
      {
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: { revision: 1, stages: [] },
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z"));
  assert.ok(first.applied);
  const firstRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const oversizedRow = `${JSON.stringify({
    ...firstRecord,
    provider: "unrelated-provider",
    accountId: "unrelated-account",
    provenance: { padding: "x".repeat(9 * 1024 * 1024) },
  })}\n`;
  await fs.appendFile(
    path.join(vaultRoot, first.ingestShardPath),
    oversizedRow,
    "utf8",
  );

  const replay = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z"));
  assert.ok(replay.applied);
  assert.equal(replay.persistedEvidencePartCount, 1);
});

test("importDeviceBatch dedupes evidence retained in an archived target shard", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-novelty-archive");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt,
    evidenceParts: [
      {
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: { revision: 1, stages: [] },
      },
    ],
  });
  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z"));
  assert.ok(first.applied);
  const firstRecord = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const evidencePart = firstRecord.parts[0];
  assert.ok(evidencePart);
  const absoluteShardPath = path.join(vaultRoot, first.ingestShardPath);
  const liveShard = await fs.readFile(absoluteShardPath);
  await fs.writeFile(`${absoluteShardPath}.gz`, gzipSync(liveShard));
  await fs.rm(absoluteShardPath);

  const archivePath = `${absoluteShardPath}.gz`;
  const beforeReplay = await fs.readFile(archivePath);
  const replay = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z"));
  const selection = await selectNovelIntegrationIngestEvidence({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-04T21:00:00.000Z",
    parts: [evidencePart],
  });

  assert.equal(replay.applied, false);
  assert.equal(replay.ingestId, null);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(await fs.readFile(archivePath), beforeReplay);
  assert.deepEqual(selection.parts, []);
  assert.equal(selection.receiptIsNovel, false);
});

test("importDeviceBatch treats evidence metadata as part of deterministic import identity", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-evidence-metadata-identity");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const importRevision = (revision: number) => importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    evidenceParts: [{
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      content: { stages: [] },
      metadata: { revision },
    }],
  });

  const first = await importRevision(1);
  const changedMetadata = await importRevision(2);

  assert.ok(first.applied);
  assert.ok(changedMetadata.applied);
  assert.notEqual(changedMetadata.ingestId, first.ingestId);
  assert.equal(
    (await readJsonlRecords({ vaultRoot, relativePath: first.ingestShardPath })).length,
    2,
  );
});

test("importDeviceBatch retains raw-only evidence when no stable account scope is available", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-raw-only-no-account");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    importedAt,
    evidenceParts: [
      {
        role: "junction-summary-sleep-cycle",
        fileName: "junction-summary-sleep-cycle.json",
        content: { revision: 1, stages: [] },
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("2026-06-03T21:00:00.000Z"));
  const second = await importDeviceBatch(buildInput("2026-06-04T21:00:00.000Z"));

  assert.ok(first.applied);
  assert.ok(second.applied);
  assert.equal(first.persistedEvidencePartCount, 1);
  assert.equal(second.persistedEvidencePartCount, 1);
});

test("importDeviceBatch scopes raw-only evidence dedupe to the exact provider account", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-raw-only-account-scope");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const evidenceParts = [
    {
      role: "daily-summary",
      fileName: "daily-summary.json",
      content: { revision: 1, stages: [] },
    },
  ];
  const importFor = (provider: string, accountId: string, importedAt: string) =>
    importDeviceBatch({ vaultRoot, provider, accountId, importedAt, evidenceParts });

  const first = await importFor("junction", "account-a", "2026-06-03T21:00:00.000Z");
  const differentAccount = await importFor(
    "junction",
    "account-b",
    "2026-06-04T21:00:00.000Z",
  );
  const differentProvider = await importFor(
    "whoop",
    "account-a",
    "2026-06-05T21:00:00.000Z",
  );
  const replay = await importFor("junction", "account-a", "2026-06-06T21:00:00.000Z");

  assert.ok(first.applied);
  assert.ok(differentAccount.applied);
  assert.ok(differentProvider.applied);
  assert.equal(replay.applied, false);
  const rows = await readJsonlRecords({ vaultRoot, relativePath: first.ingestShardPath });
  assert.equal(rows.length, 3);
});

test("importDeviceBatch retains evidence when a matching historical ingest fails integrity", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-evidence-integrity-fail-open");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const evidenceParts = [
    {
      role: "junction-summary-sleep-cycle",
      fileName: "junction-summary-sleep-cycle.json",
      content: { revision: 1, stages: [] },
    },
  ];

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-03T21:00:00.000Z",
    evidenceParts,
  });
  assert.ok(first.applied);
  const corrupted = structuredClone(
    await readRequiredIntegrationIngest(vaultRoot, first.ingestId),
  );
  corrupted.parts[0]!.sha256 = "0".repeat(64);
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    `${JSON.stringify(corrupted)}\n`,
    "utf8",
  );

  const replay = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-04T21:00:00.000Z",
    evidenceParts,
  });

  assert.ok(replay.applied);
  assert.equal(replay.persistedEvidencePartCount, 1);
  assert.equal(replay.ingestShardPath, first.ingestShardPath);
});

test("importDeviceBatch keeps unchanged sample provenance when evidence is linked or changes", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-sample-evidence-change");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const sample = {
    stream: "hrv",
    recordedAt: "2026-06-03T07:30:00.000Z",
    unit: "ms",
    quality: "normalized",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "sleep-1",
      version: "2026-06-03T07:30:00.000Z",
      facet: "hrv",
    },
    sample: {
      recordedAt: "2026-06-03T07:30:00.000Z",
      value: 42.5,
    },
  };
  const buildInput = (importedAt: string, revision: number) => ({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt,
    samples: [sample],
    evidenceParts: [
      {
        role: "recovery:sleep-1",
        fileName: "recovery-sleep-1.json",
        content: { revision, hrv: 42.5 },
      },
    ],
  });

  const rawOnly = await importDeviceBatch({
    ...buildInput("2026-06-03T09:30:00.000Z", 1),
    samples: [],
  });
  const sampleOnly = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-06-04T09:30:00.000Z",
    samples: [sample],
  });
  const linked = await importDeviceBatch(buildInput("2026-06-05T09:30:00.000Z", 1));
  const changed = await importDeviceBatch(buildInput("2026-06-06T09:30:00.000Z", 2));
  const replay = await importDeviceBatch(buildInput("2026-06-07T09:30:00.000Z", 2));

  assert.ok(rawOnly.applied);
  assert.ok(sampleOnly.applied);
  assert.ok(linked.applied);
  assert.ok(changed.applied);
  assert.equal(replay.applied, false);
  const linkedIngest = await readRequiredIntegrationIngest(vaultRoot, linked.ingestId);
  const changedIngest = await readRequiredIntegrationIngest(vaultRoot, changed.ingestId);
  assert.deepEqual(linkedIngest.outputs.sampleIds, [sampleOnly.samples[0]?.id]);
  assert.deepEqual(changedIngest.outputs.sampleIds, [sampleOnly.samples[0]?.id]);
  assert.equal(changedIngest.counts.sampleCount, 1);
});

test("importDeviceBatch dedupes operational receipt replay but retains a verification transition", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-receipt-idempotency");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildReceipt = (observedAt: string, signatureVerified: boolean) => ({
    schemaVersion: "wearable.raw_ingest_receipt.v1" as const,
    id: `wearable_raw_${"a".repeat(24)}`,
    provider: "junction",
    accountId: "jxn_acct_stable",
    sourceKind: "webhook" as const,
    deliveryMode: "full_payload" as const,
    eventType: "update" as const,
    observedAt,
    windowStart: "2026-06-03T00:00:00.000Z",
    windowEnd: observedAt,
    cursor: observedAt,
    signatureVerified,
    payloadHash: "b".repeat(64),
  });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    ingestReceipt: buildReceipt("2026-06-03T21:00:00.000Z", false),
  });
  const replay = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    ingestReceipt: buildReceipt("2026-06-04T21:00:00.000Z", false),
  });
  const verified = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-05T21:00:00.000Z",
    ingestReceipt: buildReceipt("2026-06-05T21:00:00.000Z", true),
  });

  assert.ok(first.applied);
  assert.equal(replay.applied, false);
  assert.ok(verified.applied);
  const rows = await readJsonlRecords({ vaultRoot, relativePath: first.ingestShardPath });
  assert.equal(rows.length, 2);
});

test("importDeviceBatch treats a changed receipt payload hash as novel", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-receipt-payload-change");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildReceipt = (observedAt: string, payloadHash: string) => ({
    schemaVersion: "wearable.raw_ingest_receipt.v1" as const,
    id: `wearable_raw_${"a".repeat(24)}`,
    provider: "junction",
    accountId: "jxn_acct_stable",
    sourceKind: "webhook" as const,
    deliveryMode: "full_payload" as const,
    observedAt,
    payloadHash,
  });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    ingestReceipt: buildReceipt("2026-06-03T21:00:00.000Z", "b".repeat(64)),
  });
  const changed = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    ingestReceipt: buildReceipt("2026-06-04T21:00:00.000Z", "c".repeat(64)),
  });

  assert.ok(first.applied);
  assert.ok(changed.applied);
});

test("importDeviceBatch updates changed provider records in place by externalRef", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-externalref-update");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const second = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        recordedAt: "2026-06-04T07:00:00.000Z",
        durationMinutes: 36,
      }),
    ],
  });

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(eventRecords.length, 2);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0]?.id, first.events[0]?.id);
  assert.equal(second.events[0]?.lifecycle?.revision, 2);
  const latest = eventRecords.find((record) => record.lifecycle?.revision === 2);
  assert.equal(
    (latest as { durationMinutes?: number } | undefined)?.durationMinutes,
    36,
  );
});

test("importDeviceBatch updates changed provider records across month shards by externalRef", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-externalref-cross-month");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-30T23:55:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        occurredAt: "2026-06-30T23:15:00.000Z",
        recordedAt: "2026-06-30T23:45:00.000Z",
        durationMinutes: 34,
      }),
    ],
  });
  const second = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-07-01T00:55:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        occurredAt: "2026-07-01T00:05:00.000Z",
        recordedAt: "2026-07-01T00:35:00.000Z",
        durationMinutes: 36,
      }),
    ],
  });

  assert.deepEqual(first.eventShardPaths, ["ledger/events/2026/2026-06.jsonl"]);
  assert.deepEqual(second.eventShardPaths, ["ledger/events/2026/2026-07.jsonl"]);
  assert.equal(second.events[0]?.id, first.events[0]?.id);
  assert.equal(second.events[0]?.lifecycle?.revision, 2);

  const juneEvents = (await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/events/2026/2026-06.jsonl",
  })) as EventRecord[];
  const julyEvents = (await readJsonlRecords({
    vaultRoot,
    relativePath: "ledger/events/2026/2026-07.jsonl",
  })) as EventRecord[];

  assert.equal(juneEvents.length + julyEvents.length, 2);
  assert.deepEqual(
    [...new Set([...juneEvents, ...julyEvents].map((record) => record.id))],
    [first.events[0]?.id],
  );
});

test("importDeviceBatch rejects kind rewrites through a shared externalRef", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-externalref-kind-stability");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const baseEvent = buildJunctionStyleWorkoutEvent();
  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [baseEvent],
  });

  await assert.rejects(
    importDeviceBatch({
      vaultRoot,
      provider: "junction",
      accountId: "jxn_acct_stable",
      importedAt: "2026-06-04T21:00:00.000Z",
      events: [
        {
          kind: "observation",
          occurredAt: "2026-06-04T19:55:00.000Z",
          recordedAt: "2026-06-04T20:30:00.000Z",
          title: "Workout distance",
          externalRef: baseEvent.externalRef,
          fields: {
            metric: "distance",
            observationGrain: "summary" as const,
            unit: "km",
            value: 5,
          },
        },
      ],
    }),
    (error) => {
      assert.equal(error instanceof VaultError, true);
      const vaultError = error as VaultError;
      assert.equal(vaultError.code, "EVENT_KIND_MISMATCH");
      assert.match(vaultError.message, /already belongs to kind "activity_session"/u);
      return true;
    },
  );

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];
  assert.equal(eventRecords.length, 1);
  assert.equal(eventRecords[0]?.kind, "activity_session");
});

test("exact replay does not restore an event after its externalRef changes kind", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-exact-kind-replacement");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const baseEvent = buildJunctionStyleWorkoutEvent();
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [baseEvent],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  const importedEventId = first.events[0]?.id;
  assert.ok(importedEventId);
  await deleteEvent({ vaultRoot, eventId: importedEventId });
  await upsertEvent({
    vaultRoot,
    payload: {
      kind: "observation",
      occurredAt: baseEvent.occurredAt,
      recordedAt: "2026-06-03T21:30:00.000Z",
      title: "Workout distance",
      externalRef: baseEvent.externalRef,
      metric: "distance",
      observationGrain: "summary",
      unit: "km",
      value: 5,
    },
  });
  const eventPath = first.eventShardPaths[0] as string;
  const eventBytesBeforeReplay = await fs.readFile(path.join(vaultRoot, eventPath));
  const ingestBytesBeforeReplay = await fs.readFile(path.join(vaultRoot, first.ingestShardPath));

  const replay = await importDeviceBatch(input);

  assert.equal(replay.applied, false);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, eventPath)), eventBytesBeforeReplay);
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, first.ingestShardPath)),
    ingestBytesBeforeReplay,
  );
});

test("repairJunctionWorkoutHeartRateZones appends corrected revisions idempotently", async () => {
  const vaultRoot = await makeTempDirectory("murph-junction-hr-zone-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const legacyResourceId = "workouts-legacy-1";
  const currentResourceId = "workouts-current-1";
  const enrichedResourceId = "workouts-enriched-1";
  const explicitObjectResourceId = "workouts-explicit-object-1";
  const otherProviderResourceId = "workouts-other-provider-1";

  const imported = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: legacyResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: "garmin-legacy-workout-1",
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
      buildJunctionStyleWorkoutEvent({
        resourceId: currentResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: "garmin-current-workout-1",
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index,
          durationMinutes,
        })),
      }),
      buildJunctionStyleWorkoutEvent({
        resourceId: enrichedResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: "garmin-enriched-workout-1",
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
          label: `Zone ${index + 1}`,
        })),
      }),
      buildJunctionStyleWorkoutEvent({
        resourceId: explicitObjectResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: "garmin-explicit-object-workout-1",
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
      buildJunctionStyleWorkoutEvent({
        resourceId: otherProviderResourceId,
        resourceType: "junction-whoop-v2-workouts",
        sourceApp: "whoop",
        sourceWorkoutId: "whoop-workout-1",
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "garmin" },
            id: "garmin-legacy-workout-1",
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
          {
            source: { provider: "garmin" },
            id: "garmin-explicit-object-workout-1",
            hr_zones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
              zone: index + 1,
              duration: durationMinutes * 60,
            })),
          },
        ],
      },
    ],
  });

  const dryRun = await repairJunctionWorkoutHeartRateZones({ vaultRoot });

  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.hasWork, true);
  assert.equal(dryRun.mutated, false);
  assert.equal(dryRun.candidateCount, 1);
  // garmin-explicit-object: raw entry exists from garmin but is object-shaped, not primitive numeric.
  // whoop-workout-1: candidate shape but no whoop raw entry in the artifact.
  assert.equal(dryRun.unverifiedCandidateCount, 2);
  assert.equal(dryRun.repairedCount, 0);
  assert.equal(dryRun.touchedPathCount, 1);

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.mode, "apply");
  assert.equal(applied.hasWork, true);
  assert.equal(applied.mutated, true);
  assert.equal(applied.candidateCount, 1);
  assert.equal(applied.unverifiedCandidateCount, 2);
  assert.equal(applied.repairedCount, 1);
  assert.equal(typeof applied.auditPath, "string");

  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: imported.eventShardPaths[0] as string,
  })) as EventRecord[];
  const revisions = records.filter(
    (record): record is Extract<EventRecord, { kind: "activity_session" }> =>
      record.kind === "activity_session",
  );

  const legacyRevisions = revisions.filter((record) =>
    record.externalRef?.resourceId === legacyResourceId
  );
  const currentRevisions = revisions.filter((record) =>
    record.externalRef?.resourceId === currentResourceId
  );
  const enrichedRevisions = revisions.filter((record) =>
    record.externalRef?.resourceId === enrichedResourceId
  );
  const explicitObjectRevisions = revisions.filter((record) =>
    record.externalRef?.resourceId === explicitObjectResourceId
  );
  const otherProviderRevisions = revisions.filter((record) =>
    record.externalRef?.resourceId === otherProviderResourceId
  );

  assert.equal(revisions.length, 6);
  assert.equal(legacyRevisions.length, 2);
  assert.equal(currentRevisions.length, 1);
  assert.equal(enrichedRevisions.length, 1);
  assert.equal(explicitObjectRevisions.length, 1);
  assert.equal(otherProviderRevisions.length, 1);
  const originalRevision = legacyRevisions.find((record) =>
    record.workout?.heartRateZones?.[0]?.zone === 1
  );
  const repairedRevision = legacyRevisions.find((record) =>
    record.workout?.heartRateZones?.[0]?.zone === 0
  );

  assert.deepEqual(
    originalRevision?.workout?.heartRateZones?.map((zone) => zone.zone),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    repairedRevision?.workout?.heartRateZones?.map((zone) => zone.zone),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(repairedRevision?.lifecycle?.revision, 2);
  assert.deepEqual(
    currentRevisions[0]?.workout?.heartRateZones?.map((zone) => zone.zone),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    enrichedRevisions[0]?.workout?.heartRateZones?.map((zone) => zone.zone),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    explicitObjectRevisions[0]?.workout?.heartRateZones?.map((zone) => zone.zone),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    otherProviderRevisions[0]?.workout?.heartRateZones?.map((zone) => zone.zone),
    [1, 2, 3, 4, 5, 6],
  );

  const reimport = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T12:30:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: legacyResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: "garmin-legacy-workout-1",
        recordedAt: "2026-06-04T12:30:00.000Z",
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index,
          durationMinutes,
        })),
      }),
    ],
  });
  const recordsAfterReimport = (await readJsonlRecords({
    vaultRoot,
    relativePath: imported.eventShardPaths[0] as string,
  })) as EventRecord[];
  const legacyRevisionsAfterReimport = recordsAfterReimport.filter(
    (record): record is Extract<EventRecord, { kind: "activity_session" }> =>
      record.kind === "activity_session"
      && record.externalRef?.resourceId === legacyResourceId,
  );

  assert.equal(reimport.events[0]?.lifecycle?.revision, 2);
  assert.equal(legacyRevisionsAfterReimport.length, legacyRevisions.length);
  assert.deepEqual(
    legacyRevisionsAfterReimport.at(-1)?.workout?.heartRateZones?.map((zone) => zone.zone),
    [0, 1, 2, 3, 4, 5],
  );

  const secondApply = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:01:00.000Z"),
  });
  const recordsAfterSecondApply = await readJsonlRecords({
    vaultRoot,
    relativePath: imported.eventShardPaths[0] as string,
  });

  assert.equal(secondApply.hasWork, false);
  assert.equal(secondApply.mutated, false);
  assert.equal(secondApply.candidateCount, 0);
  assert.equal(secondApply.unverifiedCandidateCount, 2);
  assert.equal(secondApply.repairedCount, 0);
  assert.equal(recordsAfterSecondApply.length, records.length);
});

test("repairJunctionWorkoutHeartRateZones inherits provider context from an envelope around nested workout entries", async () => {
  // Junction can ship workouts inside an envelope where the envelope holds
  // `source.provider` and the child holds id+hr_zones. The matcher must
  // propagate the envelope's provider into the child to verify the match.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-envelope");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const garminResourceId = "workouts-garmin-envelope";
  const garminWorkoutId = "garmin-envelope-workout-1";

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: garminResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: garminWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "garmin" },
            entries: [
              {
                id: garminWorkoutId,
                hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
              },
            ],
          },
        ],
      },
    ],
  });

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 1);
  assert.equal(applied.unverifiedCandidateCount, 0);
  assert.equal(applied.repairedCount, 1);
  assert.equal(applied.mutated, true);
});

test("repairJunctionWorkoutHeartRateZones accepts raw hr_zones stored as numeric strings", async () => {
  // The importer's numeric branch uses finiteNumber, which accepts both
  // numbers and trimmed numeric strings. Legacy stringified payloads were
  // normalized into the same 1..6 stored shape and must be repairable.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-numeric-strings");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const garminResourceId = "workouts-garmin-stringified";
  const garminWorkoutId = "garmin-stringified-workout-1";

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: garminResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: garminWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "garmin" },
            id: garminWorkoutId,
            hr_zones: ["600", "1200", "1800", "2400", "3000", "3600"],
          },
        ],
      },
    ],
  });

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 1);
  assert.equal(applied.unverifiedCandidateCount, 0);
  assert.equal(applied.repairedCount, 1);
  assert.equal(applied.mutated, true);
});

test("repairJunctionWorkoutHeartRateZones refuses candidates from shards with unparseable JSON without aborting the run", async () => {
  // An unparseable JSONL line in a shard might be a torn later revision
  // (tombstone, kind change, manual correction) under any id. We can't tell
  // which id, so we refuse the whole shard's candidates rather than risk
  // appending a revision over an invisible newer one. The command itself
  // must still complete — torn lines in one shard don't abort the run.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-torn-jsonl");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const garminResourceId = "workouts-garmin-torn-jsonl";
  const garminWorkoutId = "garmin-torn-jsonl-workout-1";

  const imported = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: garminResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: garminWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "garmin" },
            id: garminWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
    ],
  });

  const shardPath = imported.eventShardPaths[0];
  assert.ok(typeof shardPath === "string");
  const shardAbsolute = path.join(vaultRoot, shardPath as string);
  await fs.appendFile(shardAbsolute, '{"truncated":\n');

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 0);
  assert.equal(applied.repairedCount, 0);
  assert.equal(applied.mutated, false);
});

test("repairJunctionWorkoutHeartRateZones skips malformed ledger rows instead of aborting the run", async () => {
  // Legacy/partially migrated vaults can contain rows the current schema
  // rejects. A single bad row must not block the repair from reporting and
  // fixing valid Junction workout candidates elsewhere.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-malformed-row");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const garminResourceId = "workouts-garmin-malformed-row";
  const garminWorkoutId = "garmin-malformed-row-workout-1";

  const imported = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: garminResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: garminWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "garmin" },
            id: garminWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
    ],
  });

  const shardPath = imported.eventShardPaths[0];
  assert.ok(typeof shardPath === "string");
  const shardAbsolute = path.join(vaultRoot, shardPath as string);
  await fs.appendFile(shardAbsolute, `${JSON.stringify({ totally: "not-an-event-record" })}\n`);

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 1);
  assert.equal(applied.repairedCount, 1);
  assert.equal(applied.mutated, true);
});

test("repairJunctionWorkoutHeartRateZones repairs non-Garmin Junction-backed providers with matching raw evidence", async () => {
  // The HR-zone normalization bug lives in Junction's provider-agnostic
  // workout pipeline (buildWorkoutHeartRateZones / readWorkoutHeartRateZoneNumber),
  // so any Junction-routed provider that delivered primitive-numeric `hr_zones`
  // arrays carries the same legacy 1..6 corruption. The repair must reach them too.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-non-garmin");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const whoopResourceId = "workouts-whoop-legacy";
  const whoopWorkoutId = "whoop-legacy-workout-1";

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: whoopResourceId,
        resourceType: "junction-whoop-v2-workouts",
        sourceApp: "whoop",
        sourceWorkoutId: whoopWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "whoop" },
            id: whoopWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
    ],
  });

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 1);
  assert.equal(applied.unverifiedCandidateCount, 0);
  assert.equal(applied.repairedCount, 1);
  assert.equal(applied.mutated, true);
});

test("repairJunctionWorkoutHeartRateZones refuses to repair an id that also appears on a schema-invalid revision", async () => {
  // If the actual latest revision under an id is rejected by today's schema,
  // a stale older revision would shadow it. Repairing then would append over
  // unknown current state. We must refuse rather than guess.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-id-shadow");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const garminResourceId = "workouts-garmin-id-shadow";
  const garminWorkoutId = "garmin-id-shadow-workout-1";

  const imported = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: garminResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: garminWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "garmin" },
            id: garminWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
    ],
  });

  const eventId = imported.events[0]?.id;
  assert.ok(typeof eventId === "string");

  const shardPath = imported.eventShardPaths[0];
  assert.ok(typeof shardPath === "string");
  const shardAbsolute = path.join(vaultRoot, shardPath as string);
  // Append a schema-invalid row under the same id (e.g. a future schema field
  // that today's schema rejects). The repair must refuse this id entirely.
  await fs.appendFile(
    shardAbsolute,
    `${JSON.stringify({ id: eventId, kind: "activity_session", "from-the-future": true })}\n`,
  );

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 0);
  assert.equal(applied.repairedCount, 0);
  assert.equal(applied.mutated, false);
});

test("repairJunctionWorkoutHeartRateZones repairs connection-backed workouts whose raw row has no inline provider", async () => {
  // Junction's raw sanitizer strips connectionId/sourceId without
  // re-injecting the resolved sourceProviderSlug, so legacy
  // connection-resolved workouts can land in raw artifacts with no inline
  // provider. The candidate event still carries the correct sourceApp from
  // the importer's connection lookup. When the providerless raw row's
  // durations bind exactly to the stored durations and no same-id row
  // contradicts, the repair must still run.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-connection-backed");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const resourceId = "workouts-garmin-connection-backed";
  const sourceWorkoutId = "garmin-connection-backed-workout-1";

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            // No source.provider / provider field — simulates a raw row that
            // came from a connection-resolved import and lost the linkage
            // keys during sanitization.
            id: sourceWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
    ],
  });

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 1);
  assert.equal(applied.repairedCount, 1);
  assert.equal(applied.mutated, true);
});

test("repairJunctionWorkoutHeartRateZones refuses when a contradicting same-provider primitive row coexists with a matching providerless row", async () => {
  // A same-id, same-provider primitive numeric row whose durations do not
  // match the stored row is a contradiction — the artifact carries an
  // alternate snapshot of the workout. The providerless fallback must not
  // override that contradiction with a coincidentally-matching providerless
  // duplicate.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-contradiction");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const resourceId = "workouts-garmin-contradiction";
  const sourceWorkoutId = "garmin-contradiction-workout-1";

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            // Same provider, same id, primitive — but durations are wrong
            // (does not match the stored 10..60 minutes after seconds/60).
            source: { provider: "garmin" },
            id: sourceWorkoutId,
            hr_zones: [60, 120, 180, 240, 300, 360],
          },
          {
            // Providerless duplicate that happens to match the stored
            // durations. Without contradiction handling, this would falsely
            // verify the candidate via the connection-backed fallback.
            id: sourceWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
    ],
  });

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 0);
  assert.equal(applied.unverifiedCandidateCount, 1);
  assert.equal(applied.repairedCount, 0);
  assert.equal(applied.mutated, false);
});

test("repairJunctionWorkoutHeartRateZones refuses when a same-id raw duplicate carries object-shaped zones", async () => {
  // Even if a same-id+same-provider primitive numeric raw row matches the
  // stored durations exactly, a duplicate same-id row whose hr_zones are
  // object-shaped breaks the proof: we can no longer tell legacy primitive
  // from explicit object zones for this id, so the repair must refuse.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-same-id-ambiguity");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const resourceId = "workouts-garmin-same-id-ambiguity";
  const sourceWorkoutId = "garmin-same-id-ambiguity-workout-1";

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "garmin" },
            id: sourceWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
          {
            source: { provider: "garmin" },
            id: sourceWorkoutId,
            hr_zones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
              zone: index + 1,
              duration: durationMinutes * 60,
            })),
          },
        ],
      },
    ],
  });

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 0);
  assert.equal(applied.unverifiedCandidateCount, 1);
  assert.equal(applied.repairedCount, 0);
  assert.equal(applied.mutated, false);
});

test("repairJunctionWorkoutHeartRateZones refuses raw evidence whose durations do not match the stored row", async () => {
  // Raw evidence with the right shape but the wrong durations does not prove
  // this stored row came from the legacy numeric branch. It could be a stale
  // same-id raw payload or a manually corrected stored row that coincidentally
  // retained 1..6 zone indexes. Either way, repairing would corrupt data.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-duration-mismatch");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const garminResourceId = "workouts-garmin-duration-mismatch";
  const garminWorkoutId = "garmin-duration-mismatch-workout-1";

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: garminResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: garminWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "garmin" },
            id: garminWorkoutId,
            // Same id, same provider, but durations that, after seconds/60,
            // do not match the stored 10,20,30,40,50,60 minutes.
            hr_zones: [60, 120, 180, 240, 300, 360],
          },
        ],
      },
    ],
  });

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 0);
  assert.equal(applied.unverifiedCandidateCount, 1);
  assert.equal(applied.repairedCount, 0);
  assert.equal(applied.mutated, false);
});

test("repairJunctionWorkoutHeartRateZones refuses an id whose latest revision is a different event kind", async () => {
  // If the actual latest revision under an event id is a non-activity kind
  // (tombstone, type change, hand-edited row), selecting the older
  // activity_session row and appending another revision to it would violate
  // the event-spine kind invariant and resurrect stale workout state.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-cross-kind");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const garminResourceId = "workouts-garmin-cross-kind";
  const garminWorkoutId = "garmin-cross-kind-workout-1";

  const imported = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: garminResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: garminWorkoutId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "garmin" },
            id: garminWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
    ],
  });

  const eventId = imported.events[0]?.id;
  assert.ok(typeof eventId === "string");
  const original = imported.events[0];
  assert.ok(original);
  const originalRevision = original.lifecycle?.revision ?? 1;
  const shardPath = imported.eventShardPaths[0];
  assert.ok(typeof shardPath === "string");
  const shardAbsolute = path.join(vaultRoot, shardPath as string);

  // Append a later schema-valid revision under the same id but a different
  // kind. After this, the spine's latest entry for the id is non-activity.
  const supersedingRow = {
    id: eventId,
    kind: "note",
    occurredAt: "2026-06-04T10:00:00.000Z",
    recordedAt: "2026-06-04T10:00:00.000Z",
    source: "self",
    title: "renamed",
    fields: { body: "kind change supersedes the workout row" },
    lifecycle: { revision: originalRevision + 1 },
  };
  await fs.appendFile(shardAbsolute, `${JSON.stringify(supersedingRow)}\n`);

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 0);
  assert.equal(applied.repairedCount, 0);
  assert.equal(applied.mutated, false);
});

test("repairJunctionWorkoutHeartRateZones refuses when any referenced evidence part is unreadable", async () => {
  // The joint cross-evidence invariant only holds if every referenced part is
  // actually inspected. An unreadable part could carry a same-id contradiction
  // we'd never see, so fail closed.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-unreadable-evidence");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const garminResourceId = "workouts-garmin-missing-rawref";
  const garminWorkoutId = "garmin-missing-rawref-workout-1";

  const imported = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({
          resourceId: garminResourceId,
          resourceType: "junction-garmin-workouts",
          sourceApp: "garmin",
          sourceWorkoutId: garminWorkoutId,
          heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
            zone: index + 1,
            durationMinutes,
          })),
        }),
        evidenceRoles: ["junction-summary-workouts-present", "junction-summary-workouts-absent"],
      },
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts-present",
        fileName: "junction-summary-workouts-present.json",
        content: [
          {
            source: { provider: "garmin" },
            id: garminWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
      {
        role: "junction-summary-workouts-absent",
        fileName: "junction-summary-workouts-absent.json",
        content: [],
      },
    ],
  });

  assert.ok(imported.applied);
  const ingest = await readRequiredIntegrationIngest(vaultRoot, imported.ingestId);
  const corruptContent = "not-json";
  const corruptedIngest = {
    ...ingest,
    parts: ingest.parts.map((part) => part.role === "junction-summary-workouts-absent"
      ? {
          ...part,
          content: corruptContent,
          byteSize: Buffer.byteLength(corruptContent, "utf8"),
          sha256: createHash("sha256").update(corruptContent, "utf8").digest("hex"),
        }
      : part),
  };
  await fs.writeFile(
    path.join(vaultRoot, imported.ingestShardPath),
    `${JSON.stringify(corruptedIngest)}\n`,
  );

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 0);
  assert.equal(applied.unverifiedCandidateCount, 1);
  assert.equal(applied.repairedCount, 0);
  assert.equal(applied.mutated, false);
});

test("repairJunctionWorkoutHeartRateZones decides across all rawRefs jointly", async () => {
  // A workout's rawRefs can point at multiple artifacts. A matching row in
  // one artifact must not mask a contradicting same-id row in another:
  // contradictions disqualify globally, and the providerless uniqueness rule
  // must apply over the union of evidence.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-multi-rawref");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const garminResourceId = "workouts-garmin-multi-rawref";
  const garminWorkoutId = "garmin-multi-rawref-workout-1";

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({
          resourceId: garminResourceId,
          resourceType: "junction-garmin-workouts",
          sourceApp: "garmin",
          sourceWorkoutId: garminWorkoutId,
          heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
            zone: index + 1,
            durationMinutes,
          })),
        }),
        evidenceRoles: ["junction-summary-workouts-a", "junction-summary-workouts-b"],
      },
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts-a",
        fileName: "junction-summary-workouts-a.json",
        content: [
          {
            source: { provider: "garmin" },
            id: garminWorkoutId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
      {
        role: "junction-summary-workouts-b",
        fileName: "junction-summary-workouts-b.json",
        content: [
          {
            // Same provider, same id, primitive — but durations don't match
            // the stored row. Without joint cross-rawRef analysis the matching
            // artifact above would mask this contradiction and the repair
            // would falsely run.
            source: { provider: "garmin" },
            id: garminWorkoutId,
            hr_zones: [60, 120, 180, 240, 300, 360],
          },
        ],
      },
    ],
  });

  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(applied.candidateCount, 0);
  assert.equal(applied.unverifiedCandidateCount, 1);
  assert.equal(applied.repairedCount, 0);
  assert.equal(applied.mutated, false);
});

test("repairJunctionWorkoutHeartRateZones refuses raw evidence from a different provider row", async () => {
  // Junction-summary-workouts artifacts can mix providers, so a Garmin
  // candidate's rawRef can point at a payload that also contains a non-Garmin
  // workout whose id collides with `sourceWorkoutId`. Without the provider
  // gate the repair would treat that foreign primitive-numeric zone array as
  // proof and rewrite the legitimate explicit Garmin record.
  const vaultRoot = await makeTempDirectory("murph-hr-zone-repair-cross-provider");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const collidingId = "collision-workout-id";
  const garminResourceId = "workouts-garmin-collision";

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        resourceId: garminResourceId,
        resourceType: "junction-garmin-workouts",
        sourceApp: "garmin",
        sourceWorkoutId: collidingId,
        heartRateZones: [10, 20, 30, 40, 50, 60].map((durationMinutes, index) => ({
          zone: index + 1,
          durationMinutes,
        })),
      }),
    ],
    evidenceParts: [
      {
        role: "junction-summary-workouts",
        fileName: "junction-summary-workouts.json",
        content: [
          {
            source: { provider: "whoop" },
            id: collidingId,
            hr_zones: [600, 1200, 1800, 2400, 3000, 3600],
          },
        ],
      },
    ],
  });

  const dryRun = await repairJunctionWorkoutHeartRateZones({ vaultRoot });
  const applied = await repairJunctionWorkoutHeartRateZones({
    vaultRoot,
    apply: true,
    now: new Date("2026-06-04T12:00:00.000Z"),
  });

  assert.equal(dryRun.candidateCount, 0);
  assert.equal(dryRun.unverifiedCandidateCount, 1);
  assert.equal(dryRun.repairedCount, 0);
  assert.equal(applied.candidateCount, 0);
  assert.equal(applied.unverifiedCandidateCount, 1);
  assert.equal(applied.repairedCount, 0);
  assert.equal(applied.mutated, false);
});

test("importDeviceBatch keeps deterministic content identity for events without externalRef", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-no-externalref");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (accountId: string) => ({
    vaultRoot,
    provider: "junction",
    accountId,
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        kind: "note",
        occurredAt: "2026-06-03T19:55:00.000Z",
        recordedAt: "2026-06-03T20:30:00.000Z",
        note: "no external ref",
        evidenceRoles: ["junction-note-without-external-ref"],
      },
    ],
    evidenceParts: [{
      role: "junction-note-without-external-ref",
      fileName: "junction-note-without-external-ref.json",
      content: { note: "no external ref" },
    }],
  });

  const first = await importDeviceBatch(buildInput("jxn_acct_same"));
  const beforeSecond = await snapshotVaultFiles(vaultRoot);
  const second = await importDeviceBatch(buildInput("jxn_acct_same"));

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(eventRecords.length, 1);
  assert.equal(second.applied, false);
  assert.equal(second.ingestId, null);
  assert.equal(second.auditPath, null);
  assert.equal(second.events[0]?.id, first.events[0]?.id);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeSecond);
  const firstEvent = first.events[0];
  assert.ok(firstEvent);
  await upsertEvent({
    vaultRoot,
    payload: { ...firstEvent, note: "current user edit", source: "manual" },
  });
  const eventPath = first.eventShardPaths[0] as string;
  const beforeEditedReplay = await fs.readFile(path.join(vaultRoot, eventPath));

  const editedReplay = await importDeviceBatch(buildInput("jxn_acct_same"));

  assert.equal(editedReplay.applied, false);
  assert.deepEqual(editedReplay.events, []);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, eventPath)), beforeEditedReplay);
});

test("importDeviceBatch collapses in-batch duplicates sharing one externalRef", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-inbatch-dedupe");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent(), buildJunctionStyleWorkoutEvent()],
  });

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(eventRecords.length, 1);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0]?.id, result.events[1]?.id);
});

test("importDeviceBatch chains repeated updates into successive spine revisions and reads collapse to latest", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-externalref-revision-chain");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const importAt = (importedAt: string, durationMinutes: number) =>
    importDeviceBatch({
      vaultRoot,
      provider: "junction",
      accountId: "jxn_acct_stable",
      importedAt,
      events: [
        buildJunctionStyleWorkoutEvent({
          recordedAt: importedAt,
          durationMinutes,
        }),
      ],
    });

  const first = await importAt("2026-06-03T21:00:00.000Z", 34);
  const second = await importAt("2026-06-04T21:00:00.000Z", 36);
  const third = await importAt("2026-06-05T21:00:00.000Z", 38);

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(eventRecords.length, 3);
  assert.equal(second.events[0]?.id, first.events[0]?.id);
  assert.equal(third.events[0]?.id, first.events[0]?.id);
  assert.equal(second.events[0]?.lifecycle?.revision, 2);
  assert.equal(third.events[0]?.lifecycle?.revision, 3);
  assert.deepEqual(
    eventRecords.map((record) => record.lifecycle?.revision ?? 1),
    [1, 2, 3],
  );

  const latest = await findEventByExternalRef({
    vaultRoot,
    system: "junction",
    resourceType: "junction-whoop-v2-workouts",
    resourceId: "workouts-393350f4b34bad8c",
    facet: "session",
  });

  assert.equal(latest?.id, first.events[0]?.id);
  assert.equal(latest?.lifecycle?.revision, 3);
  assert.equal((latest as { durationMinutes?: number } | null)?.durationMinutes, 38);
});

test("importDeviceBatch does not dedupe distinct facets sharing one externalRef resourceId", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-externalref-facets");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildFacetObservation = (facet: string, value: number) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-03T07:30:00.000Z",
    recordedAt: "2026-06-03T07:30:00.000Z",
    title: `Junction ${facet}`,
    externalRef: {
      system: "junction",
      resourceType: "junction-whoop-v2-recovery",
      resourceId: "recovery-1",
      facet,
    },
    fields: {
      metric: facet,
      value,
      unit: "%",
    },
  });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildFacetObservation("recovery-score", 67),
      buildFacetObservation("skin-temp-deviation", 3),
    ],
  });
  const second = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      buildFacetObservation("recovery-score", 67),
      buildFacetObservation("skin-temp-deviation", 4),
    ],
  });

  assert.ok(second.applied);

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(first.events.length, 2);
  assert.notEqual(first.events[0]?.id, first.events[1]?.id);
  // recovery-score is an unchanged duplicate, skin-temp-deviation is a revision.
  assert.equal(eventRecords.length, 3);
  assert.equal(second.events[0]?.id, first.events[0]?.id);
  assert.equal(second.events[0]?.lifecycle?.revision ?? 1, 1);
  assert.equal(second.events[1]?.id, first.events[1]?.id);
  assert.equal(second.events[1]?.lifecycle?.revision, 2);
  assert.equal(
    eventRecords.filter((record) => record.externalRef?.facet === "recovery-score").length,
    1,
  );
  assert.equal(
    eventRecords.filter((record) => record.externalRef?.facet === "skin-temp-deviation").length,
    2,
  );
});

test("importDeviceBatch handles mixed duplicate, changed, and new events in one batch", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-externalref-mixed");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workouts-aaa" }),
        evidenceRoles: ["workout-aaa"],
      },
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workouts-bbb" }),
        evidenceRoles: ["workout-bbb"],
      },
    ],
    evidenceParts: [
      { role: "workout-aaa", fileName: "workout-aaa.json", content: { revision: 1 } },
      { role: "workout-bbb", fileName: "workout-bbb.json", content: { revision: 1 } },
    ],
  });
  const second = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      // Unchanged duplicate of workouts-aaa.
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workouts-aaa" }),
        evidenceRoles: ["workout-aaa"],
      },
      // Changed content for workouts-bbb.
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workouts-bbb", durationMinutes: 41 }),
        evidenceRoles: ["workout-bbb"],
      },
      // Brand-new provider record.
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workouts-ccc" }),
        evidenceRoles: ["workout-ccc"],
      },
    ],
    evidenceParts: [
      { role: "workout-aaa", fileName: "workout-aaa.json", content: { revision: 1 } },
      { role: "workout-bbb", fileName: "workout-bbb.json", content: { revision: 2 } },
      { role: "workout-ccc", fileName: "workout-ccc.json", content: { revision: 1 } },
    ],
  });

  assert.ok(second.applied);

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];
  const auditRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: second.auditPath,
  })) as AuditRecord[];

  // 2 originals + 1 revision of workouts-bbb + 1 new workouts-ccc.
  assert.equal(eventRecords.length, 4);
  assert.equal(second.events.length, 3);
  assert.equal(second.events[0]?.id, first.events[0]?.id);
  assert.equal(second.events[0]?.lifecycle?.revision ?? 1, 1);
  assert.equal(second.events[1]?.id, first.events[1]?.id);
  assert.equal(second.events[1]?.lifecycle?.revision, 2);
  assert.notEqual(second.events[2]?.id, first.events[0]?.id);
  assert.notEqual(second.events[2]?.id, first.events[1]?.id);
  assert.equal(second.events[2]?.lifecycle, undefined);
  const secondIngest = await readRequiredIntegrationIngest(vaultRoot, second.ingestId);
  assert.deepEqual(
    secondIngest.parts.map((part) => part.role),
    ["workout-bbb", "workout-ccc"],
  );
  assert.deepEqual(
    secondIngest.outputs.events.map((output) => output.id).sort(),
    second.events.map((event) => event.id).sort(),
  );

  const mixedSummary = auditRecords.find(
    (record) =>
      record.action === "device_import" &&
      record.summary.includes("duplicate event(s) skipped by externalRef"),
  );
  assert.ok(mixedSummary, "expected mixed-batch audit summary to surface dedupe counts");
  assert.ok(mixedSummary.summary.includes("1 duplicate event(s) skipped by externalRef"));
  assert.ok(mixedSummary.summary.includes("1 event(s) updated in place by externalRef"));
});

test("importDeviceBatch does not resurrect a deleted event from an identical re-import", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-externalref-deleted-replay");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = () => ({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });

  const first = await importDeviceBatch(buildInput());
  const eventId = first.events[0]?.id;
  assert.ok(eventId);
  await deleteEvent({ vaultRoot, eventId });

  // Overlapping trailing-window polls re-send the identical provider payload.
  await importDeviceBatch(buildInput());

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  // Append-only ledger holds the original plus its tombstone, and nothing else.
  assert.equal(eventRecords.length, 2);
  assert.equal(eventRecords[1]?.id, eventId);
  assert.equal(eventRecords[1]?.lifecycle?.state, "deleted");

  const latest = await findEventByExternalRef({
    vaultRoot,
    system: "junction",
    resourceType: "junction-whoop-v2-workouts",
    resourceId: "workouts-393350f4b34bad8c",
    facet: "session",
  });
  assert.equal(latest, null);
});

test("importDeviceBatch appends a new event when changed content arrives after a deletion", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-externalref-deleted-changed");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const originalId = first.events[0]?.id;
  assert.ok(originalId);
  await deleteEvent({ vaultRoot, eventId: originalId });

  const second = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        recordedAt: "2026-06-04T07:00:00.000Z",
        durationMinutes: 41,
      }),
    ],
  });

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  // The tombstoned spine is never reused: changed content mints a fresh event.
  assert.equal(second.events.length, 1);
  assert.notEqual(second.events[0]?.id, originalId);
  assert.equal(second.events[0]?.lifecycle, undefined);
  assert.equal(eventRecords.length, 3);
  assert.equal(
    eventRecords.filter((record) => record.id === originalId).length,
    2,
  );
  assert.equal(
    eventRecords.filter(
      (record) => record.id === originalId && record.lifecycle?.state === "deleted",
    ).length,
    1,
  );
  assert.equal(
    (eventRecords.find((record) => record.id === second.events[0]?.id) as
      | { durationMinutes?: number }
      | undefined)?.durationMinutes,
    41,
  );
});


test("importDeviceBatch keeps deduping against a surviving live copy after a duplicate is tombstoned", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-cleanup-survivor");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  // Survivor copy imported normally.
  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_cold_start_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const survivorId = first.events[0]?.id as string;
  const shardPath = first.eventShardPaths[0] as string;

  // Simulate the legacy pre-fix on-disk state: the same provider record also
  // exists as a second live event under a different id (accountId churn
  // minted it before dedupe existed). Write it directly as legacy shard state.
  const survivorLine = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;
  const legacyDuplicate = { ...survivorLine, id: "evt_0000000000000000000000DP20" };
  await fs.appendFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify(legacyDuplicate)}\n`,
  );

  // Cleanup tombstones the legacy duplicate and keeps the survivor live.
  await deleteEvent({ vaultRoot, eventId: "evt_0000000000000000000000DP20" });

  // The next overlapping poll re-delivers the same record. It must dedupe
  // against the live survivor; the higher-revision tombstone of the deleted
  // duplicate must not shadow it and re-mint a fresh event.
  const replay = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_cold_start_b",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });

  assert.equal(replay.events[0]?.id, survivorId);
  const found = await findEventByExternalRef({
    vaultRoot,
    system: "junction",
    resourceType: "junction-whoop-v2-workouts",
    resourceId: "workouts-393350f4b34bad8c",
    facet: "session",
  });
  assert.equal(found?.id, survivorId);

  const records = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const deletedIds = new Set(
    records
      .filter((record) => record.lifecycle?.state === "deleted")
      .map((record) => record.id),
  );
  const liveIds = new Set(
    records.map((record) => record.id).filter((id) => !deletedIds.has(id)),
  );
  assert.equal(records.length, 3, "expected survivor + legacy duplicate + tombstone only");
  assert.deepEqual([...liveIds], [survivorId]);
});

test("importDeviceBatch supersedes in place when the provider bumps externalRef.version", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-version-bump");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (version: string, value: number, importedAt: string) => ({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt,
    events: [
      {
        kind: "observation",
        occurredAt: "2026-06-03T07:30:00.000Z",
        recordedAt: "2026-06-03T07:30:00.000Z",
        title: "WHOOP recovery score",
        externalRef: {
          system: "whoop",
          resourceType: "recovery",
          resourceId: "sleep-1",
          version,
          facet: "recovery-score",
        },
        fields: {
          metric: "recovery-score",
          value,
          unit: "%",
        },
      },
    ],
  });

  // WHOOP stamps externalRef.version from the record's mutable updated_at, so
  // a provider-side rescore arrives with a new version. It must supersede the
  // existing event, not mint a second live event.
  const first = await importDeviceBatch(buildInput("2026-06-03T10:00:00.000Z", 67, "2026-06-03T11:00:00.000Z"));
  const rescored = await importDeviceBatch(buildInput("2026-06-04T09:00:00.000Z", 70, "2026-06-04T11:00:00.000Z"));
  const replay = await importDeviceBatch(buildInput("2026-06-04T09:00:00.000Z", 70, "2026-06-05T11:00:00.000Z"));
  const rolledBack = await importDeviceBatch(
    buildInput("2026-06-06T09:00:00.000Z", 67, "2026-06-06T11:00:00.000Z"),
  );

  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(rescored.events[0]?.id, first.events[0]?.id);
  assert.equal(rescored.events[0]?.lifecycle?.revision, 2);
  assert.equal(replay.events[0]?.id, first.events[0]?.id);
  assert.equal(rolledBack.events[0]?.id, first.events[0]?.id);
  assert.equal(rolledBack.events[0]?.lifecycle?.revision, 3);
  assert.equal(eventObservationValue(rolledBack.events[0]), 67);
  assert.equal(records.length, 3, "expected original + two supersedes, no duplicate live events");
  assert.equal(new Set(records.map((record) => record.id)).size, 1);
});

test("importDeviceBatch enriches legacy WHOOP sleep types without aborting a mixed snapshot", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-whoop-sleep-type-enrichment");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildSleepEvent = ({
    resourceId,
    occurredAt,
    endAt,
    durationMinutes,
    title,
    sleepType,
  }: {
    resourceId: string;
    occurredAt: string;
    endAt: string;
    durationMinutes: number;
    title: "WHOOP sleep" | "WHOOP nap";
    sleepType?: "main_sleep" | "nap";
  }) => ({
    kind: "sleep_session" as const,
    occurredAt,
    recordedAt: endAt,
    dayKey: "2026-06-03",
    title,
    externalRef: {
      system: "whoop",
      resourceType: "sleep",
      resourceId,
      version: "2026-06-03T10:00:00.000Z",
    },
    fields: {
      startAt: occurredAt,
      endAt,
      durationMinutes,
      ...(sleepType === undefined ? {} : { sleepType }),
    },
  });
  const mainSleep = {
    resourceId: "legacy-main-sleep",
    occurredAt: "2026-06-02T22:00:00.000Z",
    endAt: "2026-06-03T06:00:00.000Z",
    durationMinutes: 480,
    title: "WHOOP sleep" as const,
  };
  const nap = {
    resourceId: "legacy-nap",
    occurredAt: "2026-06-03T14:00:00.000Z",
    endAt: "2026-06-03T14:30:00.000Z",
    durationMinutes: 30,
    title: "WHOOP nap" as const,
  };
  const deletedNap = {
    resourceId: "legacy-deleted-nap",
    occurredAt: "2026-06-03T15:00:00.000Z",
    endAt: "2026-06-03T15:30:00.000Z",
    durationMinutes: 30,
    title: "WHOOP nap" as const,
  };
  const editedNap = {
    resourceId: "legacy-edited-nap",
    occurredAt: "2026-06-03T16:00:00.000Z",
    endAt: "2026-06-03T16:30:00.000Z",
    durationMinutes: 30,
    title: "WHOOP nap" as const,
  };

  const legacy = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-06-03T11:00:00.000Z",
    events: [
      buildSleepEvent(mainSleep),
      buildSleepEvent(nap),
      buildSleepEvent(deletedNap),
      buildSleepEvent(editedNap),
    ],
  });
  const deletedEventId = legacy.events[2]?.id;
  const editedEventId = legacy.events[3]?.id;
  assert.ok(deletedEventId);
  assert.ok(editedEventId);
  await deleteEvent({ vaultRoot, eventId: deletedEventId });
  const eventShardPath = legacy.eventShardPaths[0] as string;
  const editedBase = ((await readJsonlRecords({ vaultRoot, relativePath: eventShardPath })) as EventRecord[])
    .find((record) => record.id === editedEventId && (record.lifecycle?.revision ?? 1) === 1);
  assert.ok(editedBase);
  const editedByUser = {
    ...editedBase,
    source: "manual",
    note: "keep this user context",
    lifecycle: { revision: 2 },
  } satisfies EventRecord;
  await fs.appendFile(path.join(vaultRoot, eventShardPath), `${JSON.stringify(editedByUser)}\n`);

  const enrichedSnapshotEvents = [
    buildSleepEvent({ ...mainSleep, sleepType: "main_sleep" }),
    buildSleepEvent({ ...nap, sleepType: "nap" }),
    buildSleepEvent({ ...deletedNap, sleepType: "nap" }),
    buildSleepEvent({ ...editedNap, sleepType: "nap" }),
    {
      kind: "observation" as const,
      occurredAt: "2026-06-03T07:30:00.000Z",
      recordedAt: "2026-06-03T07:30:00.000Z",
      title: "WHOOP recovery score",
      externalRef: {
        system: "whoop",
        resourceType: "recovery",
        resourceId: "mixed-snapshot-recovery",
        version: "2026-06-03T10:00:00.000Z",
        facet: "recovery-score",
      },
      fields: {
        metric: "recovery-score",
        value: 67,
        unit: "%",
      },
    },
  ];

  const enriched = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-06-04T11:00:00.000Z",
    events: enrichedSnapshotEvents,
  });

  assert.ok(enriched.applied);
  const enrichedMainSleep = enriched.events.find(
    (event) => event.externalRef?.resourceId === mainSleep.resourceId,
  );
  const enrichedNap = enriched.events.find(
    (event) => event.externalRef?.resourceId === nap.resourceId,
  );
  assert.equal(enrichedMainSleep?.id, legacy.events[0]?.id);
  assert.equal(enrichedMainSleep?.lifecycle?.revision, 2);
  assert.equal(
    enrichedMainSleep?.kind === "sleep_session" ? enrichedMainSleep.sleepType : undefined,
    "main_sleep",
  );
  assert.equal(enrichedNap?.id, legacy.events[1]?.id);
  assert.equal(enrichedNap?.lifecycle?.revision, 2);
  assert.equal(
    enrichedNap?.kind === "sleep_session" ? enrichedNap.sleepType : undefined,
    "nap",
  );
  assert.ok(
    enriched.events.some((event) => event.externalRef?.resourceId === "mixed-snapshot-recovery"),
  );

  const afterEnrichment = await fs.readFile(path.join(vaultRoot, eventShardPath));
  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  })) as EventRecord[];
  assert.equal(
    records.length,
    9,
    "expected four legacy rows, two user-state revisions, two enrichments, and the new resource",
  );
  assert.equal(await findEventByExternalRef({
    vaultRoot,
    system: "whoop",
    resourceType: "sleep",
    resourceId: deletedNap.resourceId,
  }), null);
  const preservedUserEdit = await findEventByExternalRef({
    vaultRoot,
    system: "whoop",
    resourceType: "sleep",
    resourceId: editedNap.resourceId,
  });
  assert.equal(preservedUserEdit?.id, editedEventId);
  assert.equal(preservedUserEdit?.note, "keep this user context");
  assert.equal(
    preservedUserEdit?.kind === "sleep_session" ? preservedUserEdit.sleepType : undefined,
    undefined,
  );

  const replay = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-06-05T11:00:00.000Z",
    events: enrichedSnapshotEvents,
  });
  assert.equal(
    replay.events.find((event) => event.externalRef?.resourceId === mainSleep.resourceId)?.id,
    legacy.events[0]?.id,
  );
  assert.equal(
    replay.events.find((event) => event.externalRef?.resourceId === nap.resourceId)?.id,
    legacy.events[1]?.id,
  );
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, eventShardPath)), afterEnrichment);
});

test("importDeviceBatch rejects sleep-type enrichment with other same-revision changes atomically", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-version-conflict");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = ({
    endAt,
    durationMinutes,
    sleepType,
    importedAt,
    includeUnrelated = false,
  }: {
    endAt: string;
    durationMinutes: number;
    sleepType?: "main_sleep";
    importedAt: string;
    includeUnrelated?: boolean;
  }) => ({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt,
    events: [
      {
        kind: "sleep_session" as const,
        occurredAt: "2026-06-02T22:00:00.000Z",
        recordedAt: endAt,
        dayKey: "2026-06-03",
        title: "WHOOP sleep",
        externalRef: {
          system: "whoop",
          resourceType: "sleep",
          resourceId: "sleep-version-conflict",
          version: "2026-06-03T10:00:00.000Z",
        },
        fields: {
          startAt: "2026-06-02T22:00:00.000Z",
          endAt,
          durationMinutes,
          ...(sleepType === undefined ? {} : { sleepType }),
        },
      },
      ...(includeUnrelated ? [{
        kind: "observation" as const,
        occurredAt: "2026-06-03T08:00:00.000Z",
        recordedAt: "2026-06-03T08:00:00.000Z",
        title: "WHOOP strain score",
        externalRef: {
          system: "whoop",
          resourceType: "cycle",
          resourceId: "unrelated-conflict-batch-resource",
          version: "2026-06-03T10:00:00.000Z",
          facet: "strain-score",
        },
        fields: {
          metric: "strain-score",
          value: 12.4,
          unit: "score",
        },
      }] : []),
    ],
  });
  await importDeviceBatch(buildInput({
    endAt: "2026-06-03T06:00:00.000Z",
    durationMinutes: 480,
    importedAt: "2026-06-03T11:00:00.000Z",
  }));
  const beforeConflict = await snapshotVaultFiles(vaultRoot);

  await assert.rejects(
    importDeviceBatch(buildInput({
      endAt: "2026-06-03T05:30:00.000Z",
      durationMinutes: 450,
      sleepType: "main_sleep",
      importedAt: "2026-06-04T11:00:00.000Z",
      includeUnrelated: true,
    })),
    (error) => error instanceof VaultError && error.code === "EVENT_SOURCE_REVISION_CONFLICT",
  );

  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeConflict);
});

test("importDeviceBatch reports each immediate Junction sparse cross-day transition", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-junction-cross-day-chain");
  await initializeVault({ vaultRoot, createdAt: "2026-04-01T00:00:00.000Z" });
  const buildEvent = (dayKey: string, version: string) => ({
    kind: "measurement" as const,
    occurredAt: `${dayKey}T08:00:00.000Z`,
    recordedAt: `${dayKey}T08:00:00.000Z`,
    dayKey,
    title: "Junction water intake",
    externalRef: {
      system: "junction",
      resourceType: "junction-garmin-water",
      resourceId: "water-cross-day-chain",
      facet: "interval",
      version,
    },
    dataOrigin: {
      version: 1 as const,
      aggregatorProvider: "junction",
      sourceProviderSlug: "garmin",
      sourceType: "watch",
      sourceInstanceId: "garmin-watch-1",
      normalizerVersion: "junction-timeseries.v1",
    },
    fields: {
      measurements: [{ metric: "water", unit: "ml", value: 250 }],
    },
  });

  const v1 = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-04-04T09:00:00.000Z",
    events: [buildEvent("2026-04-01", "2026-04-04T08:00:00.000Z")],
  });
  assert.deepEqual(v1.affectedEventDayKeys, ["2026-04-01"]);
  assert.deepEqual(v1.affectedSparseCalendarTargets, [{
    dayKey: "2026-04-01",
    sourceInstanceId: "garmin-watch-1",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
  }]);

  const v2 = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-04-05T09:00:00.000Z",
    events: [buildEvent("2026-04-02", "2026-04-05T08:00:00.000Z")],
  });
  assert.deepEqual(v2.affectedEventDayKeys, ["2026-04-01", "2026-04-02"]);
  assert.deepEqual(v2.affectedSparseCalendarTargets?.map((target) => target.dayKey), [
    "2026-04-01",
    "2026-04-02",
  ]);

  const v3 = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-04-06T09:00:00.000Z",
    events: [buildEvent("2026-04-03", "2026-04-06T08:00:00.000Z")],
  });
  assert.deepEqual(v3.affectedEventDayKeys, ["2026-04-02", "2026-04-03"]);
  assert.deepEqual(v3.affectedSparseCalendarTargets?.map((target) => target.dayKey), [
    "2026-04-02",
    "2026-04-03",
  ]);

  const delayedV2 = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-04-07T09:00:00.000Z",
    events: [buildEvent("2026-04-02", "2026-04-05T08:00:00.000Z")],
  });
  assert.equal(delayedV2.applied, false);
  assert.equal(
    delayedV2.affectedEventDayKeys,
    undefined,
    "A delayed stale revision cannot reconstruct older refresh work; the durable day jobs retain it.",
  );
  assert.equal(delayedV2.affectedSparseCalendarTargets, undefined);
});

test("importDeviceBatch rejects excessive Junction sparse affected-day fanout atomically", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-junction-affected-days");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });

  const buildEvents = (startAt: string, version: string) =>
    Array.from({ length: 33 }, (_, index) => {
      const occurredAt = new Date(Date.parse(startAt) + index * 24 * 60 * 60_000).toISOString();
      return {
        kind: "measurement" as const,
        occurredAt,
        recordedAt: occurredAt,
        dayKey: occurredAt.slice(0, 10),
        title: "Junction water intake",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-water",
          resourceId: `water-affected-day-${index}`,
          facet: "interval",
          version,
        },
        fields: {
          measurements: [{
            metric: "water",
            unit: "ml",
            value: index + 1,
          }],
        },
      };
    });

  const baseline = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-04-10T12:00:00.000Z",
    events: buildEvents("2026-01-01T08:00:00.000Z", "2026-04-10T10:00:00.000Z"),
  });
  assert.equal(baseline.affectedEventDayKeys?.length, 33);
  const beforeRejectedCorrection = await snapshotVaultFiles(vaultRoot);

  await assert.rejects(
    importDeviceBatch({
      vaultRoot,
      provider: "junction",
      accountId: "junction-user-1",
      importedAt: "2026-04-11T12:00:00.000Z",
      events: buildEvents("2026-03-01T08:00:00.000Z", "2026-04-11T10:00:00.000Z"),
    }),
    (error) =>
      error instanceof VaultError
      && error.code === "DEVICE_IMPORT_AFFECTED_DAY_LIMIT_EXCEEDED",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedCorrection);
});

test("importDeviceBatch keeps Junction sleep summary stages over later cycle fallback facts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-junction-summary-over-cycle");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (normalizerVersion: string, value: number, importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt,
    events: [
      {
        kind: "observation",
        occurredAt: "2026-06-03T07:30:00.000Z",
        recordedAt: "2026-06-03T07:30:00.000Z",
        title: "Junction deep sleep",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-sleep",
          resourceId: "sleep-stage-window-1",
          facet: "sleep-deep-minutes",
        },
        dataOrigin: {
          version: 1 as const,
          aggregatorProvider: "junction",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          sourceInstanceId: "garmin-watch-1",
          normalizerVersion,
        },
        fields: {
          metric: "sleep-deep-minutes",
          observationGrain: "summary",
          value,
          unit: "minutes",
        },
      },
    ],
  });

  const summary = await importDeviceBatch(
    buildInput("junction-sleep-stage-summary.v1", 90, "2026-06-03T11:00:00.000Z"),
  );
  const fallback = await importDeviceBatch(
    buildInput("junction-sleep-stage-cycle-fallback.v1", 75, "2026-06-03T11:05:00.000Z"),
  );
  const summaryRescore = await importDeviceBatch(
    buildInput("junction-sleep-stage-summary.v1", 92, "2026-06-03T11:10:00.000Z"),
  );

  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: summary.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.deepEqual(fallback.events, []);
  assert.equal(summaryRescore.events[0]?.id, summary.events[0]?.id);
  assert.equal(eventObservationValue(summaryRescore.events[0]), 92);
  assert.equal(records.length, 2, "expected original summary + one summary rescore; fallback should not append");
  assert.deepEqual(records.map(eventObservationValue), [90, 92]);
  assert.deepEqual(records.map((record) => record.externalRef?.version), [undefined, undefined]);
});

test("importDeviceBatch lets Junction sleep summary stages supersede prior cycle fallback facts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-junction-summary-upgrade");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (normalizerVersion: string, value: number, importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt,
    events: [
      {
        kind: "observation",
        occurredAt: "2026-06-03T07:30:00.000Z",
        recordedAt: "2026-06-03T07:30:00.000Z",
        title: "Junction deep sleep",
        externalRef: {
          system: "junction",
          resourceType: "junction-garmin-sleep",
          resourceId: "sleep-stage-window-1",
          facet: "sleep-deep-minutes",
        },
        dataOrigin: {
          version: 1 as const,
          aggregatorProvider: "junction",
          sourceProviderSlug: "garmin",
          sourceType: "watch",
          sourceInstanceId: "garmin-watch-1",
          normalizerVersion,
        },
        fields: {
          metric: "sleep-deep-minutes",
          observationGrain: "summary",
          value,
          unit: "minutes",
        },
      },
    ],
  });

  const fallback = await importDeviceBatch(
    buildInput("junction-sleep-stage-cycle-fallback.v1", 75, "2026-06-03T11:00:00.000Z"),
  );
  const summary = await importDeviceBatch(
    buildInput("junction-sleep-stage-summary.v1", 90, "2026-06-03T11:05:00.000Z"),
  );

  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: fallback.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(summary.events[0]?.id, fallback.events[0]?.id);
  assert.equal(eventObservationValue(summary.events[0]), 90);
  assert.equal(records.length, 2, "expected fallback + summary supersede");
  assert.deepEqual(records.map(eventObservationValue), [75, 90]);
  assert.deepEqual(records.map((record) => record.externalRef?.version), [undefined, undefined]);
});

test("importDeviceBatch preserves explicit device dayKey without vault timezone backfill", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-explicit-day-no-timezone");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-06-01T12:00:00.000Z",
    timezone: "America/New_York",
  });

  const buildInput = (importedAt: string) => ({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt,
    events: [
      {
        kind: "observation",
        occurredAt: "2026-06-25T03:00:00.000Z",
        recordedAt: "2026-06-25T03:00:00.000Z",
        dayKey: "2026-06-24",
        title: "Junction light sleep",
        externalRef: {
          system: "junction",
          resourceType: "junction-whoop-sleep",
          resourceId: "sleep-stage-window-1",
          facet: "sleep-light-minutes",
        },
        fields: {
          metric: "sleep-light-minutes",
          observationGrain: "summary",
          value: 30,
          unit: "minutes",
        },
      },
    ],
  });

  const initial = await importDeviceBatch(buildInput("2026-06-25T12:00:00.000Z"));
  await updateVaultSummary({ vaultRoot, timezone: "UTC" });
  const replay = await importDeviceBatch(buildInput("2026-06-25T12:05:00.000Z"));

  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: initial.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(initial.events[0]?.timeZone, undefined);
  assert.equal(initial.events[0]?.dayKey, "2026-06-24");
  assert.equal(replay.events[0]?.id, initial.events[0]?.id);
  assert.equal(replay.events[0]?.timeZone, undefined);
  assert.equal(records.length, 1, "vault timezone changes should not rewrite explicit provider dayKey events");
});

test("importDeviceBatch keeps immutable date-only floating provider days timezone-free", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-floating-day-no-timezone");
  await initializeVault({
    vaultRoot,
    createdAt: "2026-06-01T12:00:00.000Z",
    timezone: "America/New_York",
  });

  const dateOnlyEvent = {
    kind: "observation" as const,
    occurredAt: "2026-06-25T03:00:00.000Z",
    recordedAt: "2026-06-25T03:01:00.000Z",
    dayKey: "2026-06-24",
    title: "Wearable daily summary",
    externalRef: {
      system: "wearable-provider",
      resourceType: "daily-summary",
      resourceId: "2026-06-24",
      facet: "recovery-score",
    },
    externalRefUpdatePolicy: "immutable" as const,
    dataOrigin: {
      version: 1 as const,
      aggregatorProvider: "wearable-aggregator",
      sourceProviderSlug: "wearable-provider",
      sourceType: "watch",
      observedAtRaw: "2026-06-24",
      timestampSemantics: "floating" as const,
      normalizerVersion: "daily-summary.v1",
    },
    fields: {
      metric: "recovery-score",
      observationGrain: "summary" as const,
      value: 72,
      unit: "score",
    },
  };
  const timestampedEvent = {
    ...dateOnlyEvent,
    dayKey: "2026-06-25",
    title: "Wearable timestamped observation",
    externalRef: {
      ...dateOnlyEvent.externalRef,
      resourceType: "timestamped-observation",
      resourceId: "timestamped-1",
    },
    externalRefUpdatePolicy: undefined,
    dataOrigin: {
      ...dateOnlyEvent.dataOrigin,
      observedAtRaw: "2026-06-25T03:00:00.000Z",
      timestampSemantics: "utc" as const,
      normalizerVersion: "timestamped-observation.v1",
    },
  };

  const initial = await importDeviceBatch({
    vaultRoot,
    provider: "wearable-aggregator",
    importedAt: "2026-06-25T12:00:00.000Z",
    events: [dateOnlyEvent, timestampedEvent],
  });
  const initialDateOnly = initial.events.find((event) =>
    event.externalRef?.resourceType === "daily-summary"
  );
  const initialTimestamped = initial.events.find((event) =>
    event.externalRef?.resourceType === "timestamped-observation"
  );

  assert.equal(initialDateOnly?.dayKey, "2026-06-24");
  assert.equal(initialDateOnly?.timeZone, undefined);
  assert.equal(initialTimestamped?.timeZone, "America/New_York");

  await updateVaultSummary({ vaultRoot, timezone: "UTC" });
  const replay = await importDeviceBatch({
    vaultRoot,
    provider: "wearable-aggregator",
    importedAt: "2026-06-25T12:05:00.000Z",
    events: [dateOnlyEvent],
  });
  const replayedDateOnly = replay.events[0];

  assert.equal(replayedDateOnly?.id, initialDateOnly?.id);
  assert.equal(replayedDateOnly?.dayKey, "2026-06-24");
  assert.equal(replayedDateOnly?.timeZone, undefined);

  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: initial.eventShardPaths[0] as string,
  })) as EventRecord[];
  assert.equal(
    records.filter((record) => record.externalRef?.resourceType === "daily-summary").length,
    1,
  );
});

test("importDeviceBatch migrates rescored Junction sleep summary legacy refs across day drift", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-junction-summary-day-drift");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const legacyExternalRef = {
    system: "junction",
    resourceType: "junction-garmin-sleep",
    resourceId: "legacy-summary-stage-window-2",
    facet: "sleep-deep-minutes",
  };
  const canonicalExternalRef = {
    system: "junction",
    resourceType: "junction-garmin-sleep",
    resourceId: "sleep-stage-window-2",
    facet: "sleep-deep-minutes",
  };
  const dataOrigin = {
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    sourceInstanceId: "garmin-watch-1",
    observedAtRaw: "2026-06-25T03:00:00.000Z",
    timestampSemantics: "utc" as const,
    normalizerVersion: "junction-sleep-stage-summary.v1",
  };
  const buildEvent = (input: {
    dayKey: string;
    externalRef: typeof legacyExternalRef | typeof canonicalExternalRef;
    legacyExternalRefs?: Array<typeof legacyExternalRef>;
    value: number;
  }) => ({
    kind: "observation",
    occurredAt: "2026-06-25T03:00:00.000Z",
    recordedAt: "2026-06-25T03:00:00.000Z",
    dayKey: input.dayKey,
    title: "Junction deep sleep",
    externalRef: input.externalRef,
    legacyExternalRefs: input.legacyExternalRefs,
    dataOrigin,
    fields: {
      metric: "sleep-deep-minutes",
      observationGrain: "summary",
      value: input.value,
      unit: "minutes",
    },
  });

  const legacySummary = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-06-25T11:00:00.000Z",
    events: [
      buildEvent({
        dayKey: "2026-06-25",
        externalRef: legacyExternalRef,
        value: 90,
      }),
    ],
  });
  const canonicalSummary = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-06-25T11:05:00.000Z",
    events: [
      buildEvent({
        dayKey: "2026-06-24",
        externalRef: canonicalExternalRef,
        legacyExternalRefs: [legacyExternalRef],
        value: 92,
      }),
    ],
  });
  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: legacySummary.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(canonicalSummary.events[0]?.id, legacySummary.events[0]?.id);
  assert.equal(canonicalSummary.events[0]?.dayKey, "2026-06-24");
  assert.equal(eventObservationValue(canonicalSummary.events[0]), 92);
  assert.equal(records.length, 2);
  assert.equal(new Set(records.map((record) => record.id)).size, 1);
});

test("a later primary legacy key remains distinct after its former owner migrates", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-sequential-legacy-primary");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const legacyExternalRef = {
    system: "junction",
    resourceType: "junction-garmin-stress-level",
    resourceId: "stress-level-day-a",
    facet: "stress-level",
  };
  const correctedExternalRef = {
    ...legacyExternalRef,
    resourceId: "stress-level-day-b",
  };
  const buildEvent = (input: {
    dayKey: string;
    externalRef: typeof legacyExternalRef;
    legacyExternalRefs?: Array<typeof legacyExternalRef>;
    observedAtRaw: string;
    value: number;
    evidenceRole: string;
  }) => ({
    kind: "observation" as const,
    occurredAt: `${input.dayKey}T12:00:00.000Z`,
    recordedAt: `${input.dayKey}T12:05:00.000Z`,
    dayKey: input.dayKey,
    title: "Junction stress level",
    externalRef: input.externalRef,
    legacyExternalRefs: input.legacyExternalRefs,
    evidenceRoles: [input.evidenceRole],
    dataOrigin: {
      version: 1 as const,
      aggregatorProvider: "junction",
      sourceProviderSlug: "garmin",
      sourceType: "watch",
      observedAtRaw: input.observedAtRaw,
      timestampSemantics: "offset" as const,
      normalizerVersion: "junction-stress-summary.v1",
    },
    fields: {
      metric: "stress-level",
      observationGrain: "summary" as const,
      value: input.value,
      unit: "score",
    },
  });
  const importEvent = (input: {
    importedAt: string;
    event: ReturnType<typeof buildEvent>;
  }) => importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: input.importedAt,
    events: [input.event],
    evidenceParts: [{
      role: input.event.evidenceRoles[0],
      fileName: `${input.event.evidenceRoles[0]}.json`,
      content: { value: input.event.fields.value },
    }],
  });
  const legacy = await importEvent({
    importedAt: "2026-06-25T11:00:00.000Z",
    event: buildEvent({
      dayKey: "2026-06-25",
      externalRef: legacyExternalRef,
      observedAtRaw: "2026-06-25:stress_level:corrected-owner",
      value: 44,
      evidenceRole: "stress-corrected-owner",
    }),
  });
  const corrected = await importEvent({
    importedAt: "2026-06-25T11:05:00.000Z",
    event: buildEvent({
      dayKey: "2026-06-25",
      externalRef: correctedExternalRef,
      legacyExternalRefs: [legacyExternalRef],
      observedAtRaw: "2026-06-25:stress_level:corrected-owner",
      value: 45,
      evidenceRole: "stress-corrected-owner",
    }),
  });
  assert.equal(corrected.events[0]?.id, legacy.events[0]?.id);

  const adjacentInput = {
    importedAt: "2026-06-26T11:00:00.000Z",
    event: buildEvent({
      dayKey: "2026-06-24",
      externalRef: legacyExternalRef,
      observedAtRaw: "2026-06-24:stress_level:adjacent-owner",
      value: 52,
      evidenceRole: "stress-adjacent-owner",
    }),
  } as const;
  const adjacent = await importEvent(adjacentInput);
  assert.ok(adjacent.applied);
  assert.notEqual(adjacent.events[0]?.id, corrected.events[0]?.id);
  const eventPath = legacy.eventShardPaths[0] as string;
  const eventRows = (await readJsonlRecords({ vaultRoot, relativePath: eventPath })) as EventRecord[];
  const latestById = new Map(eventRows.map((record) => [record.id, record]));
  assert.equal(latestById.size, 2);
  assert.deepEqual(
    [...latestById.values()].map((record) => record.externalRef?.resourceId).sort(),
    [legacyExternalRef.resourceId, correctedExternalRef.resourceId].sort(),
  );
  const watchedPaths = [eventPath, adjacent.ingestShardPath, adjacent.auditPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importEvent(adjacentInput);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  const delayedInput = {
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-06-27T11:00:00.000Z",
    events: [buildEvent({
      dayKey: "2026-06-25",
      externalRef: legacyExternalRef,
      observedAtRaw: "2026-06-25:stress_level:corrected-owner",
      value: 44,
      evidenceRole: "stress-corrected-owner",
    })],
    evidenceParts: [{
      role: "stress-corrected-owner",
      fileName: "stress-corrected-owner-delayed.json",
      content: { delayed: true, value: 44 },
    }],
  } as const;
  const delayed = await importDeviceBatch(delayedInput);
  assert.ok(delayed.applied);
  assert.ok(delayed.ingestId);
  assert.ok(delayed.ingestShardPath);
  assert.ok(delayed.auditPath);
  assert.deepEqual(delayed.events, []);
  const delayedRecord = await readRequiredIntegrationIngest(vaultRoot, delayed.ingestId);
  assert.deepEqual(delayedRecord.outputs.events, []);
  const delayedWatchedPaths = [eventPath, delayed.ingestShardPath, delayed.auditPath];
  const beforeDelayedReplay = await Promise.all(
    delayedWatchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  const delayedReplay = await importDeviceBatch(delayedInput);
  assert.equal(delayedReplay.applied, false);
  assert.deepEqual(delayedReplay.events, []);
  assert.deepEqual(
    await Promise.all(
      delayedWatchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeDelayedReplay,
  );
});

test("importDeviceBatch never reuses a revision number taken by a no-externalRef edit", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-revision-collision");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const eventId = first.events[0]?.id as string;
  const shardPath = first.eventShardPaths[0] as string;

  // Simulate a user edit through the generic event spine that did not echo
  // the externalRef: same id, revision 2, no externalRef.
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;
  const { externalRef: _externalRef, ...editedBase } = stored;
  const edited = {
    ...editedBase,
    lifecycle: { revision: 2 },
  };
  await fs.appendFile(path.join(vaultRoot, shardPath), `${JSON.stringify(edited)}\n`);

  // This row is not marked manual, so the changed provider delivery takes
  // revision 3 without colliding with revision 2.
  const updated = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        recordedAt: "2026-06-04T07:00:00.000Z",
        durationMinutes: 36,
      }),
    ],
  });

  assert.equal(updated.events[0]?.id, eventId);
  assert.equal(updated.events[0]?.lifecycle?.revision, 3);

  const records = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const revisions = records
    .filter((record) => record.id === eventId)
    .map((record) => record.lifecycle?.revision ?? 1)
    .sort((left, right) => left - right);
  assert.deepEqual(revisions, [1, 2, 3]);
});

test("importDeviceBatch advances provider refs behind user-authored same-externalRef edits", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-primary-ref-user-edit");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const eventId = first.events[0]?.id as string;
  const shardPath = first.eventShardPaths[0] as string;
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;
  const edited = {
    ...stored,
    source: "manual",
    note: "user-added context",
    tags: ["context"],
    links: [{ type: "related_to", targetId: eventId }],
    lifecycle: { revision: 2 },
  } satisfies EventRecord;
  await fs.appendFile(path.join(vaultRoot, shardPath), `${JSON.stringify(edited)}\n`);

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({
        recordedAt: "2026-06-04T07:00:00.000Z",
        durationMinutes: 36,
      }),
    ],
  });

  const records = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const latestUserEdited = collapseEventSpines(records).find((record) => record.id === eventId);
  assert.equal(latestUserEdited?.note, "user-added context");
  assert.deepEqual(latestUserEdited?.tags, ["context"]);
  assert.deepEqual(latestUserEdited?.links, [{ type: "related_to", targetId: eventId }]);
  assert.equal(latestUserEdited?.source, "manual");
  assert.ok(records.some((record) =>
    record.id === eventId
    && record.source === "device"
    && record.recordedAt === "2026-06-04T07:00:00.000Z"
  ));
});

test("importDeviceBatch retains member edits while advancing provider siblings atomically", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-member-edit-resolution-retained");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const resourceType = "junction-apple-health-profile";
  const resourceId = "profile-stable";
  const buildInput = (input: {
    editedValue: number;
    importedAt: string;
    siblingValue: number;
    version: string;
  }) => ({
    vaultRoot,
    provider: "junction",
    accountId: "junction-account",
    importedAt: input.importedAt,
    events: [
      {
        kind: "observation" as const,
        occurredAt: "2026-06-01T00:00:00.000Z",
        title: "Edited fact",
        externalRef: {
          system: "junction",
          resourceType,
          resourceId,
          version: input.version,
          facet: "edited-fact",
        },
        dataOrigin: {
          version: 1 as const,
          aggregatorProvider: "junction",
          sourceProviderSlug: "apple-health",
          sourceType: "phone",
          observedAtRaw: input.version,
          timestampSemantics: "utc" as const,
        },
        fields: {
          metric: "edited-fact",
          observationGrain: "summary" as const,
          value: input.editedValue,
          unit: "score",
        },
      },
      {
        kind: "observation" as const,
        occurredAt: "2026-06-01T00:00:00.000Z",
        title: "Sibling fact",
        externalRef: {
          system: "junction",
          resourceType,
          resourceId,
          version: input.version,
          facet: "sibling-fact",
        },
        fields: {
          metric: "sibling-fact",
          observationGrain: "summary" as const,
          value: input.siblingValue,
          unit: "score",
        },
      },
    ],
    authoritativeEventSets: [{
      system: "junction",
      resourceType,
      resourceId,
      version: input.version,
      facetPrefixes: ["edited-fact", "sibling-fact"],
      currentFacets: ["edited-fact", "sibling-fact"],
    }],
  });
  const first = await importDeviceBatch(buildInput({
    editedValue: 1,
    importedAt: "2026-06-10T10:00:00.000Z",
    siblingValue: 10,
    version: "2026-06-10T09:00:00.000Z",
  }));
  const edited = first.events.find((event) =>
    event.kind === "observation" && event.metric === "edited-fact"
  );
  assert.ok(edited);
  await upsertEvent({
    vaultRoot,
    payload: { ...edited, note: "member correction", value: 7, source: "manual" },
  });
  const correction = buildInput({
    editedValue: 2,
    importedAt: "2026-06-11T10:00:00.000Z",
    siblingValue: 11,
    version: "2026-06-11T09:00:00.000Z",
  });
  const update = await importDeviceBatch(correction);
  assert.ok(update.applied);
  const shardPath = first.eventShardPaths[0] as string;
  const keptRows = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const keptLive = collapseEventSpines(keptRows);
  const keptEdited = keptLive.find((event) => event.id === edited.id);
  const keptSibling = keptLive.find((event) =>
    event.kind === "observation" && event.metric === "sibling-fact"
  );
  assert.equal(keptEdited?.source, "manual");
  assert.equal(keptEdited?.note, "member correction");
  assert.equal(eventObservationValue(keptEdited), 7);
  assert.equal(eventObservationValue(keptSibling), 11);
  assert.ok(keptRows.some((event) =>
    event.id === edited.id
    && event.source === "device"
    && event.externalRef?.version === "2026-06-11T09:00:00.000Z"
    && eventObservationValue(event) === 2
  ));

  const replay = await importDeviceBatch(correction);
  assert.equal(replay.applied, false);
  const later = await importDeviceBatch(buildInput({
    editedValue: 3,
    importedAt: "2026-06-12T10:00:00.000Z",
    siblingValue: 12,
    version: "2026-06-12T09:00:00.000Z",
  }));
  assert.ok(later.applied);
  const finalRows = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const finalLive = collapseEventSpines(finalRows);
  const finalEdited = finalLive.find((event) => event.id === edited.id);
  assert.equal(finalEdited?.source, "manual");
  assert.equal(eventObservationValue(finalEdited), 7);
  assert.ok(finalRows.some((event) =>
    event.id === edited.id
    && event.source === "device"
    && event.externalRef?.version === "2026-06-12T09:00:00.000Z"
    && eventObservationValue(event) === 3
  ));
});

test("importDeviceBatch scopes no-id Junction profile predecessor claims to one source instance", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-profile-predecessor-scope");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  const resourceType = "junction-oura-profile";
  const profileResourceId = (sourceInstanceId: string, occurredAt: string) =>
    `profile-${createHash("sha256")
      .update(JSON.stringify(["profile", "oura", "ring", sourceInstanceId, occurredAt]))
      .digest("hex")
      .slice(0, 16)}`;
  const profileEvent = (input: {
    normalizerVersion: string;
    occurredAt: string;
    sourceInstanceId: string;
    value: number;
    version?: string;
  }) => ({
    kind: "observation" as const,
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
    dayKey: input.occurredAt.slice(0, 10),
    title: "Junction height",
    externalRef: {
      system: "junction",
      resourceType,
      resourceId: profileResourceId(input.sourceInstanceId, input.occurredAt),
      ...(input.version ? { version: input.version } : {}),
      facet: "height",
    },
    dataOrigin: {
      version: 1 as const,
      aggregatorProvider: "junction",
      sourceProviderSlug: "oura",
      sourceType: "ring",
      sourceInstanceId: input.sourceInstanceId,
      observedAtRaw: input.occurredAt,
      timestampSemantics: "utc" as const,
      normalizerVersion: input.normalizerVersion,
    },
    fields: {
      metric: "height",
      observationGrain: "summary" as const,
      value: input.value,
      unit: "cm",
    },
  });
  const firstUpdatedAt = "2026-05-20T09:00:00.000Z";
  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-05-20T10:00:00.000Z",
    events: [profileEvent({
      normalizerVersion: "junction-normalizer.v1",
      occurredAt: firstUpdatedAt,
      sourceInstanceId: "profile-source-a",
      value: 180,
    })],
  });
  const createdAt = "2026-05-01T09:00:00.000Z";
  const second = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-05-22T10:00:00.000Z",
    events: [profileEvent({
      normalizerVersion: "junction-no-id-profile.v1",
      occurredAt: createdAt,
      sourceInstanceId: "profile-source-b",
      value: 181,
      version: "2026-05-22T09:00:00.000Z",
    })],
  });

  assert.notEqual(second.events[0]?.id, first.events[0]?.id);
  const rows = (
    await Promise.all(
      [...new Set([...first.eventShardPaths, ...second.eventShardPaths])].map((relativePath) =>
        readJsonlRecords({ vaultRoot, relativePath })
      ),
    )
  ).flat() as EventRecord[];
  assert.equal(collapseEventSpines(rows).length, 2);
});

test("importDeviceBatch rejects ambiguous no-id Junction profile predecessors atomically", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-profile-predecessor-ambiguity");
  await initializeVault({ vaultRoot, createdAt: "2026-05-01T00:00:00.000Z" });
  const resourceType = "junction-oura-profile";
  const sourceInstanceId = "profile-source";
  const profileResourceId = (occurredAt: string) =>
    `profile-${createHash("sha256")
      .update(JSON.stringify(["profile", "oura", "ring", sourceInstanceId, occurredAt]))
      .digest("hex")
      .slice(0, 16)}`;
  const profileEvent = (input: {
    normalizerVersion: string;
    occurredAt: string;
    value: number;
    version?: string;
  }) => ({
    kind: "observation" as const,
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
    dayKey: input.occurredAt.slice(0, 10),
    title: "Junction height",
    externalRef: {
      system: "junction",
      resourceType,
      resourceId: profileResourceId(input.occurredAt),
      ...(input.version ? { version: input.version } : {}),
      facet: "height",
    },
    dataOrigin: {
      version: 1 as const,
      aggregatorProvider: "junction",
      sourceProviderSlug: "oura",
      sourceType: "ring",
      sourceInstanceId,
      observedAtRaw: input.occurredAt,
      timestampSemantics: "utc" as const,
      normalizerVersion: input.normalizerVersion,
    },
    fields: {
      metric: "height",
      observationGrain: "summary" as const,
      value: input.value,
      unit: "cm",
    },
  });
  const firstUpdatedAt = "2026-05-19T09:00:00.000Z";
  const secondUpdatedAt = "2026-05-20T09:00:00.000Z";
  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-05-20T10:00:00.000Z",
    events: [
      profileEvent({
        normalizerVersion: "junction-normalizer.v1",
        occurredAt: firstUpdatedAt,
        value: 179,
      }),
      profileEvent({
        normalizerVersion: "junction-normalizer.v1",
        occurredAt: secondUpdatedAt,
        value: 180,
      }),
    ],
  });
  const before = await snapshotVaultFiles(vaultRoot);
  const createdAt = "2026-05-01T09:00:00.000Z";

  await assert.rejects(
    importDeviceBatch({
      vaultRoot,
      provider: "junction",
      importedAt: "2026-05-22T10:00:00.000Z",
      events: [profileEvent({
        normalizerVersion: "junction-no-id-profile.v1",
        occurredAt: createdAt,
        value: 181,
        version: "2026-05-22T09:00:00.000Z",
      })],
    }),
    (error: unknown) => error instanceof VaultError
      && error.code === "EVENT_EXTERNAL_REF_ALIAS_CONFLICT",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), before);
});

test("importDeviceBatch retains omitted member edits above provider tombstones", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-member-edit-resolution-omitted");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const resourceType = "junction-apple-health-menstrual-cycle";
  const resourceId = "cycle-stable";
  const editedFacet = "cervical-mucus-2026-06-03-fingerprint";
  const buildEditedEvent = (version: string) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-03T00:00:00.000Z",
    title: "Edited cycle fact",
    externalRef: {
      system: "junction",
      resourceType,
      resourceId,
      version,
      facet: editedFacet,
    },
    fields: {
      metric: "cycle-fact",
      observationGrain: "summary" as const,
      value: 1,
      unit: "score",
    },
  });
  const firstVersion = "2026-06-10T09:00:00.000Z";
  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-06-10T10:00:00.000Z",
    events: [buildEditedEvent(firstVersion)],
    authoritativeEventSets: [{
      system: "junction",
      resourceType,
      resourceId,
      version: firstVersion,
      facetPrefixes: ["cervical-mucus"],
      currentFacets: [editedFacet],
    }],
  });
  const edited = first.events[0];
  assert.ok(edited);
  await upsertEvent({
    vaultRoot,
    payload: { ...edited, note: "member context", source: "manual" },
  });
  const omission = (input: { version: string }) => ({
    vaultRoot,
    provider: "junction",
    importedAt: input.version,
    events: [{
      kind: "observation" as const,
      occurredAt: "2026-06-04T00:00:00.000Z",
      title: "Unrelated update",
      externalRef: {
        system: "junction",
        resourceType: "junction-apple-health-activity",
        resourceId: "activity-2026-06-04",
        version: input.version,
        facet: "steps",
      },
      fields: {
        metric: "steps",
        observationGrain: "summary" as const,
        value: 4000,
        unit: "count",
      },
    }],
    authoritativeEventSets: [{
      system: "junction",
      resourceType,
      resourceId,
      version: input.version,
      facetPrefixes: ["cervical-mucus"],
      currentFacets: [],
    }],
  });
  const secondVersion = "2026-06-11T09:00:00.000Z";
  const update = await importDeviceBatch(omission({ version: secondVersion }));
  assert.ok(update.applied);
  const rows = (
    await Promise.all(update.eventShardPaths.map((relativePath) =>
      readJsonlRecords({ vaultRoot, relativePath })
    ))
  ).flat() as EventRecord[];
  const keptEdited = collapseEventSpines(rows).find((event) => event.id === edited.id);
  assert.equal(keptEdited?.note, "member context");
  assert.equal(keptEdited?.source, "manual");
  assert.ok(rows.some((event) =>
    event.id === edited.id
    && event.source === "device"
    && isDeletedEventLifecycle(event.lifecycle)
    && event.externalRef?.version === secondVersion
  ));
  assert.equal(await importDeviceBatch(omission({ version: secondVersion })).then((result) => result.applied), false);
});

test("importDeviceBatch advances historical provider refs behind user-authored no-externalRef edits", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-legacy-ref-no-external-ref-edit");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const legacyExternalRef = {
    system: "junction",
    resourceType: "junction-garmin-stress-level",
    resourceId: "stress-level-legacy-local-day",
    facet: "stress-level",
  };
  const currentExternalRef = {
    ...legacyExternalRef,
    resourceId: "stress-level-current-local-day",
  };
  const legacyOrigin = {
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    observedAtRaw: "2026-06-24:stress_level:daily",
    timestampSemantics: "offset" as const,
  };

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-25T12:00:00.000Z",
    events: [{
      kind: "observation",
      occurredAt: "2026-06-24T22:30:00.000Z",
      recordedAt: "2026-06-24T22:30:00.000Z",
      dayKey: "2026-06-24",
      title: "Junction stress level",
      externalRef: legacyExternalRef,
      dataOrigin: legacyOrigin,
      fields: {
        metric: "stress-level",
        observationGrain: "summary",
        value: 44,
        unit: "score",
      },
    }],
  });
  const eventId = first.events[0]?.id as string;
  const shardPath = first.eventShardPaths[0] as string;
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;
  const { externalRef: _externalRef, dataOrigin: _dataOrigin, ...editedBase } = stored;
  const edited = {
    ...editedBase,
    note: "user-added context",
    tags: ["context"],
    links: [{ type: "related_to", targetId: eventId }],
    lifecycle: { revision: 2 },
  };
  await fs.appendFile(path.join(vaultRoot, shardPath), `${JSON.stringify(edited)}\n`);

  await importDeviceBatch({
      vaultRoot,
      provider: "junction",
      accountId: "jxn_acct_stable",
      importedAt: "2026-06-25T12:30:00.000Z",
      events: [{
        kind: "observation",
        occurredAt: "2026-06-24T22:30:00.000Z",
        recordedAt: "2026-06-25T12:30:00.000Z",
        dayKey: "2026-06-25",
        title: "Junction stress level",
        externalRef: currentExternalRef,
        legacyExternalRefs: [legacyExternalRef],
        dataOrigin: {
          ...legacyOrigin,
          observedAtRaw: "2026-06-25:stress_level:daily",
        },
        fields: {
          metric: "stress-level",
          observationGrain: "summary",
          value: 44,
          unit: "score",
        },
      }],
    });

  const records = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const latestUserEdited = collapseEventSpines(records).find((record) => record.id === eventId);
  assert.equal(latestUserEdited?.note, "user-added context");
  assert.deepEqual(latestUserEdited?.tags, ["context"]);
  assert.deepEqual(latestUserEdited?.links, [{ type: "related_to", targetId: eventId }]);
  assert.ok(records.some((record) =>
    record.id === eventId
    && record.externalRef?.resourceId === currentExternalRef.resourceId
  ));
});

test("importDeviceBatch does not claim cross-day legacy refs when observation values differ", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-legacy-ref-value-mismatch");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const legacyExternalRef = {
    system: "junction",
    resourceType: "junction-garmin-stress-level",
    resourceId: "stress-level-legacy-day",
    facet: "stress-level",
  };
  const currentExternalRef = {
    ...legacyExternalRef,
    resourceId: "stress-level-current-day",
  };
  const dataOrigin = {
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    observedAtRaw: "2026-06-24:stress_level:daily",
    timestampSemantics: "offset" as const,
  };
  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-25T12:00:00.000Z",
    events: [{
      kind: "observation",
      occurredAt: "2026-06-24T22:30:00.000Z",
      recordedAt: "2026-06-24T22:30:00.000Z",
      dayKey: "2026-06-24",
      title: "Junction stress level",
      externalRef: legacyExternalRef,
      dataOrigin,
      fields: {
        metric: "stress-level",
        observationGrain: "summary",
        value: 44,
        unit: "score",
      },
    }],
  });
  const replay = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-25T12:30:00.000Z",
    events: [{
      kind: "observation",
      occurredAt: "2026-06-24T22:30:00.000Z",
      recordedAt: "2026-06-25T12:30:00.000Z",
      dayKey: "2026-06-25",
      title: "Junction stress level",
      externalRef: currentExternalRef,
      legacyExternalRefs: [legacyExternalRef],
      dataOrigin: {
        ...dataOrigin,
        observedAtRaw: "2026-06-25:stress_level:daily",
      },
      fields: {
        metric: "stress-level",
        observationGrain: "summary",
        value: 45,
        unit: "score",
      },
    }],
  });
  const records = (
    await Promise.all(
      [...new Set([...first.eventShardPaths, ...replay.eventShardPaths])].map((relativePath) =>
        readJsonlRecords({ vaultRoot, relativePath })
      ),
    )
  ).flat() as EventRecord[];
  const liveStressIds = new Set(
    records
      .filter((record) => record.kind === "observation" && record.metric === "stress-level")
      .map((record) => record.id),
  );

  assert.notEqual(replay.events[0]?.id, first.events[0]?.id);
  assert.equal(liveStressIds.size, 2);
});

test("importDeviceBatch does not claim unscoped WHOOP body legacy refs across accounts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-whoop-body-account-legacy-collision");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const legacyExternalRef = {
    system: "whoop",
    resourceType: "body-measurement",
    resourceId: "date:2026-06-24",
    facet: "weight",
  };
  const first = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-account-a",
    importedAt: "2026-06-25T12:00:00.000Z",
    events: [{
      kind: "observation",
      occurredAt: "2026-06-24T00:00:00.000Z",
      recordedAt: "2026-06-25T12:00:00.000Z",
      dayKey: "2026-06-24",
      title: "WHOOP weight",
      externalRef: legacyExternalRef,
      fields: {
        metric: "weight",
        observationGrain: "summary",
        value: 80,
        unit: "kg",
      },
    }],
  });
  const second = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-account-b",
    importedAt: "2026-06-25T12:30:00.000Z",
    events: [{
      kind: "observation",
      occurredAt: "2026-06-24T00:00:00.000Z",
      recordedAt: "2026-06-25T12:30:00.000Z",
      dayKey: "2026-06-24",
      title: "WHOOP weight",
      externalRef: {
        ...legacyExternalRef,
        resourceId: "account:bbbbbbbbbbbbbbbb/date:2026-06-24",
      },
      legacyExternalRefs: [legacyExternalRef],
      fields: {
        metric: "weight",
        observationGrain: "summary",
        value: 70,
        unit: "kg",
      },
    }],
  });
  const records = (
    await Promise.all(
      [...new Set([...first.eventShardPaths, ...second.eventShardPaths])].map((relativePath) =>
        readJsonlRecords({ vaultRoot, relativePath })
      ),
    )
  ).flat() as EventRecord[];
  const liveWeightIds = new Set(
    records
      .filter((record) => record.kind === "observation" && record.metric === "weight")
      .map((record) => record.id),
  );

  assert.notEqual(second.events[0]?.id, first.events[0]?.id);
  assert.equal(liveWeightIds.size, 2);
});

test("importDeviceBatch advances legacy-ref repair beneath a member edit that moves shards", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-legacy-ref-no-external-cross-shard");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const legacyExternalRef = {
    system: "junction",
    resourceType: "junction-garmin-stress-level",
    resourceId: "2026-06-01:stress_level:daily:garmin:watch",
    facet: "stress-level",
  };
  const currentExternalRef = {
    ...legacyExternalRef,
    resourceId: "2026-05-31:stress_level:daily:garmin:watch",
  };
  const dataOrigin = {
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: "garmin",
    sourceType: "watch",
    observedAtRaw: "2026-06-01:stress_level:daily",
    timestampSemantics: "offset" as const,
  };

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-01T12:00:00.000Z",
    events: [{
      kind: "observation",
      occurredAt: "2026-06-01T01:30:00.000Z",
      recordedAt: "2026-06-01T01:30:00.000Z",
      dayKey: "2026-06-01",
      title: "Junction stress level",
      externalRef: legacyExternalRef,
      dataOrigin,
      fields: {
        metric: "stress-level",
        observationGrain: "summary",
        value: 44,
        unit: "score",
      },
    }],
  });
  const eventId = first.events[0]?.id as string;
  const edited = await upsertEvent({
    vaultRoot,
    payload: {
      id: eventId,
      kind: "observation",
      occurredAt: "2026-05-31T23:30:00.000Z",
      recordedAt: "2026-06-01T12:30:00.000Z",
      dayKey: "2026-05-31",
      title: "Junction stress level",
      metric: "stress-level",
      observationGrain: "summary",
      value: 44,
      unit: "score",
    } satisfies Record<string, unknown>,
  });
  const providerCorrection = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-01T13:00:00.000Z",
    events: [{
      kind: "observation",
      occurredAt: "2026-05-31T23:30:00.000Z",
      recordedAt: "2026-06-01T13:00:00.000Z",
      dayKey: "2026-05-31",
      title: "Junction stress level",
      externalRef: currentExternalRef,
      legacyExternalRefs: [legacyExternalRef],
      dataOrigin: {
        ...dataOrigin,
        observedAtRaw: "2026-05-31:stress_level:daily",
      },
      fields: {
        metric: "stress-level",
        observationGrain: "summary",
        value: 44,
        unit: "score",
      },
    }],
  } as const;
  const correction = await importDeviceBatch(providerCorrection);

  const records = (
    await Promise.all(
      [...new Set([
        ...first.eventShardPaths,
        ...correction.eventShardPaths,
        edited.ledgerFile,
      ])].map((relativePath) => readJsonlRecords({ vaultRoot, relativePath })),
    )
  ).flat() as EventRecord[];
  const stressIds = new Set(
    records
      .filter((record) => record.kind === "observation" && record.metric === "stress-level")
      .map((record) => record.id),
  );

  assert.deepEqual([...stressIds], [eventId]);
  const memberRevision = collapseEventSpines(records).find((record) => record.id === eventId);
  assert.equal(memberRevision?.source, "manual");
  assert.equal(memberRevision?.occurredAt, "2026-05-31T23:30:00.000Z");
  assert.equal(memberRevision?.dayKey, "2026-05-31");
  assert.ok(records.some((record) =>
    record.id === eventId && record.externalRef?.resourceId === currentExternalRef.resourceId
  ));
});

test("findEventByExternalRef ignores historical refs after an event moves identity", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-find-current-ref");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildInput = (accountId: string) => ({
    vaultRoot,
    provider: "junction",
    accountId,
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const first = await importDeviceBatch(buildInput("jxn_acct_stable"));
  const shardPath = first.eventShardPaths[0] as string;
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;
  assert.ok(stored.externalRef);

  const moved = {
    ...stored,
    externalRef: {
      ...stored.externalRef,
      resourceId: "workouts-corrected",
    },
    lifecycle: { revision: 2 },
  };
  await fs.appendFile(path.join(vaultRoot, shardPath), `${JSON.stringify(moved)}\n`);
  const firstIngestPath = first.ingestShardPath;
  const firstAuditPath = first.auditPath;
  assert.ok(firstIngestPath);
  assert.ok(firstAuditPath);
  const watchedPaths = [shardPath, firstIngestPath, firstAuditPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  const exactReplay = await importDeviceBatch(buildInput("jxn_acct_stable"));
  const accountDriftReplay = await importDeviceBatch(buildInput("jxn_acct_changed"));

  assert.equal(exactReplay.applied, false);
  assert.equal(accountDriftReplay.applied, false);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );
  const laterInput = {
    ...buildInput("jxn_acct_changed"),
    importedAt: "2026-07-01T21:00:00.000Z",
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { id: "historical-workout" },
    }],
  } as const;
  const later = await importDeviceBatch(laterInput);
  const converged = await importDeviceBatch(laterInput);
  assert.ok(later.applied);
  assert.ok(later.ingestId);
  assert.equal(converged.applied, false);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, later.ingestId)).outputs.events,
    [],
  );

  const historical = await findEventByExternalRef({
    vaultRoot,
    system: stored.externalRef.system,
    resourceType: stored.externalRef.resourceType,
    resourceId: stored.externalRef.resourceId,
    facet: stored.externalRef.facet,
  });
  const current = await findEventByExternalRef({
    vaultRoot,
    system: stored.externalRef.system,
    resourceType: stored.externalRef.resourceType,
    resourceId: "workouts-corrected",
    facet: stored.externalRef.facet,
  });

  assert.equal(historical, null);
  assert.equal(current?.id, stored.id);
  assert.equal(current?.lifecycle?.revision, 2);
  assert.deepEqual(exactReplay.events, []);
  assert.deepEqual(accountDriftReplay.events, []);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );
});

test("ambiguous historical device owners retain evidence without reassociating an event", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-ambiguous-historical-owner");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const originalInput = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  } as const;
  const first = await importDeviceBatch(originalInput);
  const shardPath = first.eventShardPaths[0] as string;
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;
  assert.ok(stored.externalRef);

  const secondId = deterministicContractId("evt", "ambiguous-historical-device-owner");
  const secondHistorical = { ...stored, id: secondId } satisfies EventRecord;
  const movedFirst = {
    ...stored,
    externalRef: { ...stored.externalRef, resourceId: "workouts-corrected-a" },
    lifecycle: { revision: 2 },
  } satisfies EventRecord;
  const movedSecond = {
    ...secondHistorical,
    externalRef: { ...stored.externalRef, resourceId: "workouts-corrected-b" },
    lifecycle: { revision: 2 },
  } satisfies EventRecord;
  await fs.appendFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify(secondHistorical)}\n${JSON.stringify(movedFirst)}\n${JSON.stringify(movedSecond)}\n`,
  );
  const eventBytesBeforeDelivery = await fs.readFile(path.join(vaultRoot, shardPath));

  const deliveryInput = {
    ...originalInput,
    accountId: "jxn_acct_changed",
    importedAt: "2026-07-01T21:00:00.000Z",
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { id: "ambiguous-historical-workout" },
    }],
  } as const;
  const delivery = await importDeviceBatch(deliveryInput);
  assert.ok(delivery.applied);
  assert.ok(delivery.auditPath);
  assert.deepEqual(delivery.events, []);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, delivery.ingestId)).outputs.events,
    [],
  );
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, shardPath)), eventBytesBeforeDelivery);

  const watchedPaths = [delivery.ingestShardPath, delivery.auditPath, shardPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(deliveryInput);

  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );
  const eventRows = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  assert.deepEqual(
    [...new Set(eventRows.map((record) => record.id))].sort(),
    [stored.id, secondId].sort(),
  );
});

test("importDeviceBatch supersedes an in-batch fresh record when a later entry changes it", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-inbatch-supersede");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  // One batch carries the same provider record twice with different content
  // (e.g. merged overlapping bundles): the second entry must supersede the
  // first as a spine revision inside the same append plan.
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent(),
        evidenceRoles: ["junction-workout-v1"],
      },
      {
        ...buildJunctionStyleWorkoutEvent({
          recordedAt: "2026-06-03T22:00:00.000Z",
          durationMinutes: 36,
        }),
        evidenceRoles: ["junction-workout-v2"],
      },
    ],
    evidenceParts: [
      {
        role: "junction-workout-v1",
        fileName: "junction-workout-v1.json",
        content: { durationMinutes: 34 },
      },
      {
        role: "junction-workout-v2",
        fileName: "junction-workout-v2.json",
        content: { durationMinutes: 36 },
      },
    ],
  } as const;
  const result = await importDeviceBatch(input);
  assert.ok(result.ingestId);
  assert.ok(result.ingestShardPath);
  assert.ok(result.auditPath);

  const eventShardPath = result.eventShardPaths[0] as string;
  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  })) as EventRecord[];

  assert.equal(records.length, 2);
  assert.equal(new Set(records.map((record) => record.id)).size, 1);
  assert.deepEqual(
    records.map((record) => record.lifecycle?.revision ?? 1).sort((left, right) => left - right),
    [1, 2],
  );
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0]?.id, result.events[1]?.id);
  assert.equal(result.events[1]?.lifecycle?.revision, 2);
  const canonicalEventId = result.events[0]?.id as string;
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, result.ingestId)).outputs.events,
    [{
      id: canonicalEventId,
      roles: ["junction-workout-v1", "junction-workout-v2"],
    }],
  );

  const watchedPaths = [eventShardPath, result.ingestShardPath, result.auditPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(input);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  await fs.unlink(path.join(vaultRoot, eventShardPath));
  const beforeRejectedRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  await assert.rejects(fs.access(path.join(vaultRoot, eventShardPath)));
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedRepair);
});

test("importDeviceBatch replays one retained duplicate role from equivalent same-spine rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-inbatch-duplicate-roles");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent(),
        evidenceRoles: ["junction-workout-primary"],
      },
      {
        ...buildJunctionStyleWorkoutEvent(),
        evidenceRoles: ["junction-workout-duplicate"],
      },
    ],
    evidenceParts: [
      {
        role: "junction-workout-primary",
        fileName: "junction-workout-primary.json",
        content: { source: "primary" },
      },
      {
        role: "junction-workout-duplicate",
        fileName: "junction-workout-duplicate.json",
        content: { source: "duplicate" },
      },
    ],
  } as const;

  const first = await importDeviceBatch(input);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  assert.ok(first.auditPath);
  assert.equal(first.events.length, 1);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, first.ingestId)).outputs.events,
    [{
      id: first.events[0]?.id,
      roles: ["junction-workout-primary"],
    }],
  );

  const watchedPaths = [
    first.eventShardPaths[0] as string,
    first.ingestShardPath,
    first.auditPath,
  ];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(input);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  const eventShardPath = first.eventShardPaths[0] as string;
  await fs.unlink(path.join(vaultRoot, eventShardPath));
  const beforeRejectedRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  await assert.rejects(fs.access(path.join(vaultRoot, eventShardPath)));
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedRepair);
});

test("importDeviceBatch rejects full-spine repair after multiple same-content deliveries", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-existing-duplicate-roles");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const primaryEvent = {
    ...buildJunctionStyleWorkoutEvent(),
    evidenceRoles: ["junction-workout-primary"],
  };
  const seed = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T20:00:00.000Z",
    events: [primaryEvent],
    evidenceParts: [{
      role: "junction-workout-primary",
      fileName: "junction-workout-primary.json",
      content: { source: "primary" },
    }],
  });
  assert.equal(seed.events.length, 1);
  const canonicalEventId = seed.events[0]?.id;
  assert.ok(canonicalEventId);

  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      primaryEvent,
      {
        ...buildJunctionStyleWorkoutEvent(),
        evidenceRoles: ["junction-workout-duplicate"],
      },
    ],
    evidenceParts: [
      {
        role: "junction-workout-primary",
        fileName: "junction-workout-primary.json",
        content: { source: "primary" },
      },
      {
        role: "junction-workout-duplicate",
        fileName: "junction-workout-duplicate.json",
        content: { source: "duplicate" },
      },
    ],
  } as const;

  const first = await importDeviceBatch(input);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  assert.ok(first.auditPath);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, first.ingestId)).outputs.events,
    [{ id: canonicalEventId, roles: ["junction-workout-primary"] }],
  );

  const eventShardPath = seed.eventShardPaths[0] as string;
  const watchedPaths = [eventShardPath, first.ingestShardPath, first.auditPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(input);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  await fs.unlink(path.join(vaultRoot, eventShardPath));
  const beforeRejectedRepair = await Promise.all(
    watchedPaths.slice(1).map((relativePath) =>
      fs.readFile(path.join(vaultRoot, relativePath))
    ),
  );
  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  await assert.rejects(fs.access(path.join(vaultRoot, eventShardPath)));
  assert.deepEqual(
    await Promise.all(
      watchedPaths.slice(1).map((relativePath) =>
        fs.readFile(path.join(vaultRoot, relativePath))
      ),
    ),
    beforeRejectedRepair,
  );
});

test("importDeviceBatch replays a transitive in-batch legacy-ref migration and rejects complete loss", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-inbatch-legacy-migration");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const externalRefA = {
    system: "junction",
    resourceType: "junction-garmin-sleep",
    resourceId: "legacy-sleep-window",
    facet: "sleep-deep-minutes",
  };
  const externalRefB = {
    ...externalRefA,
    resourceId: "canonical-sleep-window",
  };
  const externalRefC = {
    ...externalRefA,
    resourceId: "rescored-sleep-window",
  };
  const buildEvent = (input: {
    evidenceRole: string;
    externalRef: typeof externalRefA;
    legacyExternalRefs?: Array<typeof externalRefA>;
    value: number;
  }) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-25T03:00:00.000Z",
    recordedAt: "2026-06-25T03:00:00.000Z",
    dayKey: "2026-06-24",
    title: "Junction deep sleep",
    externalRef: input.externalRef,
    legacyExternalRefs: input.legacyExternalRefs,
    evidenceRoles: [input.evidenceRole],
    fields: {
      metric: "sleep-deep-minutes",
      observationGrain: "summary" as const,
      value: input.value,
      unit: "minutes",
    },
  });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-06-25T11:00:00.000Z",
    events: [
      buildEvent({
        evidenceRole: "junction-sleep-legacy",
        externalRef: externalRefA,
        value: 90,
      }),
      buildEvent({
        evidenceRole: "junction-sleep-canonical",
        externalRef: externalRefB,
        legacyExternalRefs: [externalRefA],
        value: 92,
      }),
      buildEvent({
        evidenceRole: "junction-sleep-rescored",
        externalRef: externalRefC,
        legacyExternalRefs: [externalRefB],
        value: 94,
      }),
    ],
    evidenceParts: [
      {
        role: "junction-sleep-legacy",
        fileName: "junction-sleep-legacy.json",
        content: { value: 90 },
      },
      {
        role: "junction-sleep-canonical",
        fileName: "junction-sleep-canonical.json",
        content: { value: 92 },
      },
      {
        role: "junction-sleep-rescored",
        fileName: "junction-sleep-rescored.json",
        content: { value: 94 },
      },
    ],
  } as const;

  const first = await importDeviceBatch(input);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  assert.ok(first.auditPath);
  assert.equal(first.events.length, 3);
  assert.equal(new Set(first.events.map((event) => event.id)).size, 1);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, first.ingestId)).outputs.events,
    [{
      id: first.events[0]?.id,
      roles: [
        "junction-sleep-canonical",
        "junction-sleep-legacy",
        "junction-sleep-rescored",
      ],
    }],
  );

  const watchedPaths = [
    first.eventShardPaths[0] as string,
    first.ingestShardPath,
    first.auditPath,
  ];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(input);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  const eventShardPath = first.eventShardPaths[0] as string;
  await fs.unlink(path.join(vaultRoot, eventShardPath));
  const beforeRejectedRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  await assert.rejects(fs.access(path.join(vaultRoot, eventShardPath)));
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedRepair);
});

test("importDeviceBatch restores an earlier retained revision from a missing monthly shard", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-partial-spine-shard-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T12:00:00.000Z" });
  const buildEvent = (input: {
    evidenceRole: string;
    occurredAt: string;
    value: number;
  }) => ({
    kind: "observation" as const,
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
    title: "Junction recovery score",
    externalRef: {
      system: "junction",
      resourceType: "junction-whoop-recovery",
      resourceId: "cross-month-recovery",
      facet: "recovery-score",
    },
    evidenceRoles: [input.evidenceRole],
    fields: {
      metric: "recovery-score",
      value: input.value,
      unit: "%",
    },
  });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-02-02T11:00:00.000Z",
    events: [
      buildEvent({
        evidenceRole: "junction-recovery-january",
        occurredAt: "2026-01-31T23:30:00.000Z",
        value: 67,
      }),
      buildEvent({
        evidenceRole: "junction-recovery-february",
        occurredAt: "2026-02-01T00:30:00.000Z",
        value: 70,
      }),
    ],
    evidenceParts: [
      {
        role: "junction-recovery-january",
        fileName: "junction-recovery-january.json",
        content: { value: 67 },
      },
      {
        role: "junction-recovery-february",
        fileName: "junction-recovery-february.json",
        content: { value: 70 },
      },
    ],
  } as const;

  const first = await importDeviceBatch(input);
  assert.ok(first.ingestId);
  assert.equal(first.eventShardPaths.length, 2);
  const januaryShardPath = first.eventShardPaths.find((relativePath) =>
    relativePath.includes("2026-01")
  );
  const februaryShardPath = first.eventShardPaths.find((relativePath) =>
    relativePath.includes("2026-02")
  );
  assert.ok(januaryShardPath);
  assert.ok(februaryShardPath);
  const canonicalEventId = first.events[0]?.id;
  assert.ok(canonicalEventId);
  const retainedOutputs = (await readRequiredIntegrationIngest(
    vaultRoot,
    first.ingestId,
  )).outputs.events;
  const februaryBytes = await fs.readFile(path.join(vaultRoot, februaryShardPath));

  await fs.unlink(path.join(vaultRoot, januaryShardPath));
  const repair = await importDeviceBatch(input);
  assert.equal(repair.applied, true);
  assert.ok(repair.ingestId);
  assert.ok(repair.ingestShardPath);
  assert.ok(repair.auditPath);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, februaryShardPath)), februaryBytes);
  const repairedJanuaryRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: januaryShardPath,
  })) as EventRecord[];
  assert.equal(repairedJanuaryRecords.length, 1);
  assert.equal(repairedJanuaryRecords[0]?.id, canonicalEventId);
  assert.equal(repairedJanuaryRecords[0]?.lifecycle?.revision ?? 1, 1);
  assert.equal(eventObservationValue(repairedJanuaryRecords[0]), 67);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, repair.ingestId)).outputs.events,
    retainedOutputs,
  );

  const repairedPaths = [
    januaryShardPath,
    februaryShardPath,
    repair.ingestShardPath,
    repair.auditPath,
  ];
  const beforeReplay = await Promise.all(
    repairedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(input);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(
    await Promise.all(
      repairedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );
});

test.each(["distinct", "shared", "roleless"] as const)(
  "combined cross-month WHOOP delivery does not hide a missing accepted revision with %s roles",
  async (roleMode) => {
    const vaultRoot = await makeTempDirectory(
      `murph-device-import-combined-cross-month-${roleMode}`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T12:00:00.000Z" });
    const staleRoles = roleMode === "distinct"
      ? ["whoop-recovery-v1"]
      : roleMode === "shared"
        ? ["whoop-recovery-shared"]
        : [];
    const newRoles = roleMode === "distinct"
      ? ["whoop-recovery-v3"]
      : roleMode === "shared"
        ? ["whoop-recovery-shared"]
        : [];
    const buildEvent = (
      occurredAt: string,
      value: number,
      version: string,
      evidenceRoles: readonly string[],
    ) => ({
      kind: "observation" as const,
      occurredAt,
      recordedAt: occurredAt,
      title: "WHOOP recovery score",
      externalRef: {
        system: "whoop",
        resourceType: "recovery",
        resourceId: `combined-cross-month-${roleMode}`,
        version,
        facet: "recovery-score",
      },
      evidenceRoles: [...evidenceRoles],
      fields: { metric: "recovery-score", value, unit: "%" },
    });
    const evidenceParts = roleMode === "distinct"
      ? [
          {
            role: staleRoles[0]!,
            fileName: "whoop-recovery-v1.json",
            content: { value: 61 },
          },
          {
            role: newRoles[0]!,
            fileName: "whoop-recovery-v3.json",
            content: { value: 83 },
          },
        ]
      : roleMode === "shared"
        ? [{
            role: "whoop-recovery-shared",
            fileName: "whoop-recovery-shared.json",
            content: { values: [61, 83] },
          }]
        : [];
    const input = {
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-user-1",
      importedAt: "2026-02-02T11:00:00.000Z",
      events: [
        buildEvent(
          "2026-01-31T23:30:00.000Z",
          61,
          "2026-01-31T23:30:00.000Z",
          staleRoles,
        ),
        buildEvent(
          "2026-02-01T00:30:00.000Z",
          83,
          "2026-02-01T00:30:00.000Z",
          newRoles,
        ),
      ],
      evidenceParts,
    } as const;
    const first = await importDeviceBatch(input);
    assert.ok(first.ingestId);
    assert.equal(first.eventShardPaths.length, 2);
    const januaryShardPath = first.eventShardPaths.find((relativePath) =>
      relativePath.includes("2026-01")
    );
    const februaryShardPath = first.eventShardPaths.find((relativePath) =>
      relativePath.includes("2026-02")
    );
    assert.ok(januaryShardPath);
    assert.ok(februaryShardPath);
    const canonicalEventId = first.events[0]?.id;
    assert.ok(canonicalEventId);
    const februaryBytes = await fs.readFile(path.join(vaultRoot, februaryShardPath));
    await fs.unlink(path.join(vaultRoot, januaryShardPath));

    if (roleMode !== "distinct") {
      const beforeRejectedRepair = await snapshotVaultFiles(vaultRoot);
      await assert.rejects(
        importDeviceBatch(input),
        (error) =>
          error instanceof VaultError
          && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
      );
      await assert.rejects(fs.access(path.join(vaultRoot, januaryShardPath)));
      assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedRepair);
      return;
    }

    const repair = await importDeviceBatch(input);
    assert.equal(repair.applied, true);
    assert.ok(repair.ingestShardPath);
    assert.ok(repair.auditPath);
    assert.deepEqual(await fs.readFile(path.join(vaultRoot, februaryShardPath)), februaryBytes);
    const repairedJanuaryRecords = (await readJsonlRecords({
      vaultRoot,
      relativePath: januaryShardPath,
    })) as EventRecord[];
    assert.equal(repairedJanuaryRecords.length, 1);
    assert.equal(repairedJanuaryRecords[0]?.id, canonicalEventId);
    assert.equal(repairedJanuaryRecords[0]?.lifecycle?.revision ?? 1, 1);
    const beforeReplay = await snapshotVaultFiles(vaultRoot);
    const replay = await importDeviceBatch(input);
    assert.equal(replay.applied, false);
    assert.equal(replay.auditPath, null);
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplay);
  },
);

test("importDeviceBatch rejects partial repair when the retained revision number is occupied", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-partial-repair-revision-collision");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildVersionedEvent = (input: {
    durationMinutes: number;
    evidenceRole: string;
    version: string;
  }) => ({
    ...buildJunctionStyleWorkoutEvent({ durationMinutes: input.durationMinutes }),
    externalRef: {
      ...buildJunctionStyleWorkoutEvent().externalRef,
      version: input.version,
    },
    evidenceRoles: [input.evidenceRole],
  });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "account-a",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      buildVersionedEvent({
        durationMinutes: 34,
        evidenceRole: "junction-workout-v1",
        version: "2026-06-03T20:30:00.000Z",
      }),
      buildVersionedEvent({
        durationMinutes: 35,
        evidenceRole: "junction-workout-v2",
        version: "2026-06-04T20:30:00.000Z",
      }),
    ],
    evidenceParts: [
      {
        role: "junction-workout-v1",
        fileName: "junction-workout-v1.json",
        content: { durationMinutes: 34 },
      },
      {
        role: "junction-workout-v2",
        fileName: "junction-workout-v2.json",
        content: { durationMinutes: 35 },
      },
    ],
  } as const;

  const first = await importDeviceBatch(input);
  assert.ok(first.ingestShardPath);
  assert.ok(first.auditPath);
  const eventShardPath = first.eventShardPaths[0];
  assert.ok(eventShardPath);
  const storedRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  })) as EventRecord[];
  const revisionOne = storedRows.find((record) => (record.lifecycle?.revision ?? 1) === 1);
  const revisionTwo = storedRows.find((record) => record.lifecycle?.revision === 2);
  assert.ok(revisionOne);
  assert.ok(revisionTwo);
  if (revisionOne.kind !== "activity_session") {
    throw new Error("expected a workout event");
  }
  const conflictingRevision: EventRecord = {
    ...revisionOne,
    durationMinutes: 99,
  };
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `${JSON.stringify(revisionTwo)}\n${JSON.stringify(conflictingRevision)}\n`,
    "utf8",
  );
  const watchedPaths = [eventShardPath, first.ingestShardPath, first.auditPath];
  const beforeRepair = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeRepair,
  );
});

test("importDeviceBatch restores an anchored earlier shard after later deliveries advance the spine", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-advanced-spine-shard-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-01-01T12:00:00.000Z" });
  const buildEvent = (input: {
    evidenceRole: string;
    occurredAt: string;
    value: number;
    version: string;
  }) => ({
    kind: "observation" as const,
    occurredAt: input.occurredAt,
    recordedAt: input.occurredAt,
    title: "Junction recovery score",
    externalRef: {
      system: "junction",
      resourceType: "junction-whoop-recovery",
      resourceId: "advanced-cross-month-recovery",
      version: input.version,
      facet: "recovery-score",
    },
    evidenceRoles: [input.evidenceRole],
    fields: {
      metric: "recovery-score",
      value: input.value,
      unit: "%",
    },
  });
  const earlierInput = {
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-02-02T11:00:00.000Z",
    events: [
      buildEvent({
        evidenceRole: "junction-recovery-january",
        occurredAt: "2026-01-31T23:30:00.000Z",
        value: 67,
        version: "2026-01-31T23:30:00.000Z",
      }),
      buildEvent({
        evidenceRole: "junction-recovery-february",
        occurredAt: "2026-02-01T00:30:00.000Z",
        value: 70,
        version: "2026-02-01T00:30:00.000Z",
      }),
    ],
    evidenceParts: [
      {
        role: "junction-recovery-january",
        fileName: "junction-recovery-january.json",
        content: { value: 67 },
      },
      {
        role: "junction-recovery-february",
        fileName: "junction-recovery-february.json",
        content: { value: 70 },
      },
    ],
  } as const;

  const earlier = await importDeviceBatch(earlierInput);
  assert.ok(earlier.ingestId);
  const canonicalEventId = earlier.events[0]?.id;
  assert.ok(canonicalEventId);
  const januaryShardPath = earlier.eventShardPaths.find((relativePath) =>
    relativePath.includes("2026-01")
  );
  const februaryShardPath = earlier.eventShardPaths.find((relativePath) =>
    relativePath.includes("2026-02")
  );
  assert.ok(januaryShardPath);
  assert.ok(februaryShardPath);

  const later = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-03-02T11:00:00.000Z",
    events: [buildEvent({
      evidenceRole: "junction-recovery-march",
      occurredAt: "2026-03-01T00:30:00.000Z",
      value: 74,
      version: "2026-03-01T00:30:00.000Z",
    })],
    evidenceParts: [{
      role: "junction-recovery-march",
      fileName: "junction-recovery-march.json",
      content: { value: 74 },
    }],
  });
  assert.equal(later.events[0]?.id, canonicalEventId);
  const marchShardPath = later.eventShardPaths[0] as string;
  const februaryBytes = await fs.readFile(path.join(vaultRoot, februaryShardPath));
  const marchBytes = await fs.readFile(path.join(vaultRoot, marchShardPath));

  await fs.unlink(path.join(vaultRoot, januaryShardPath));
  const repair = await importDeviceBatch(earlierInput);
  assert.equal(repair.applied, true);
  const repairedJanuaryRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: januaryShardPath,
  })) as EventRecord[];
  assert.equal(repairedJanuaryRecords.length, 1);
  assert.equal(repairedJanuaryRecords[0]?.id, canonicalEventId);
  assert.equal(repairedJanuaryRecords[0]?.lifecycle?.revision ?? 1, 1);
  assert.equal(eventObservationValue(repairedJanuaryRecords[0]), 67);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, februaryShardPath)), februaryBytes);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, marchShardPath)), marchBytes);

  const watchedPaths = [januaryShardPath, februaryShardPath, marchShardPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(earlierInput);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  const repeated = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-04-02T11:00:00.000Z",
    events: [buildEvent({
      evidenceRole: "junction-recovery-april-repeat",
      occurredAt: "2026-04-01T00:30:00.000Z",
      value: 70,
      version: "2026-04-01T00:30:00.000Z",
    })],
    evidenceParts: [{
      role: "junction-recovery-april-repeat",
      fileName: "junction-recovery-april-repeat.json",
      content: { value: 70 },
    }],
  });
  assert.equal(repeated.events[0]?.id, canonicalEventId);
  assert.equal(repeated.events[0]?.lifecycle?.revision, 4);
  const aprilShardPath = repeated.eventShardPaths[0] as string;
  await fs.unlink(path.join(vaultRoot, januaryShardPath));
  const ambiguousRepairPaths = [februaryShardPath, marchShardPath, aprilShardPath];
  const beforeAmbiguousRepair = await Promise.all(
    ambiguousRepairPaths.map((relativePath) =>
      fs.readFile(path.join(vaultRoot, relativePath))
    ),
  );
  const repeatedRepair = await importDeviceBatch(earlierInput);
  assert.equal(repeatedRepair.applied, true);
  const repeatedJanuaryRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: januaryShardPath,
  })) as EventRecord[];
  assert.equal(repeatedJanuaryRecords.length, 1);
  assert.equal(repeatedJanuaryRecords[0]?.id, canonicalEventId);
  assert.equal(repeatedJanuaryRecords[0]?.lifecycle?.revision ?? 1, 1);
  assert.equal(eventObservationValue(repeatedJanuaryRecords[0]), 67);
  assert.deepEqual(
    await Promise.all(
      ambiguousRepairPaths.map((relativePath) =>
        fs.readFile(path.join(vaultRoot, relativePath))
      ),
    ),
    beforeAmbiguousRepair,
  );
});

test("importDeviceBatch rejects unprovable revision repair after complete spine loss", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-complete-spine-loss");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildInput = (input: {
    evidenceRole: string;
    importedAt: string;
    value: number;
    version: string;
  }) => ({
    vaultRoot,
    provider: "whoop" as const,
    accountId: "whoop-user-1",
    importedAt: input.importedAt,
    events: [{
      kind: "observation" as const,
      occurredAt: "2026-06-03T07:30:00.000Z",
      recordedAt: "2026-06-03T07:30:00.000Z",
      title: "WHOOP recovery score",
      externalRef: {
        system: "whoop",
        resourceType: "recovery",
        resourceId: "complete-spine-loss",
        version: input.version,
        facet: "recovery-score",
      },
      evidenceRoles: [input.evidenceRole],
      fields: {
        metric: "recovery-score",
        value: input.value,
        unit: "%",
      },
    }],
    evidenceParts: [{
      role: input.evidenceRole,
      fileName: `${input.evidenceRole}.json`,
      content: { source: "shared-recovery-evidence" },
    }],
  });

  const revisionOne = await importDeviceBatch(buildInput({
    evidenceRole: "whoop-recovery-shared",
    importedAt: "2026-06-03T08:00:00.000Z",
    value: 61,
    version: "2026-06-03T08:00:00.000Z",
  }));
  const canonicalEventId = revisionOne.events[0]?.id;
  assert.ok(canonicalEventId);
  const revisionTwo = await importDeviceBatch(buildInput({
    evidenceRole: "whoop-recovery-shared",
    importedAt: "2026-06-03T09:00:00.000Z",
    value: 72,
    version: "2026-06-03T09:00:00.000Z",
  }));
  assert.equal(revisionTwo.events[0]?.id, canonicalEventId);
  assert.equal(revisionTwo.events[0]?.lifecycle?.revision, 2);
  const revisionThreeInput = buildInput({
    evidenceRole: "whoop-recovery-shared",
    importedAt: "2026-06-03T10:00:00.000Z",
    value: 83,
    version: "2026-06-03T10:00:00.000Z",
  });
  const revisionThree = await importDeviceBatch(revisionThreeInput);
  assert.equal(revisionThree.events[0]?.id, canonicalEventId);
  assert.equal(revisionThree.events[0]?.lifecycle?.revision, 3);
  assert.ok(revisionThree.ingestShardPath);
  assert.ok(revisionThree.auditPath);

  const eventShardPath = revisionThree.eventShardPaths[0] as string;
  await fs.unlink(path.join(vaultRoot, eventShardPath));
  const watchedPaths = [revisionThree.ingestShardPath, revisionThree.auditPath];
  const beforeRepair = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  await assert.rejects(
    importDeviceBatch(revisionThreeInput),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  await assert.rejects(fs.access(path.join(vaultRoot, eventShardPath)));
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeRepair,
  );
});

test("importDeviceBatch replays stale-then-new, shared-role, and empty-role deliveries", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-stale-then-new-spine");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildEvent = (input: {
    evidenceRole: string;
    value: number;
    version: string;
  }) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-03T07:30:00.000Z",
    recordedAt: "2026-06-03T07:30:00.000Z",
    title: "WHOOP recovery score",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "stale-then-new-spine",
      version: input.version,
      facet: "recovery-score",
    },
    evidenceRoles: [input.evidenceRole],
    fields: {
      metric: "recovery-score",
      value: input.value,
      unit: "%",
    },
  });
  const importSingle = async (input: {
    evidenceRole: string;
    importedAt: string;
    value: number;
    version: string;
  }) =>
    importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-user-1",
      importedAt: input.importedAt,
      events: [buildEvent(input)],
      evidenceParts: [{
        role: input.evidenceRole,
        fileName: `${input.evidenceRole}.json`,
        content: { value: input.value },
      }],
    });

  const v1 = {
    evidenceRole: "whoop-recovery-v1-seed",
    importedAt: "2026-06-03T08:00:00.000Z",
    value: 61,
    version: "2026-06-03T08:00:00.000Z",
  } as const;
  const v2 = {
    evidenceRole: "whoop-recovery-v2-seed",
    importedAt: "2026-06-03T09:00:00.000Z",
    value: 72,
    version: "2026-06-03T09:00:00.000Z",
  } as const;
  const first = await importSingle(v1);
  const canonicalEventId = first.events[0]?.id;
  assert.ok(canonicalEventId);
  const second = await importSingle(v2);
  assert.equal(second.events[0]?.id, canonicalEventId);
  assert.equal(second.events[0]?.lifecycle?.revision, 2);

  const input = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-06-03T10:00:00.000Z",
    events: [
      buildEvent({
        evidenceRole: "whoop-recovery-stale-v1",
        value: v1.value,
        version: v1.version,
      }),
      buildEvent({
        evidenceRole: "whoop-recovery-new-v3",
        value: 83,
        version: "2026-06-03T10:00:00.000Z",
      }),
    ],
    evidenceParts: [
      {
        role: "whoop-recovery-stale-v1",
        fileName: "whoop-recovery-stale-v1.json",
        content: { value: v1.value },
      },
      {
        role: "whoop-recovery-new-v3",
        fileName: "whoop-recovery-new-v3.json",
        content: { value: 83 },
      },
    ],
  } as const;

  const accepted = await importDeviceBatch(input);
  assert.ok(accepted.ingestId);
  assert.ok(accepted.ingestShardPath);
  assert.ok(accepted.auditPath);
  assert.equal(accepted.events[0]?.id, canonicalEventId);
  assert.equal(accepted.events[0]?.lifecycle?.revision, 3);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, accepted.ingestId)).outputs.events,
    [{ id: canonicalEventId, roles: ["whoop-recovery-new-v3"] }],
  );

  const eventShardPath = accepted.eventShardPaths[0] as string;
  const watchedPaths = [eventShardPath, accepted.ingestShardPath, accepted.auditPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(input);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(replay.events.map((event) => event.id), [canonicalEventId]);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  const completeEventBytes = await fs.readFile(path.join(vaultRoot, eventShardPath));
  const survivingPrefixRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  }) as EventRecord[]).filter((record) => (record.lifecycle?.revision ?? 1) === 1);
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `${survivingPrefixRows.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const beforeAmbiguousPrefixRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) => error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeAmbiguousPrefixRepair);
  await fs.writeFile(path.join(vaultRoot, eventShardPath), completeEventBytes);
  const survivingRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  }) as EventRecord[]).filter((record) => record.lifecycle?.revision !== 3);
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `${survivingRows.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const beforeRejectedTailRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedTailRepair);
  await fs.writeFile(path.join(vaultRoot, eventShardPath), completeEventBytes);

  const ambiguousInput = {
    ...input,
    importedAt: "2026-06-03T11:00:00.000Z",
    events: [
      buildEvent({
        evidenceRole: "whoop-recovery-shared",
        value: v1.value,
        version: v1.version,
      }),
      buildEvent({
        evidenceRole: "whoop-recovery-shared",
        value: 91,
        version: "2026-06-03T11:00:00.000Z",
      }),
    ],
    evidenceParts: [{
      role: "whoop-recovery-shared",
      fileName: "whoop-recovery-shared.json",
      content: { values: [v1.value, 91] },
    }],
  } as const;
  const ambiguousAccepted = await importDeviceBatch(ambiguousInput);
  assert.ok(ambiguousAccepted.ingestId);
  assert.ok(ambiguousAccepted.ingestShardPath);
  assert.ok(ambiguousAccepted.auditPath);
  assert.equal(ambiguousAccepted.events[0]?.id, canonicalEventId);
  assert.equal(ambiguousAccepted.events[0]?.lifecycle?.revision, 4);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(
      vaultRoot,
      ambiguousAccepted.ingestId,
    )).outputs.events,
    [{ id: canonicalEventId, roles: ["whoop-recovery-shared"] }],
  );
  const ambiguousWatchedPaths = [
    ambiguousAccepted.eventShardPaths[0] as string,
    ambiguousAccepted.ingestShardPath,
    ambiguousAccepted.auditPath,
  ];
  const beforeAmbiguousReplay = await Promise.all(
    ambiguousWatchedPaths.map((relativePath) =>
      fs.readFile(path.join(vaultRoot, relativePath))
    ),
  );
  const ambiguousReplay = await importDeviceBatch(ambiguousInput);
  assert.equal(ambiguousReplay.applied, false);
  assert.equal(ambiguousReplay.auditPath, null);
  assert.deepEqual(ambiguousReplay.events.map((event) => event.id), [canonicalEventId]);
  assert.deepEqual(
    await Promise.all(
      ambiguousWatchedPaths.map((relativePath) =>
        fs.readFile(path.join(vaultRoot, relativePath))
      ),
    ),
    beforeAmbiguousReplay,
  );
  const completeAmbiguousEventBytes = await fs.readFile(
    path.join(vaultRoot, ambiguousWatchedPaths[0] as string),
  );
  const rowsWithoutSharedRoleRevision = (await readJsonlRecords({
    vaultRoot,
    relativePath: ambiguousWatchedPaths[0] as string,
  }) as EventRecord[]).filter((record) => record.lifecycle?.revision !== 4);
  await fs.writeFile(
    path.join(vaultRoot, ambiguousWatchedPaths[0] as string),
    `${rowsWithoutSharedRoleRevision.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const beforeAmbiguousRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(ambiguousInput),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeAmbiguousRepair);
  await fs.writeFile(
    path.join(vaultRoot, ambiguousWatchedPaths[0] as string),
    completeAmbiguousEventBytes,
  );

  const emptyRoleInput = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-06-03T12:00:00.000Z",
    events: [
      {
        ...buildEvent({
          evidenceRole: "unused-stale-role",
          value: v1.value,
          version: v1.version,
        }),
        evidenceRoles: [],
      },
      {
        ...buildEvent({
          evidenceRole: "unused-new-role",
          value: 94,
          version: "2026-06-03T12:00:00.000Z",
        }),
        evidenceRoles: [],
      },
    ],
    evidenceParts: [],
  } as const;
  const emptyRoleAccepted = await importDeviceBatch(emptyRoleInput);
  assert.ok(emptyRoleAccepted.ingestId);
  assert.ok(emptyRoleAccepted.ingestShardPath);
  assert.ok(emptyRoleAccepted.auditPath);
  assert.equal(emptyRoleAccepted.events[0]?.id, canonicalEventId);
  assert.equal(emptyRoleAccepted.events[0]?.lifecycle?.revision, 5);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(
      vaultRoot,
      emptyRoleAccepted.ingestId,
    )).outputs.events,
    [{ id: canonicalEventId, roles: [] }],
  );
  const emptyRoleWatchedPaths = [
    emptyRoleAccepted.eventShardPaths[0] as string,
    emptyRoleAccepted.ingestShardPath,
    emptyRoleAccepted.auditPath,
  ];
  const beforeEmptyRoleReplay = await Promise.all(
    emptyRoleWatchedPaths.map((relativePath) =>
      fs.readFile(path.join(vaultRoot, relativePath))
    ),
  );
  const emptyRoleReplay = await importDeviceBatch(emptyRoleInput);
  assert.equal(emptyRoleReplay.applied, false);
  assert.equal(emptyRoleReplay.auditPath, null);
  assert.deepEqual(emptyRoleReplay.events.map((event) => event.id), [canonicalEventId]);
  assert.deepEqual(
    await Promise.all(
      emptyRoleWatchedPaths.map((relativePath) =>
        fs.readFile(path.join(vaultRoot, relativePath))
      ),
    ),
    beforeEmptyRoleReplay,
  );

  const emptyRoleEvent = emptyRoleAccepted.events[0];
  assert.ok(emptyRoleEvent);
  await upsertEvent({
    vaultRoot,
    payload: {
      ...emptyRoleEvent,
      note: "User-authored empty-role correction",
      source: "manual",
    },
  });
  let beforeProtectedReplay = await snapshotVaultFiles(vaultRoot);
  let protectedReplay = await importDeviceBatch(emptyRoleInput);
  assert.equal(protectedReplay.applied, false);
  assert.equal(protectedReplay.auditPath, null);
  assert.deepEqual(protectedReplay.events, []);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeProtectedReplay);

  await deleteEvent({ vaultRoot, eventId: emptyRoleEvent.id });
  beforeProtectedReplay = await snapshotVaultFiles(vaultRoot);
  protectedReplay = await importDeviceBatch(emptyRoleInput);
  assert.equal(protectedReplay.applied, false);
  assert.equal(protectedReplay.auditPath, null);
  assert.deepEqual(protectedReplay.events, []);
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeProtectedReplay);
});

test.each(["edit", "delete"] as const)(
  "exact replay rejects incoming-newer repair after a lost %s suffix",
  async (terminalMutation) => {
    const vaultRoot = await makeTempDirectory(
      `murph-device-import-lost-${terminalMutation}-suffix`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T12:00:00.000Z" });
    const buildInput = (input: {
      importedAt: string;
      occurredAt: string;
      role: string;
      value: number;
      version: string;
    }) => ({
      vaultRoot,
      provider: "whoop",
      accountId: `whoop_lost_${terminalMutation}_suffix`,
      importedAt: input.importedAt,
      events: [{
        kind: "observation" as const,
        occurredAt: input.occurredAt,
        recordedAt: input.occurredAt,
        title: "WHOOP recovery score",
        externalRef: {
          system: "whoop",
          resourceType: "recovery",
          resourceId: `lost-${terminalMutation}-suffix`,
          version: input.version,
          facet: "recovery-score",
        },
        evidenceRoles: [input.role],
        fields: { metric: "recovery-score", value: input.value, unit: "%" },
      }],
      evidenceParts: [{
        role: input.role,
        fileName: `${input.role}.json`,
        content: { value: input.value },
      }],
    });
    const revisionOne = await importDeviceBatch(buildInput({
      importedAt: "2026-01-31T20:00:00.000Z",
      occurredAt: "2026-01-31T19:30:00.000Z",
      role: `whoop-lost-${terminalMutation}-v1`,
      value: 61,
      version: "2026-01-31T20:00:00.000Z",
    }));
    const revisionTwoInput = buildInput({
      importedAt: "2026-02-01T20:00:00.000Z",
      occurredAt: "2026-02-01T19:30:00.000Z",
      role: `whoop-lost-${terminalMutation}-v2`,
      value: 72,
      version: "2026-02-01T20:00:00.000Z",
    });
    const revisionTwo = await importDeviceBatch(revisionTwoInput);
    const canonicalEvent = revisionTwo.events[0];
    const januaryShardPath = revisionOne.eventShardPaths[0];
    const februaryShardPath = revisionTwo.eventShardPaths[0];
    assert.ok(canonicalEvent);
    assert.ok(januaryShardPath?.includes("2026-01"));
    assert.ok(februaryShardPath?.includes("2026-02"));
    assert.equal(canonicalEvent.lifecycle?.revision, 2);

    if (terminalMutation === "edit") {
      await upsertEvent({
        vaultRoot,
        payload: {
          ...canonicalEvent,
          note: "Member correction after provider acceptance",
          source: "manual",
        },
      });
    } else {
      await deleteEvent({ vaultRoot, eventId: canonicalEvent.id });
    }
    const februaryRows = (await readJsonlRecords({
      vaultRoot,
      relativePath: februaryShardPath,
    })) as EventRecord[];
    assert.deepEqual(
      februaryRows.map((record) => record.lifecycle?.revision ?? 1),
      [2, 3],
    );

    await fs.unlink(path.join(vaultRoot, februaryShardPath));
    const beforeReplay = await snapshotVaultFiles(vaultRoot);
    await assert.rejects(
      importDeviceBatch(revisionTwoInput),
      (error) => error instanceof VaultError
        && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
    );
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplay);
  },
);

test("exact replay rejects sibling incoming-newer members that would share a revision", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-sibling-repair-revision");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildEvent = (input: { role: string; value: number; version: string }) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-03T07:30:00.000Z",
    recordedAt: "2026-06-03T07:30:00.000Z",
    title: "WHOOP recovery score",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "sibling-repair-revision",
      version: input.version,
      facet: "recovery-score",
    },
    evidenceRoles: [input.role],
    fields: { metric: "recovery-score", value: input.value, unit: "%" },
  });
  const importSingle = (input: {
    importedAt: string;
    role: string;
    value: number;
    version: string;
  }) => importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop_sibling_repair_revision",
    importedAt: input.importedAt,
    events: [buildEvent(input)],
    evidenceParts: [{
      role: input.role,
      fileName: `${input.role}.json`,
      content: { value: input.value },
    }],
  });
  await importSingle({
    importedAt: "2026-06-03T08:00:00.000Z",
    role: "whoop-sibling-repair-v1",
    value: 61,
    version: "2026-06-03T08:00:00.000Z",
  });
  await importSingle({
    importedAt: "2026-06-03T09:00:00.000Z",
    role: "whoop-sibling-repair-v2",
    value: 72,
    version: "2026-06-03T09:00:00.000Z",
  });
  const replayInput = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop_sibling_repair_revision",
    importedAt: "2026-06-03T11:00:00.000Z",
    events: [
      buildEvent({
        role: "whoop-sibling-repair-v3",
        value: 83,
        version: "2026-06-03T10:00:00.000Z",
      }),
      buildEvent({
        role: "whoop-sibling-repair-v4",
        value: 91,
        version: "2026-06-03T11:00:00.000Z",
      }),
    ],
    evidenceParts: [
      {
        role: "whoop-sibling-repair-v3",
        fileName: "whoop-sibling-repair-v3.json",
        content: { value: 83 },
      },
      {
        role: "whoop-sibling-repair-v4",
        fileName: "whoop-sibling-repair-v4.json",
        content: { value: 91 },
      },
    ],
  } as const;
  const accepted = await importDeviceBatch(replayInput);
  const eventShardPath = accepted.eventShardPaths[0];
  assert.ok(eventShardPath);
  assert.deepEqual(
    accepted.events.map((event) => event.lifecycle?.revision),
    [3, 4],
  );
  const survivingRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  }) as EventRecord[]).filter((record) => (record.lifecycle?.revision ?? 1) <= 2);
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `${survivingRows.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const beforeReplay = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(replayInput),
    (error) => error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplay);
});

test("exact replay rejects a missing accepted middle revision without a stored-proven anchor", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-missing-middle-anchor");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildEvent = (input: { role: string; value: number; version: string }) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-03T07:30:00.000Z",
    recordedAt: "2026-06-03T07:30:00.000Z",
    title: "WHOOP recovery score",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "missing-middle-anchor",
      version: input.version,
      facet: "recovery-score",
    },
    evidenceRoles: [input.role],
    fields: { metric: "recovery-score", value: input.value, unit: "%" },
  });
  const importSingle = (input: {
    importedAt: string;
    role: string;
    value: number;
    version: string;
  }) => importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    accountId: "whoop_missing_middle_anchor",
    importedAt: input.importedAt,
    events: [buildEvent(input)],
    evidenceParts: [{
      role: input.role,
      fileName: `${input.role}.json`,
      content: { value: input.value },
    }],
  });

  const v1 = {
    importedAt: "2026-06-03T08:00:00.000Z",
    role: "whoop-missing-middle-v1",
    value: 61,
    version: "2026-06-03T08:00:00.000Z",
  } as const;
  await importSingle(v1);
  await importSingle({
    importedAt: "2026-06-03T09:00:00.000Z",
    role: "whoop-missing-middle-v2",
    value: 72,
    version: "2026-06-03T09:00:00.000Z",
  });
  const replayInput = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop_missing_middle_anchor",
    importedAt: "2026-06-03T10:00:00.000Z",
    events: [
      buildEvent(v1),
      buildEvent({
        role: "whoop-missing-middle-v3",
        value: 83,
        version: "2026-06-03T10:00:00.000Z",
      }),
    ],
    evidenceParts: [
      {
        role: v1.role,
        fileName: `${v1.role}.json`,
        content: { value: v1.value },
      },
      {
        role: "whoop-missing-middle-v3",
        fileName: "whoop-missing-middle-v3.json",
        content: { value: 83 },
      },
    ],
  } as const;
  const accepted = await importDeviceBatch(replayInput);
  const canonicalEventId = accepted.events[0]?.id;
  const eventShardPath = accepted.eventShardPaths[0];
  assert.ok(canonicalEventId);
  assert.ok(eventShardPath);
  const v4 = await importSingle({
    importedAt: "2026-06-03T11:00:00.000Z",
    role: "whoop-missing-middle-v4",
    value: 91,
    version: "2026-06-03T11:00:00.000Z",
  });
  assert.equal(v4.events[0]?.lifecycle?.revision, 4);

  const survivingRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  }) as EventRecord[]).filter((record) => {
    const revision = record.lifecycle?.revision ?? 1;
    return revision === 1 || revision === 4;
  });
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `${survivingRows.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const beforeReplay = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(replayInput),
    (error) => error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplay);
});

test.each(["distinct", "shared", "roleless"] as const)(
  "fresh stale-then-new %s delivery replays against a preexisting middle revision",
  async (roleMode) => {
    const vaultRoot = await makeTempDirectory(
      `murph-device-import-fresh-stale-then-new-${roleMode}`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const resourceId = `fresh-stale-then-new-${roleMode}`;
    const buildEvent = (value: number, version: string, evidenceRoles: readonly string[]) => ({
      kind: "observation" as const,
      occurredAt: "2026-06-03T07:30:00.000Z",
      recordedAt: "2026-06-03T07:30:00.000Z",
      title: "WHOOP recovery score",
      externalRef: {
        system: "whoop",
        resourceType: "recovery",
        resourceId,
        version,
        facet: "recovery-score",
      },
      evidenceRoles: [...evidenceRoles],
      fields: { metric: "recovery-score", value, unit: "%" },
    });
    const v1 = "2026-06-03T08:00:00.000Z";
    const v2 = "2026-06-03T09:00:00.000Z";
    const v3 = "2026-06-03T10:00:00.000Z";
    const seed = await importDeviceBatch({
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-user-1",
      importedAt: v2,
      events: [buildEvent(72, v2, ["whoop-recovery-v2-seed"])],
      evidenceParts: [{
        role: "whoop-recovery-v2-seed",
        fileName: "whoop-recovery-v2-seed.json",
        content: { value: 72 },
      }],
    });
    const canonicalEventId = seed.events[0]?.id;
    assert.ok(canonicalEventId);
    const staleRoles = roleMode === "distinct"
      ? ["whoop-recovery-stale-v1"]
      : roleMode === "shared"
        ? ["whoop-recovery-shared"]
        : [];
    const newRoles = roleMode === "distinct"
      ? ["whoop-recovery-new-v3"]
      : roleMode === "shared"
        ? ["whoop-recovery-shared"]
        : [];
    const evidenceParts = roleMode === "distinct"
      ? [
          {
            role: staleRoles[0]!,
            fileName: "whoop-recovery-stale-v1.json",
            content: { value: 61 },
          },
          {
            role: newRoles[0]!,
            fileName: "whoop-recovery-new-v3.json",
            content: { value: 83 },
          },
        ]
      : roleMode === "shared"
        ? [{
            role: "whoop-recovery-shared",
            fileName: "whoop-recovery-shared.json",
            content: { values: [61, 83] },
          }]
        : [];
    const input = {
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-user-1",
      importedAt: "2026-06-03T10:30:00.000Z",
      events: [
        buildEvent(61, v1, staleRoles),
        buildEvent(83, v3, newRoles),
      ],
      evidenceParts,
    } as const;

    const accepted = await importDeviceBatch(input);
    assert.ok(accepted.ingestId);
    assert.equal(accepted.events.at(-1)?.id, canonicalEventId);
    assert.equal(accepted.events.at(-1)?.lifecycle?.revision, 2);
    assert.deepEqual(
      (await readRequiredIntegrationIngest(vaultRoot, accepted.ingestId)).outputs.events,
      [{ id: canonicalEventId, roles: newRoles }],
    );
    const beforeReplay = await snapshotVaultFiles(vaultRoot);

    const replay = await importDeviceBatch(input);

    assert.equal(replay.applied, false);
    assert.equal(replay.auditPath, null);
    assert.deepEqual(replay.events.map((event) => event.id), [canonicalEventId]);
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplay);
  },
);

test("ambiguous shared-role replay rejects a missing incomparable provider revision", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-shared-role-incomparable-version");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildEvent = (input: {
    durationMinutes: number;
    evidenceRole: string;
    version: string;
  }) => {
    const event = buildJunctionStyleWorkoutEvent({
      durationMinutes: input.durationMinutes,
      resourceId: "workout-shared-role-incomparable-version",
    });
    return {
      ...event,
      externalRef: {
        ...event.externalRef,
        version: input.version,
      },
      evidenceRoles: [input.evidenceRole],
    };
  };
  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-06-03T08:00:00.000Z",
    events: [buildEvent({
      durationMinutes: 61,
      evidenceRole: "junction-workout-seed",
      version: "provider-revision-one",
    })],
    evidenceParts: [{
      role: "junction-workout-seed",
      fileName: "junction-workout-seed.json",
      content: { durationMinutes: 61 },
    }],
  });
  const canonicalEventId = first.events[0]?.id;
  assert.ok(canonicalEventId);

  const sharedInput = {
    vaultRoot,
    provider: "junction",
    accountId: "junction-user-1",
    importedAt: "2026-06-03T09:00:00.000Z",
    events: [
      buildEvent({
        durationMinutes: 61,
        evidenceRole: "junction-workout-shared",
        version: "provider-revision-one",
      }),
      buildEvent({
        durationMinutes: 72,
        evidenceRole: "junction-workout-shared",
        version: "provider-revision-two",
      }),
    ],
    evidenceParts: [{
      role: "junction-workout-shared",
      fileName: "junction-workout-shared.json",
      content: { durationMinutes: [61, 72] },
    }],
  } as const;
  const accepted = await importDeviceBatch(sharedInput);
  assert.ok(accepted.ingestId);
  assert.equal(accepted.events.at(-1)?.id, canonicalEventId);
  assert.equal(accepted.events.at(-1)?.lifecycle?.revision, 2);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, accepted.ingestId)).outputs.events,
    [{ id: canonicalEventId, roles: ["junction-workout-shared"] }],
  );

  const replay = await importDeviceBatch(sharedInput);
  assert.equal(replay.applied, false);
  assert.deepEqual(replay.events.map((event) => event.id), [canonicalEventId]);

  const eventShardPath = accepted.eventShardPaths[0] as string;
  const survivingRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  }) as EventRecord[]).filter((record) => record.lifecycle?.revision !== 2);
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `${survivingRows.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const beforeRejectedReplay = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(sharedInput),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedReplay);
});

test("importDeviceBatch replays a newest-then-stale provider spine using only retained roles", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-newest-then-stale-spine");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildEvent = (input: {
    evidenceRole: string;
    value: number;
    version: string;
  }) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-03T07:30:00.000Z",
    recordedAt: "2026-06-03T07:30:00.000Z",
    title: "WHOOP recovery score",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "sleep-newest-then-stale",
      version: input.version,
      facet: "recovery-score",
    },
    evidenceRoles: [input.evidenceRole],
    fields: {
      metric: "recovery-score",
      value: input.value,
      unit: "%",
    },
  });
  const input = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-06-03T11:00:00.000Z",
    events: [
      buildEvent({
        evidenceRole: "whoop-recovery-newest",
        value: 70,
        version: "2026-06-03T10:00:00.000Z",
      }),
      buildEvent({
        evidenceRole: "whoop-recovery-stale",
        value: 67,
        version: "2026-06-02T10:00:00.000Z",
      }),
    ],
    evidenceParts: [
      {
        role: "whoop-recovery-newest",
        fileName: "whoop-recovery-newest.json",
        content: { value: 70 },
      },
      {
        role: "whoop-recovery-stale",
        fileName: "whoop-recovery-stale.json",
        content: { value: 67 },
      },
    ],
    samples: buildDenseHeartRateSamples(1),
  } as const;

  const first = await importDeviceBatch(input);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  assert.ok(first.auditPath);
  assert.equal(first.events.length, 1);
  assert.equal(eventObservationValue(first.events[0]), 70);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, first.ingestId)).outputs.events,
    [{
      id: first.events[0]?.id,
      roles: ["whoop-recovery-newest"],
    }],
  );

  const eventShardPath = first.eventShardPaths[0] as string;
  const sampleShardPath = first.sampleShardPaths[0] as string;
  const watchedPaths = [
    eventShardPath,
    sampleShardPath,
    first.ingestShardPath,
    first.auditPath,
  ];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(input);
  assert.equal(replay.applied, false);
  assert.equal(replay.auditPath, null);
  assert.deepEqual(replay.events.map((event) => event.id), [first.events[0]?.id]);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  await fs.unlink(path.join(vaultRoot, eventShardPath));
  const beforeRejectedRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  await assert.rejects(fs.access(path.join(vaultRoot, eventShardPath)));
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedRepair);
});

test.each(["shared", "roleless"] as const)(
  "fresh newest-then-stale %s delivery replays exactly",
  async (roleMode) => {
    const vaultRoot = await makeTempDirectory(
      `murph-device-import-newest-then-stale-${roleMode}`,
    );
    await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
    const sharedRole = "whoop-recovery-shared-snapshot";
    const unrelatedRole = "whoop-recovery-unrelated";
    const buildEvent = (value: number, version: string) => ({
      kind: "observation" as const,
      occurredAt: "2026-06-03T07:30:00.000Z",
      recordedAt: "2026-06-03T07:30:00.000Z",
      title: "WHOOP recovery score",
      externalRef: {
        system: "whoop",
        resourceType: "recovery",
        resourceId: `newest-then-stale-${roleMode}`,
        version,
        facet: "recovery-score",
      },
      evidenceRoles: roleMode === "shared" ? [sharedRole] : [],
      fields: {
        metric: "recovery-score",
        value,
        unit: "%",
      },
    });
    const input = {
      vaultRoot,
      provider: "whoop",
      accountId: "whoop-user-1",
      importedAt: "2026-06-03T11:00:00.000Z",
      events: [
        buildEvent(70, "2026-06-03T10:00:00.000Z"),
        buildEvent(67, "2026-06-02T10:00:00.000Z"),
      ],
      evidenceParts: roleMode === "shared"
        ? [
            {
              role: sharedRole,
              fileName: "whoop-recovery-shared-snapshot.json",
              content: { values: [70, 67] },
            },
            {
              role: unrelatedRole,
              fileName: "whoop-recovery-unrelated.json",
              content: { unrelated: true },
            },
          ]
        : [],
      samples: buildDenseHeartRateSamples(1),
    } as const;

    const first = await importDeviceBatch(input);
    assert.ok(first.ingestId);
    assert.ok(first.ingestShardPath);
    assert.equal(first.events.length, 1);
    assert.equal(eventObservationValue(first.events[0]), 70);
    assert.deepEqual(
      (await readRequiredIntegrationIngest(vaultRoot, first.ingestId)).outputs.events,
      [{
        id: first.events[0]?.id,
        roles: roleMode === "shared" ? [sharedRole] : [],
      }],
    );
    const beforeReplay = await snapshotVaultFiles(vaultRoot);
    const replay = await importDeviceBatch(input);
    assert.equal(replay.applied, false);
    assert.equal(replay.auditPath, null);
    assert.deepEqual(replay.events.map((event) => event.id), [first.events[0]?.id]);
    assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplay);

    const eventShardPath = first.eventShardPaths[0] as string;
    const sampleShardPath = first.sampleShardPaths[0] as string;
    const eventBytesBeforeSampleRepair = await fs.readFile(
      path.join(vaultRoot, eventShardPath),
    );
    const acceptedIngestBeforeSampleRepair = await readRequiredIntegrationIngest(
      vaultRoot,
      first.ingestId,
    );
    if (roleMode === "shared") {
      const ingestRows = (await readJsonlRecords({
        vaultRoot,
        relativePath: first.ingestShardPath,
      })) as IntegrationIngestRecord[];
      const [acceptedOutput] = acceptedIngestBeforeSampleRepair.outputs.events;
      assert.ok(acceptedOutput);
      const wrongRoleIngest: IntegrationIngestRecord = {
        ...acceptedIngestBeforeSampleRepair,
        outputs: {
          ...acceptedIngestBeforeSampleRepair.outputs,
          events: [{ ...acceptedOutput, roles: [unrelatedRole] }],
        },
      };
      await fs.writeFile(
        path.join(vaultRoot, first.ingestShardPath),
        ingestRows
          .map((record) => JSON.stringify(record.id === first.ingestId ? wrongRoleIngest : record))
          .join("\n") + "\n",
        "utf8",
      );
      await fs.unlink(path.join(vaultRoot, sampleShardPath));
      const beforeWrongRoleRepair = await snapshotVaultFiles(vaultRoot);

      await assert.rejects(
        importDeviceBatch(input),
        (error) =>
          error instanceof VaultError
          && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
      );
      assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeWrongRoleRepair);
      await fs.writeFile(
        path.join(vaultRoot, first.ingestShardPath),
        ingestRows.map((record) => JSON.stringify(record)).join("\n") + "\n",
        "utf8",
      );
    } else {
      await fs.unlink(path.join(vaultRoot, sampleShardPath));
    }
    const sampleRepair = await importDeviceBatch(input);
    assert.equal(sampleRepair.applied, true);
    assert.equal(sampleRepair.events.length, 1);
    assert.equal(sampleRepair.samples.length, 1);
    assert.equal(
      (await readJsonlRecords({ vaultRoot, relativePath: sampleShardPath })).length,
      1,
    );
    assert.deepEqual(
      await fs.readFile(path.join(vaultRoot, eventShardPath)),
      eventBytesBeforeSampleRepair,
    );
    assert.deepEqual(
      await readRequiredIntegrationIngest(vaultRoot, first.ingestId),
      acceptedIngestBeforeSampleRepair,
    );
  },
);

test("exact replay rejects a missing accepted roleless revision behind a role-bearing survivor", async () => {
  const vaultRoot = await makeTempDirectory(
    "murph-device-import-missing-roleless-revision",
  );
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const olderRole = "whoop-recovery-older";
  const buildEvent = (input: {
    evidenceRoles: readonly string[];
    value: number;
    version: string;
  }) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-03T07:30:00.000Z",
    recordedAt: "2026-06-03T07:30:00.000Z",
    title: "WHOOP recovery score",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "role-bearing-then-roleless",
      version: input.version,
      facet: "recovery-score",
    },
    evidenceRoles: input.evidenceRoles,
    fields: {
      metric: "recovery-score",
      value: input.value,
      unit: "%",
    },
  });
  const input = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop-user-1",
    importedAt: "2026-06-03T11:00:00.000Z",
    events: [
      buildEvent({
        evidenceRoles: [olderRole],
        value: 67,
        version: "2026-06-02T10:00:00.000Z",
      }),
      buildEvent({
        evidenceRoles: [],
        value: 70,
        version: "2026-06-03T10:00:00.000Z",
      }),
    ],
    evidenceParts: [{
      role: olderRole,
      fileName: "whoop-recovery-older.json",
      content: { value: 67 },
    }],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.ingestId);
  const canonicalEventId = first.events.at(-1)?.id;
  assert.ok(canonicalEventId);
  assert.equal(first.events.at(-1)?.lifecycle?.revision, 2);
  assert.deepEqual(
    (await readRequiredIntegrationIngest(vaultRoot, first.ingestId)).outputs.events,
    [{ id: canonicalEventId, roles: [olderRole] }],
  );

  const eventShardPath = first.eventShardPaths[0] as string;
  const survivingRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  }) as EventRecord[]).filter((record) => record.lifecycle?.revision !== 2);
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `${survivingRows.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const beforeRejectedReplay = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedReplay);
});

test("dedupeDeviceEventsByExternalRef tombstones legacy duplicates and keeps the latest copy", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-dedupe-cleanup");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const keptId = first.events[0]?.id as string;
  const shardPath = first.eventShardPaths[0] as string;

  // Simulate the pre-fix on-disk state: the same provider record exists as
  // two more live events under different ids (accountId churn duplicates).
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;
  for (const [duplicateId, recordedAt] of [
    ["evt_0000000000000000000000DP21", "2026-06-02T07:00:00.000Z"],
    ["evt_0000000000000000000000DP22", "2026-06-01T07:00:00.000Z"],
  ] as const) {
    await fs.appendFile(
      path.join(vaultRoot, shardPath),
      `${JSON.stringify({ ...stored, id: duplicateId, recordedAt })}\n`,
    );
  }

  const dryRun = await dedupeDeviceEventsByExternalRef({ vaultRoot });

  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.duplicateGroupCount, 1);
  assert.equal(dryRun.tombstonedEventCount, 2);
  assert.deepEqual(dryRun.tombstonedByKind, { activity_session: 2 });
  assert.equal(
    (await readJsonlRecords({ vaultRoot, relativePath: shardPath })).length,
    3,
    "dry run must not write",
  );

  const applied = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });

  assert.equal(applied.applied, true);
  assert.equal(applied.duplicateGroupCount, 1);
  assert.equal(applied.tombstonedEventCount, 2);
  assert.ok(applied.auditPath);

  const records = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const deletedIds = new Set(
    records.filter((record) => record.lifecycle?.state === "deleted").map((record) => record.id),
  );
  const liveIds = new Set(records.map((record) => record.id).filter((id) => !deletedIds.has(id)));

  assert.equal(records.length, 5, "expected 3 originals + 2 tombstones");
  assert.deepEqual([...liveIds], [keptId]);

  // Idempotent: a second pass finds nothing.
  const second = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });
  assert.equal(second.tombstonedEventCount, 0);
  assert.equal(second.duplicateGroupCount, 0);
  assert.equal(second.applied, false);

  // And the importer keeps deduping against the surviving copy afterwards.
  const replay = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_b",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  assert.equal(replay.events[0]?.id, keptId);
  assert.equal(
    (await readJsonlRecords({ vaultRoot, relativePath: shardPath })).length,
    5,
    "replay after cleanup must not append",
  );
});

test("dedupeDeviceEventsByExternalRef leaves distinct records and non-device events alone", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-dedupe-noop");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent(),
      buildJunctionStyleWorkoutEvent({ resourceId: "workouts-other" }),
      {
        kind: "note",
        occurredAt: "2026-06-03T19:55:00.000Z",
        recordedAt: "2026-06-03T20:30:00.000Z",
        note: "no external ref",
      },
    ],
  });

  const result = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });

  assert.equal(result.duplicateGroupCount, 0);
  assert.equal(result.tombstonedEventCount, 0);
  assert.equal(result.scannedLiveDeviceEventCount, 2);
});

test("dedupeDeviceEventsByExternalRef keeps the highest-revision duplicate and skips already-tombstoned copies", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-dedupe-revision-winner");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { id: "workouts-stable", sport: "running" },
    }],
  } as const;
  const first = await importDeviceBatch(input);
  const loserId = first.events[0]?.id as string;
  const shardPath = first.eventShardPaths[0] as string;
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;

  // A churn duplicate that was later superseded in place (revision 2). Its
  // recordedAt is older than the rev-1 copy's, so revision priority — not
  // recordedAt — must decide the surviving copy.
  const supersededId = "evt_0000000000000000000000DP31";
  await fs.appendFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify({ ...stored, id: supersededId, recordedAt: "2026-06-01T07:00:00.000Z" })}\n`
      + `${JSON.stringify({ ...stored, id: supersededId, recordedAt: "2026-06-01T08:00:00.000Z", lifecycle: { revision: 2 } })}\n`,
  );

  // A third duplicate already tombstoned by a partial prior cleanup: it must
  // stay deleted and stay out of the live grouping.
  const priorTombstonedId = "evt_0000000000000000000000DP32";
  await fs.appendFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify({ ...stored, id: priorTombstonedId, recordedAt: "2026-06-01T09:00:00.000Z" })}\n`
      + `${JSON.stringify({ ...stored, id: priorTombstonedId, recordedAt: "2026-06-02T09:00:00.000Z", lifecycle: { revision: 2, state: "deleted" } })}\n`,
  );

  const applied = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });

  assert.equal(
    applied.scannedLiveDeviceEventCount,
    2,
    "already-tombstoned duplicate must not count as live",
  );
  assert.equal(applied.duplicateGroupCount, 1);
  assert.equal(applied.tombstonedEventCount, 1);

  const records = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const deletedIds = new Set(
    records.filter((record) => record.lifecycle?.state === "deleted").map((record) => record.id),
  );
  const liveIds = new Set(records.map((record) => record.id).filter((id) => !deletedIds.has(id)));

  assert.deepEqual([...liveIds], [supersededId], "the revision-2 copy must survive");
  assert.ok(deletedIds.has(loserId), "the rev-1 copy with the latest recordedAt must be tombstoned");
  const loserTombstone = records.find(
    (record) => record.id === loserId && record.lifecycle?.state === "deleted",
  );
  assert.equal(loserTombstone?.lifecycle?.revision, 2);
  assert.equal(
    records.filter((record) => record.id === priorTombstonedId).length,
    2,
    "already-tombstoned duplicate must not be tombstoned again",
  );

  const associationRepair = await importDeviceBatch(input);
  assert.ok(associationRepair.applied);
  assert.notEqual(associationRepair.ingestId, first.ingestId);
  assert.equal(associationRepair.events[0]?.id, supersededId);
  assert.deepEqual(
    (await listIntegrationIngestsForEvent(vaultRoot, supersededId)).map((entry) => entry.record.id),
    [associationRepair.ingestId],
  );
  const beforeConvergedReplay = await fs.readFile(path.join(vaultRoot, associationRepair.ingestShardPath));
  const convergedReplay = await importDeviceBatch(input);
  assert.equal(convergedReplay.applied, false);
  assert.deepEqual(
    await fs.readFile(path.join(vaultRoot, associationRepair.ingestShardPath)),
    beforeConvergedReplay,
  );
});

test("stale WHOOP replay stays bounded for a huge stored lifecycle revision", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-huge-revision-completeness");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const buildWhoopEvent = (version: string, value: number) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-03T20:30:00.000Z",
    recordedAt: "2026-06-03T20:30:00.000Z",
    title: "WHOOP recovery",
    externalRef: {
      system: "whoop",
      resourceType: "recovery",
      resourceId: "huge-revision-recovery",
      version,
      facet: "score",
    },
    fields: {
      metric: "recovery-score",
      value,
      unit: "%",
    },
  });
  const input = {
    vaultRoot,
    provider: "whoop",
    accountId: "whoop_huge_revision",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      buildWhoopEvent("2026-06-03T20:30:00.000Z", 68),
      buildWhoopEvent("2026-06-04T20:30:00.000Z", 72),
    ],
  } as const;
  const accepted = await importDeviceBatch(input);
  const eventShardPath = accepted.eventShardPaths[0];
  assert.ok(eventShardPath);
  const storedRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  })) as EventRecord[];
  const newer = storedRows.find((record) =>
    record.externalRef?.version === "2026-06-04T20:30:00.000Z"
  );
  assert.ok(newer);
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `${JSON.stringify({
      ...newer,
      lifecycle: { revision: 1_000_000_000_000 },
    })}\n`,
    "utf8",
  );
  const beforeReplay = await snapshotVaultFiles(vaultRoot);

  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeReplay);
});

test("exact replay does not relink evidence to a different-content dedupe survivor", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-distinct-dedupe-survivor");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { id: "workouts-stable", sport: "running" },
    }],
  } as const;
  const first = await importDeviceBatch(input);
  const originalId = first.events[0]?.id as string;
  const shardPath = first.eventShardPaths[0] as string;
  const ingestShardPath = first.ingestShardPath;
  if (!ingestShardPath) {
    throw new Error("expected initial import to write an ingest shard");
  }
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;
  const survivorId = "evt_0000000000000000000000DP35";
  await fs.appendFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify({
      ...stored,
      id: survivorId,
      durationMinutes: 40,
      recordedAt: "2026-06-01T08:00:00.000Z",
      lifecycle: { revision: 2 },
    })}\n`,
  );
  const dedupe = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });
  assert.ok(dedupe.applied);
  const auditPath = dedupe.auditPath;
  if (!auditPath) {
    throw new Error("expected applied dedupe to write an audit record");
  }
  const afterDedupe = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  assert.ok(afterDedupe.some((record) =>
    record.id === originalId && record.lifecycle?.state === "deleted"
  ));

  const watchedPaths = [shardPath, ingestShardPath, auditPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  const replay = await importDeviceBatch(input);

  assert.equal(replay.applied, false);
  assert.deepEqual(replay.events, []);
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );
  assert.deepEqual(await listIntegrationIngestsForEvent(vaultRoot, survivorId), []);
});

test("exact delayed replay rejects unrelated historical output owners and roles", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-protected-unrelated-output");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const evidenceRole = "junction-summary-workouts";
  const unrelatedEvidenceRole = "junction-summary-unrelated-role";
  const buildInput = (input: {
    importedAt: string;
    sourceVersion: string;
    durationMinutes: number;
  }) => ({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: input.importedAt,
    events: [{
      ...buildJunctionStyleWorkoutEvent({ durationMinutes: input.durationMinutes }),
      externalRef: {
        ...buildJunctionStyleWorkoutEvent().externalRef,
        version: input.sourceVersion,
      },
      evidenceRoles: [evidenceRole],
    }],
    evidenceParts: [
      {
        role: evidenceRole,
        fileName: "junction-summary-workouts.json",
        content: { durationMinutes: input.durationMinutes, version: input.sourceVersion },
      },
      {
        role: unrelatedEvidenceRole,
        fileName: "junction-summary-unrelated.json",
        content: { unrelated: true, version: input.sourceVersion },
      },
    ],
  });
  const v1Input = buildInput({
    importedAt: "2026-06-03T21:00:00.000Z",
    sourceVersion: "2026-06-03T20:30:00.000Z",
    durationMinutes: 34,
  });
  const v2Input = buildInput({
    importedAt: "2026-06-04T21:00:00.000Z",
    sourceVersion: "2026-06-04T20:30:00.000Z",
    durationMinutes: 35,
  });
  const v1 = await importDeviceBatch(v1Input);
  const unrelated = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-05-02T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent({
      occurredAt: "2026-05-02T19:55:00.000Z",
      recordedAt: "2026-05-02T20:30:00.000Z",
      resourceId: "workout-unrelated-protected-output",
    })],
  });
  const v2 = await importDeviceBatch(v2Input);
  assert.ok(v1.ingestId);
  assert.ok(v1.ingestShardPath);
  assert.ok(v1.auditPath);
  assert.ok(v2.auditPath);
  const unrelatedId = unrelated.events[0]?.id;
  assert.ok(unrelatedId);
  const ingestRows = (await readJsonlRecords({
    vaultRoot,
    relativePath: v1.ingestShardPath,
  })) as IntegrationIngestRecord[];
  const storedV1 = ingestRows.find((record) => record.id === v1.ingestId);
  assert.ok(storedV1);
  const [storedOutput] = storedV1.outputs.events;
  assert.ok(storedOutput);
  const corruptedV1: IntegrationIngestRecord = {
    ...storedV1,
    outputs: {
      ...storedV1.outputs,
      events: [{ ...storedOutput, id: unrelatedId }],
    },
  };
  await fs.writeFile(
    path.join(vaultRoot, v1.ingestShardPath),
    ingestRows
      .map((record) => JSON.stringify(record.id === v1.ingestId ? corruptedV1 : record))
      .join("\n") + "\n",
    "utf8",
  );
  const watchedPaths = [...new Set([
    v1.ingestShardPath,
    ...v1.eventShardPaths,
    ...unrelated.eventShardPaths,
    v1.auditPath,
    v2.auditPath,
  ])];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  await assert.rejects(
    importDeviceBatch(v1Input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );

  const wrongRoleV1: IntegrationIngestRecord = {
    ...storedV1,
    outputs: {
      ...storedV1.outputs,
      events: [{ ...storedOutput, roles: [unrelatedEvidenceRole] }],
    },
  };
  await fs.writeFile(
    path.join(vaultRoot, v1.ingestShardPath),
    ingestRows
      .map((record) => JSON.stringify(record.id === v1.ingestId ? wrongRoleV1 : record))
      .join("\n") + "\n",
    "utf8",
  );
  const beforeWrongRoleReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );
  await assert.rejects(
    importDeviceBatch(v1Input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeWrongRoleReplay,
  );
});

test("exact repair does not give a protected survivor output to a missing same-role event", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-protected-output-owner-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const evidenceRole = "junction-summary-workouts";
  const input = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-protected-e1" }),
        evidenceRoles: [evidenceRole],
      },
      {
        ...buildJunctionStyleWorkoutEvent({ resourceId: "workout-missing-e2" }),
        evidenceRoles: [evidenceRole],
      },
    ],
    evidenceParts: [{
      role: evidenceRole,
      fileName: "junction-summary-workouts.json",
      content: { ids: ["workout-protected-e1", "workout-missing-e2"] },
    }],
  } as const;
  const first = await importDeviceBatch(input);
  assert.ok(first.applied);
  assert.ok(first.ingestId);
  assert.ok(first.ingestShardPath);
  const eventPath = first.eventShardPaths[0];
  assert.ok(eventPath);
  const originalRows = (await readJsonlRecords({ vaultRoot, relativePath: eventPath })) as EventRecord[];
  const e1 = originalRows.find((record) => record.externalRef?.resourceId === "workout-protected-e1");
  const e2 = originalRows.find((record) => record.externalRef?.resourceId === "workout-missing-e2");
  assert.ok(e1);
  assert.ok(e2);
  const survivorId = deterministicContractId("evt", "protected-different-content-survivor");
  await fs.appendFile(
    path.join(vaultRoot, eventPath),
    `${JSON.stringify({
      ...e1,
      id: survivorId,
      durationMinutes: 40,
      recordedAt: "2026-06-03T20:31:00.000Z",
      lifecycle: { revision: 2 },
    })}\n`,
  );
  const dedupe = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });
  assert.ok(dedupe.applied);
  const afterDedupe = (await readJsonlRecords({ vaultRoot, relativePath: eventPath })) as EventRecord[];
  assert.ok(afterDedupe.some((record) =>
    record.id === e1.id && record.lifecycle?.state === "deleted"
  ));
  assert.ok(afterDedupe.some((record) =>
    record.id === survivorId
    && record.lifecycle?.state !== "deleted"
    && record.kind === "activity_session"
    && record.durationMinutes === 40
  ));
  await fs.writeFile(
    path.join(vaultRoot, eventPath),
    afterDedupe
      .filter((record) => record.id !== e2.id)
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
    "utf8",
  );
  const stored = await readRequiredIntegrationIngest(vaultRoot, first.ingestId);
  const e1Output = stored.outputs.events.find((output) => output.id === e1.id);
  assert.ok(e1Output);
  const retainedE1Delivery: IntegrationIngestRecord = {
    ...stored,
    outputs: { ...stored.outputs, events: [e1Output] },
    counts: { ...stored.counts, eventCount: 1 },
  };
  await fs.writeFile(
    path.join(vaultRoot, first.ingestShardPath),
    `${JSON.stringify(retainedE1Delivery)}\n`,
    "utf8",
  );
  const watchedPaths = [eventPath, first.ingestShardPath];
  const beforeReplay = await Promise.all(
    watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
  );

  await assert.rejects(
    importDeviceBatch(input),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(
    await Promise.all(
      watchedPaths.map((relativePath) => fs.readFile(path.join(vaultRoot, relativePath))),
    ),
    beforeReplay,
  );
});

test("exact multi-event replay repairs a safe association without reverting another event", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-mixed-association-safety");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const originalInput = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({ resourceId: "workout-association-move" }),
      buildJunctionStyleWorkoutEvent({ resourceId: "workout-later-correction" }),
    ],
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { ids: ["workout-association-move", "workout-later-correction"] },
    }],
  } as const;
  const first = await importDeviceBatch(originalInput);
  const shardPath = first.eventShardPaths[0] as string;
  const originalRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: shardPath,
  })) as EventRecord[];
  const movedOriginal = originalRecords.find(
    (record) => record.externalRef?.resourceId === "workout-association-move",
  );
  assert.ok(movedOriginal);
  const survivorId = "evt_0000000000000000000000DP36";
  await fs.appendFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify({
      ...movedOriginal,
      id: survivorId,
      recordedAt: "2026-06-01T08:00:00.000Z",
      lifecycle: { revision: 2 },
    })}\n`,
  );
  await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });
  const corrected = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent({
      resourceId: "workout-later-correction",
      durationMinutes: 50,
    })],
  });
  assert.equal(
    corrected.events[0]?.kind === "activity_session"
      ? corrected.events[0].durationMinutes
      : undefined,
    50,
  );
  const beforeReplay = await fs.readFile(path.join(vaultRoot, shardPath));

  const replay = await importDeviceBatch(originalInput);
  const converged = await importDeviceBatch(originalInput);

  assert.ok(replay.applied);
  assert.deepEqual(replay.events.map((event) => event.id), [survivorId]);
  assert.deepEqual(await fs.readFile(path.join(vaultRoot, shardPath)), beforeReplay);
  assert.equal((await listIntegrationIngestsForEvent(vaultRoot, survivorId)).length, 1);
  assert.equal(converged.applied, false);
  assert.deepEqual(converged.events.map((event) => event.id), [survivorId]);
});

test("exact mixed replay rejects a completely missing owner without reverting a protected event", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-mixed-output-repair");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });
  const originalInput = {
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent({ resourceId: "workout-missing-output" }),
      buildJunctionStyleWorkoutEvent({ resourceId: "workout-protected-output" }),
    ],
    samples: [{
      stream: "hrv",
      recordedAt: "2026-06-03T07:30:00.000Z",
      unit: "ms",
      quality: "normalized",
      externalRef: {
        system: "junction",
        resourceType: "junction-whoop-recovery",
        resourceId: "recovery-missing-output",
        facet: "hrv",
      },
      sample: {
        recordedAt: "2026-06-03T07:30:00.000Z",
        value: 42.5,
      },
    }],
    evidenceParts: [{
      role: "junction-summary-workouts",
      fileName: "junction-summary-workouts.json",
      content: { ids: ["workout-missing-output", "workout-protected-output"] },
    }],
  } as const;
  const first = await importDeviceBatch(originalInput);
  const eventShardPath = first.eventShardPaths[0] as string;
  const sampleShardPath = first.sampleShardPaths[0] as string;
  const originalEvents = (await readJsonlRecords({
    vaultRoot,
    relativePath: eventShardPath,
  })) as EventRecord[];
  const missingEvent = originalEvents.find(
    (record) => record.externalRef?.resourceId === "workout-missing-output",
  );
  const protectedEvent = originalEvents.find(
    (record) => record.externalRef?.resourceId === "workout-protected-output",
  );
  assert.ok(missingEvent);
  assert.ok(protectedEvent);
  await fs.writeFile(
    path.join(vaultRoot, eventShardPath),
    `${JSON.stringify(protectedEvent)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(vaultRoot, sampleShardPath), "", "utf8");
  await upsertEvent({
    vaultRoot,
    payload: { ...protectedEvent, note: "protected user edit", source: "manual" },
  });

  const beforeRejectedRepair = await snapshotVaultFiles(vaultRoot);
  await assert.rejects(
    importDeviceBatch(originalInput),
    (error) =>
      error instanceof VaultError
      && error.code === "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
  );
  assert.deepEqual(await snapshotVaultFiles(vaultRoot), beforeRejectedRepair);
});

test("dedupeDeviceEventsByExternalRef does not cross-tombstone distinct facets sharing one resourceId", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-dedupe-facets");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const buildFacetObservation = (facet: string, value: number) => ({
    kind: "observation" as const,
    occurredAt: "2026-06-03T07:30:00.000Z",
    recordedAt: "2026-06-03T07:30:00.000Z",
    title: `Junction ${facet}`,
    externalRef: {
      system: "junction",
      resourceType: "junction-whoop-v2-recovery",
      resourceId: "recovery-1",
      facet,
    },
    fields: {
      metric: facet,
      value,
      unit: "%",
    },
  });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildFacetObservation("recovery-score", 67),
      buildFacetObservation("skin-temp-deviation", 3),
    ],
  });
  const shardPath = first.eventShardPaths[0] as string;

  // Only the recovery-score facet has a legacy churn duplicate; the
  // skin-temp-deviation facet shares the resourceId and must stay untouched.
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const recoveryScore = stored.find(
    (record) => record.externalRef?.facet === "recovery-score",
  ) as EventRecord;
  const duplicateId = "evt_0000000000000000000000DP33";
  await fs.appendFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify({ ...recoveryScore, id: duplicateId, recordedAt: "2026-06-01T07:00:00.000Z" })}\n`,
  );

  const applied = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });

  assert.equal(applied.scannedLiveDeviceEventCount, 3);
  assert.equal(applied.duplicateGroupCount, 1);
  assert.equal(applied.tombstonedEventCount, 1);

  const records = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
  const deletedIds = new Set(
    records.filter((record) => record.lifecycle?.state === "deleted").map((record) => record.id),
  );
  const liveFacets = records
    .filter((record) => !deletedIds.has(record.id))
    .map((record) => record.externalRef?.facet)
    .sort();

  assert.deepEqual(deletedIds, new Set([duplicateId]));
  assert.deepEqual(liveFacets, ["recovery-score", "skin-temp-deviation"]);
});

test("dedupeDeviceEventsByExternalRef cleans duplicates across monthly shards in one apply", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-dedupe-multishard");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const june = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const july = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-07-03T21:00:00.000Z",
    events: [
      {
        ...buildJunctionStyleWorkoutEvent({
          recordedAt: "2026-07-03T20:30:00.000Z",
          resourceId: "workouts-july-7a51",
        }),
        occurredAt: "2026-07-03T19:55:00.000Z",
      },
    ],
  });
  const juneShard = june.eventShardPaths[0] as string;
  const julyShard = july.eventShardPaths[0] as string;
  assert.notEqual(juneShard, julyShard, "expected the July event to land in a second monthly shard");

  const juneDuplicateId = "evt_0000000000000000000000DP41";
  const julyDuplicateId = "evt_0000000000000000000000DP42";
  for (const [shardPath, duplicateId] of [
    [juneShard, juneDuplicateId],
    [julyShard, julyDuplicateId],
  ] as const) {
    const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;
    await fs.appendFile(
      path.join(vaultRoot, shardPath),
      `${JSON.stringify({ ...stored, id: duplicateId, recordedAt: "2026-05-30T07:00:00.000Z" })}\n`,
    );
  }

  const dryRun = await dedupeDeviceEventsByExternalRef({ vaultRoot });

  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.duplicateGroupCount, 2);
  assert.equal(dryRun.tombstonedEventCount, 2);
  assert.deepEqual(dryRun.shardPaths, [juneShard, julyShard].sort());

  const applied = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });

  assert.equal(applied.applied, true);
  assert.equal(applied.duplicateGroupCount, 2);
  assert.equal(applied.tombstonedEventCount, 2);
  assert.deepEqual(applied.shardPaths, [juneShard, julyShard].sort());
  assert.ok(applied.auditPath);

  // Both shards got their tombstone in the single canonical write.
  for (const [shardPath, duplicateId, keptId] of [
    [juneShard, juneDuplicateId, june.events[0]?.id as string],
    [julyShard, julyDuplicateId, july.events[0]?.id as string],
  ] as const) {
    const records = (await readJsonlRecords({ vaultRoot, relativePath: shardPath })) as EventRecord[];
    assert.equal(records.length, 3, `expected original + duplicate + tombstone in ${shardPath}`);
    const deletedIds = new Set(
      records.filter((record) => record.lifecycle?.state === "deleted").map((record) => record.id),
    );
    assert.deepEqual(deletedIds, new Set([duplicateId]));
    assert.ok(records.some((record) => record.id === keptId));
  }

  // One audit record covers both shards.
  const auditRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: applied.auditPath as string,
  })) as AuditRecord[];
  const dedupeAudits = auditRecords.filter(
    (record) => record.commandName === "core.dedupeDeviceEventsByExternalRef",
  );
  assert.equal(dedupeAudits.length, 1, "expected one audit record for the whole apply");
  assert.equal(dedupeAudits[0]?.action, "event_delete");
  assert.deepEqual(
    [...(dedupeAudits[0]?.targetIds ?? [])].sort(),
    [juneDuplicateId, julyDuplicateId].sort(),
  );
  const auditChangePaths = dedupeAudits[0]?.changes.map((change) => change.path) ?? [];
  assert.ok(auditChangePaths.includes(juneShard), "audit must reference the June shard");
  assert.ok(auditChangePaths.includes(julyShard), "audit must reference the July shard");

  const second = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });
  assert.equal(second.tombstonedEventCount, 0);
  assert.equal(second.applied, false);
});

test("dedupeDeviceEventsByExternalRef leaves duplicates with invisible later revisions untouched", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-dedupe-revised-elsewhere");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
  const shardPath = first.eventShardPaths[0] as string;
  const stored = (await readJsonlRecords({ vaultRoot, relativePath: shardPath }))[0] as EventRecord;

  // Legacy churn duplicate, then a user edit of that duplicate through the
  // generic event spine that dropped both source and externalRef: the edit
  // revision is invisible to the device-filtered dedupe scan.
  const duplicateId = "evt_0000000000000000000000DP41";
  await fs.appendFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify({ ...stored, id: duplicateId, recordedAt: "2026-06-02T07:00:00.000Z" })}\n`,
  );
  const { externalRef: _externalRef, ...editedBase } = stored;
  await fs.appendFile(
    path.join(vaultRoot, shardPath),
    `${JSON.stringify({
      ...editedBase,
      id: duplicateId,
      source: "manual",
      note: "user-curated copy",
      lifecycle: { revision: 2 },
    })}\n`,
  );

  const result = await dedupeDeviceEventsByExternalRef({ vaultRoot, apply: true });

  assert.equal(result.tombstonedEventCount, 0);
  assert.equal(result.skippedRevisedElsewhereCount, 1);
  assert.equal(
    (await readJsonlRecords({ vaultRoot, relativePath: shardPath })).length,
    3,
    "the edited duplicate must be left for manual review, not tombstoned",
  );
});
