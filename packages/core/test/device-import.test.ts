import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import type { AuditRecord, EventRecord, SampleRecord } from "@murphai/contracts";

import {
  importDeviceBatch,
  initializeVault,
  readJsonlRecords,
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
