import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import type { AuditRecord, EventRecord, SampleRecord } from "@murph/contracts";

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

const TEST_TIMEZONE = "UTC";

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
    eventIds?: string[];
    sampleIds?: string[];
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

test("importDeviceBatch writes inline raw integration payloads and canonical records", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

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

  assert.equal(result.importId, "xfm_VEENN6TG6H7NCF8DSKM5JX386M");
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
    "raw/integrations/whoop/2026/03/xfm_VEENN6TG6H7NCF8DSKM5JX386M/01-sleep-sleep-1.json",
  );

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
        "raw/integrations/whoop/2026/03/xfm_VEENN6TG6H7NCF8DSKM5JX386M/01-sleep-sleep-1.json",
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
        "raw/integrations/whoop/2026/03/xfm_VEENN6TG6H7NCF8DSKM5JX386M/02-recovery-sleep-1.json",
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
  assert.equal(manifest.importKind, "device_batch");
  assert.equal(manifest.artifacts.length, 2);
  assert.equal(path.posix.dirname(manifest.artifacts[0]?.relativePath ?? ""), manifest.rawDirectory);
  assert.deepEqual(manifest.provenance.eventIds, [
    "evt_KBKEHWQT2XXW0K5XZCS1T5X9KA",
    "evt_S5K01TSPA86JJVS1DWVHT9RRZ1",
  ]);
  assert.deepEqual(manifest.provenance.sampleIds, ["smp_VJ3AZR2JBQVE89Z6B84EA60H0G"]);
  assert.deepEqual(manifest.provenance.operatorMetadata, {
    syncMode: "test",
  });
});

test("importDeviceBatch keeps canonical manifest provenance authoritative over caller overrides", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-provenance");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

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
  assert.deepEqual(manifest.provenance.eventIds, result.events.map((record) => record.id));
  assert.deepEqual(manifest.provenance.sampleIds, result.samples.map((record) => record.id));
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
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

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

  const first = await importDeviceBatch(input);
  const second = await importDeviceBatch(input);

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
  assert.equal(first.importId, "xfm_BP6SP2P5FJ4YNF8PY8H0QZQT32");
  assert.equal(first.events[0]?.id, "evt_30XC16ZG27S0ZM4TMPHDKJX7KP");
  assert.equal(first.samples[0]?.id, "smp_VJ3AZR2JBQVE89Z6B84EA60H0G");
  assert.equal(eventRecords.length, 1);
  assert.equal(sampleRecords.length, 1);
});

test("importDeviceBatch falls back to the sole raw artifact when events omit explicit roles", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-single-raw");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

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

  assert.equal(result.importId, "xfm_E8RCCMNW9E4JGGQRXAK42GRACG");
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
      rawRefs: ["raw/integrations/whoop/2026/03/xfm_E8RCCMNW9E4JGGQRXAK42GRACG/01-whoop-01.json"],
    },
  ]);
  assert.equal(manifest.artifacts[0]?.role, "artifact-1");
  assert.equal(manifest.artifacts[0]?.originalFileName, "whoop-01.json");
});

test("importDeviceBatch supports sample-only batches without raw artifacts", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-sample-only");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

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
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

  await assert.rejects(
    () => importDeviceBatch({ vaultRoot, provider: "whoop" }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_DEVICE_BATCH",
  );
});

test("importDeviceBatch rejects unsupported event kinds and invalid event fields", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-event-errors");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

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
            fields: "not-an-object" as unknown as Record<string, unknown>,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_EVENT_FIELDS",
  );
});

test("importDeviceBatch rejects unsupported sample streams and missing sample payloads", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-sample-errors");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        samples: [
          {
            stream: "oxygen" as unknown as "hrv",
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
            sample: null as unknown as Record<string, unknown>,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_SAMPLE",
  );
});

test("importDeviceBatch validates canonical payloads before raw artifact errors", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-validation-order");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

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
            metadata: "bad" as unknown as Record<string, unknown>,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "SAMPLE_INVALID",
  );
});

test("importDeviceBatch rejects duplicate raw roles and missing raw-role references", async () => {
  const vaultRoot = await makeTempDirectory("murph-device-import-raw-errors");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

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
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z", timezone: TEST_TIMEZONE });

  await assert.rejects(
    () =>
      importDeviceBatch({
        vaultRoot,
        provider: "whoop",
        provenance: "not-an-object" as unknown as Record<string, unknown>,
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
            metadata: "bad" as unknown as Record<string, unknown>,
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
            content: undefined as unknown as string,
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
    category: "integrations",
    provider: "whoop",
    occurredAt: "2026-03-16T09:30:00.000Z",
    recordId: "xfm_fixed",
    targetName: "snapshot.json",
  });
  const inline = prepareInlineRawArtifact({
    fileName: "payload.json",
    category: "integrations",
    provider: "whoop",
    occurredAt: "2026-03-16T09:30:00.000Z",
    recordId: "xfm_fixed",
    targetName: "01-payload.json",
    mediaType: "application/json",
  });

  assert.equal(
    copied.relativePath,
    "raw/integrations/whoop/2026/03/xfm_fixed/snapshot.json",
  );
  assert.equal(
    inline.relativePath,
    "raw/integrations/whoop/2026/03/xfm_fixed/01-payload.json",
  );
  assert.equal(inline.originalFileName, "payload.json");
  assert.equal(inline.mediaType, "application/json");
});
