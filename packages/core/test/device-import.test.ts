import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import type { AuditRecord, EventRecord, SampleRecord } from "@murphai/contracts";

import {
  dedupeDeviceEventsByExternalRef,
  deleteEvent,
  findEventByExternalRef,
  importDeviceBatch,
  initializeVault,
  readJsonlRecords,
  repairJunctionWorkoutHeartRateZones,
  VaultError,
} from "../src/index.ts";
import { prepareInlineRawArtifact, prepareRawArtifact } from "../src/raw.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

interface DeviceImportManifest {
  importId: string;
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
    rawArtifacts?: Array<{
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

function invalidTestValue<T>(value: unknown): T {
  return value as T;
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
        rawArtifactRoles: ["sleep:sleep-1"],
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
        rawArtifactRoles: ["recovery:sleep-1"],
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
    rawArtifacts: [
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

  assert.equal(result.importId, "xfm_FKXWJ9CRVED58RA9QVF2QHA1WE");
  assert.equal(result.events.length, 2);
  assert.equal(result.samples.length, 1);
  assert.equal(result.rawArtifacts.length, 2);
  assert.equal(result.provider, "whoop");
  assert.equal(result.accountId, "whoop-user-1");
  assert.deepEqual(
    result.events.map((record) => record.id),
    ["evt_KBKEHWQT2XXW0K5XZCS1T5X9KA", "evt_S5K01TSPA86JJVS1DWVHT9RRZ1"],
  );
  assert.deepEqual(result.samples.map((record) => record.id), ["smp_VJ3AZR2JBQVE89Z6B84EA60H0G"]);
  assert.equal(
    result.rawArtifacts[0]?.relativePath,
    "raw/integrations/whoop/2026/03/xfm_FKXWJ9CRVED58RA9QVF2QHA1WE/01-sleep-sleep-1.json",
  );
  const sleepRawText = await fs.readFile(
    path.join(vaultRoot, result.rawArtifacts[0]?.relativePath ?? ""),
    "utf8",
  );
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
  const manifest = await readDeviceImportManifest(vaultRoot, result.manifestPath);

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
      rawRefs: [
        "raw/integrations/whoop/2026/03/xfm_FKXWJ9CRVED58RA9QVF2QHA1WE/01-sleep-sleep-1.json",
      ],
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
      rawRefs: [
        "raw/integrations/whoop/2026/03/xfm_FKXWJ9CRVED58RA9QVF2QHA1WE/02-recovery-sleep-1.json",
      ],
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
  assert.deepEqual(auditRecords.at(-1)?.targetIds, [result.importId]);
  assert.equal(manifest.importKind, "device_batch");
  assert.equal(manifest.artifacts.length, 2);
  assert.equal(path.posix.dirname(manifest.artifacts[0]?.relativePath ?? ""), manifest.rawDirectory);
  assert.equal(manifest.provenance.eventCount, 2);
  assert.equal(manifest.provenance.sampleCount, 1);
  assert.deepEqual(manifest.provenance.operatorMetadata, {
    syncMode: "test",
  });
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
        rawArtifactRoles: ["daily-summary:2026-03-15"],
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
    rawArtifacts: [
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

  assert.equal(result.events[0]?.dayKey, "2026-03-15");
  assert.equal(result.events[0]?.timeZone, "America/Los_Angeles");
  assert.equal(result.samples[0]?.dayKey, "2026-03-14");
  assert.equal(result.samples[0]?.timeZone, "America/Los_Angeles");
  assert.ok(
    result.rawArtifacts.some(
      (artifact) => artifact.relativePath.endsWith("02-activity-1-fit-descriptor.json"),
    ),
  );
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
    rawArtifacts: [
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
    rawArtifacts: [
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

  const manifest = await readDeviceImportManifest(vaultRoot, result.manifestPath);

  assert.equal(manifest.provenance.provider, "whoop");
  assert.equal(manifest.provenance.accountId, "whoop-user-1");
  assert.equal(manifest.provenance.importedAt, "2026-03-16T09:30:00.000Z");
  assert.equal(manifest.provenance.eventCount, result.events.length);
  assert.equal(manifest.provenance.sampleCount, result.samples.length);
  assert.equal(manifest.provenance.rawArtifacts?.length, 1);
  assert.equal(manifest.provenance.rawArtifacts?.[0]?.role, "recovery:sleep-1");
  assert.equal(
    manifest.provenance.rawArtifacts?.[0]?.relativePath,
    result.rawArtifacts[0]?.relativePath,
  );
  assert.notEqual(
    manifest.provenance.rawArtifacts?.[0]?.sha256,
    attemptedOverrides.rawArtifacts[0]?.sha256,
  );
  assert.deepEqual(manifest.provenance.rawArtifacts?.[0]?.metadata, {
    upstreamId: "sleep-1",
  });
  assert.deepEqual(manifest.provenance.operatorMetadata, attemptedOverrides);
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
    rawArtifacts: [
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

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];
  const sampleRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.sampleShardPaths[0] as string,
  })) as SampleRecord[];

  assert.equal(first.importId, second.importId);
  assert.equal(first.events[0]?.id, second.events[0]?.id);
  assert.equal(first.samples[0]?.id, second.samples[0]?.id);
  assert.equal(first.importId, "xfm_RHGFGAXGDZ3G4JXMSCZVWQSV2E");
  assert.equal(first.events[0]?.id, "evt_30XC16ZG27S0ZM4TMPHDKJX7KP");
  assert.equal(first.samples[0]?.id, "smp_VJ3AZR2JBQVE89Z6B84EA60H0G");
  assert.equal(eventRecords.length, 1);
  assert.equal(sampleRecords.length, 1);
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
    rawArtifacts: [
      {
        content: {
          upstream: "payload",
        },
      },
    ],
  });

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.eventShardPaths[0] as string,
  })) as EventRecord[];
  const manifest = await readDeviceImportManifest(vaultRoot, result.manifestPath);

  assert.equal(result.importId, "xfm_SE4B94MXKQGEHK68NEVFXAFY4K");
  assert.equal(result.events[0]?.id, "evt_2TSF1SDWFHHSQ8503JWDHCF47K");
  assert.equal(eventRecords[0]?.kind, "note");
  assert.deepEqual(eventRecords[0]?.rawRefs, [result.rawArtifacts[0]?.relativePath]);
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
      rawRefs: ["raw/integrations/whoop/2026/03/xfm_SE4B94MXKQGEHK68NEVFXAFY4K/01-whoop-01.json"],
    },
  ]);
  assert.equal(manifest.artifacts[0]?.role, "artifact-1");
  assert.equal(manifest.artifacts[0]?.originalFileName, "whoop-01.json");
});

test("importDeviceBatch writes Date raw artifact values as ISO strings", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-date-raw");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    importedAt: "2026-04-22T12:00:00.000Z",
    rawArtifacts: [
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

  const rawText = await fs.readFile(
    path.join(vaultRoot, result.rawArtifacts[0]?.relativePath ?? ""),
    "utf8",
  );

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
        rawArtifacts: [
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
        rawArtifactRoles: ["wearable-raw-receipt:wearable_raw_test"],
      },
    ],
    rawArtifacts: [
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

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(eventRecords[0]?.title, "implicit receipt fallback");
  assert.equal(Object.hasOwn(eventRecords[0] ?? {}, "rawRefs"), false);
  assert.deepEqual(eventRecords[1]?.rawRefs, [result.rawArtifacts[0]?.relativePath]);
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

  assert.equal(result.importId, "xfm_569JB3S5YXQTP6A255JC82WJDP");
  assert.equal(result.samples[0]?.id, "smp_Z2ZBJH4EBC7QVGQ5CQ8G95M8R4");
  assert.equal(result.manifestPath, "");
  assert.equal(result.rawArtifacts.length, 0);
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
            rawArtifactRoles: ["missing"],
          },
        ],
        rawArtifacts: [
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
        rawArtifacts: [
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
        rawArtifacts: [
          { role: "dup", content: { one: true } },
          { role: "dup", content: { two: true } },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_DUPLICATE_RAW_ROLE",
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
            rawArtifactRoles: ["missing"],
          },
        ],
        rawArtifacts: [
          { role: "other", content: { payload: true } },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_RAW_ROLE_MISSING",
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
        rawArtifacts: [
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
        rawArtifacts: [
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
        rawArtifacts: [
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
    occurredAt: "2026-06-03T19:55:00.000Z",
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
    rawArtifacts: [
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
    rawArtifacts: [
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
    rawArtifacts: [
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
    rawArtifacts: [
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

test("repairJunctionWorkoutHeartRateZones tolerates a torn JSONL line in the event ledger", async () => {
  // readJsonlRecords used to throw on the first unparsable line. The repair
  // must survive a torn write or other partially corrupt JSONL row and still
  // act on valid Junction workout candidates in the same shard.
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
    rawArtifacts: [
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

  assert.equal(applied.candidateCount, 1);
  assert.equal(applied.repairedCount, 1);
  assert.equal(applied.mutated, true);
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
    rawArtifacts: [
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
    rawArtifacts: [
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
    rawArtifacts: [
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
    rawArtifacts: [
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
    rawArtifacts: [
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
      },
    ],
  });

  const first = await importDeviceBatch(buildInput("jxn_acct_same"));
  const second = await importDeviceBatch(buildInput("jxn_acct_same"));

  const eventRecords = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(eventRecords.length, 1);
  assert.equal(second.events[0]?.id, first.events[0]?.id);
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
      buildJunctionStyleWorkoutEvent({ resourceId: "workouts-aaa" }),
      buildJunctionStyleWorkoutEvent({ resourceId: "workouts-bbb" }),
    ],
  });
  const second = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-04T21:00:00.000Z",
    events: [
      // Unchanged duplicate of workouts-aaa.
      buildJunctionStyleWorkoutEvent({ resourceId: "workouts-aaa" }),
      // Changed content for workouts-bbb.
      buildJunctionStyleWorkoutEvent({ resourceId: "workouts-bbb", durationMinutes: 41 }),
      // Brand-new provider record.
      buildJunctionStyleWorkoutEvent({ resourceId: "workouts-ccc" }),
    ],
  });

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

  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: first.eventShardPaths[0] as string,
  })) as EventRecord[];

  assert.equal(rescored.events[0]?.id, first.events[0]?.id);
  assert.equal(rescored.events[0]?.lifecycle?.revision, 2);
  assert.equal(replay.events[0]?.id, first.events[0]?.id);
  assert.equal(records.length, 2, "expected original + one supersede, no duplicate live events");
  assert.equal(new Set(records.map((record) => record.id)).size, 1);
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
    note: "user-added context",
    lifecycle: { revision: 2 },
  };
  await fs.appendFile(path.join(vaultRoot, shardPath), `${JSON.stringify(edited)}\n`);

  // A changed provider re-delivery must take revision 3, not collide with the
  // edit's revision 2.
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

test("importDeviceBatch supersedes an in-batch fresh record when a later entry changes it", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-inbatch-supersede");
  await initializeVault({ vaultRoot, createdAt: "2026-06-01T12:00:00.000Z" });

  // One batch carries the same provider record twice with different content
  // (e.g. merged overlapping bundles): the second entry must supersede the
  // first as a spine revision inside the same append plan.
  const result = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_stable",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [
      buildJunctionStyleWorkoutEvent(),
      buildJunctionStyleWorkoutEvent({
        recordedAt: "2026-06-03T22:00:00.000Z",
        durationMinutes: 36,
      }),
    ],
  });

  const records = (await readJsonlRecords({
    vaultRoot,
    relativePath: result.eventShardPaths[0] as string,
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

  const first = await importDeviceBatch({
    vaultRoot,
    provider: "junction",
    accountId: "jxn_acct_a",
    importedAt: "2026-06-03T21:00:00.000Z",
    events: [buildJunctionStyleWorkoutEvent()],
  });
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
