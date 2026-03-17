import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import type { AuditRecord, EventRecord, SampleRecord } from "@healthybob/contracts";

import {
  importDeviceBatch,
  initializeVault,
  readJsonlRecords,
  VaultError,
} from "../src/index.js";
import { prepareInlineRawArtifact, prepareRawArtifact } from "../src/raw.js";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("importDeviceBatch writes inline raw integration payloads and canonical records", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-import");
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

  assert.match(result.importId, /^xfm_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(result.events.length, 2);
  assert.equal(result.samples.length, 1);
  assert.equal(result.rawArtifacts.length, 2);
  assert.equal(result.provider, "whoop");
  assert.equal(result.accountId, "whoop-user-1");
  assert.match(result.rawArtifacts[0]?.relativePath ?? "", /^raw\/integrations\/whoop\/\d{4}\/\d{2}\/xfm_/);

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
  const manifest = JSON.parse(
    await fs.readFile(path.join(vaultRoot, result.manifestPath), "utf8"),
  ) as {
    importKind: string;
    rawDirectory: string;
    artifacts: Array<{ role: string; relativePath: string }>;
  };

  assert.equal(eventRecords.length, 2);
  assert.equal(eventRecords[0]?.externalRef?.system, "whoop");
  assert.ok(eventRecords[0]?.rawRefs?.[0]?.startsWith("raw/integrations/whoop/"));
  assert.equal(sampleRecords.length, 1);
  assert.equal(sampleRecords[0]?.externalRef?.facet, "hrv");
  assert.equal(auditRecords.at(-1)?.action, "device_import");
  assert.equal(manifest.importKind, "device_batch");
  assert.equal(manifest.artifacts.length, 2);
  assert.equal(path.posix.dirname(manifest.artifacts[0]?.relativePath ?? ""), manifest.rawDirectory);
});

test("importDeviceBatch retries reuse deterministic ids without duplicating ledgers", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-import-retry");
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
  assert.equal(eventRecords.length, 1);
  assert.equal(sampleRecords.length, 1);
});

test("importDeviceBatch falls back to the sole raw artifact when events omit explicit roles", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-import-single-raw");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
    importedAt: "2026-03-16T09:30:00.000Z",
    events: [
      {
        kind: "note",
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
  const manifest = JSON.parse(
    await fs.readFile(path.join(vaultRoot, result.manifestPath), "utf8"),
  ) as {
    artifacts: Array<{ role: string; originalFileName: string }>;
  };

  assert.equal(eventRecords[0]?.kind, "note");
  assert.deepEqual(eventRecords[0]?.rawRefs, [result.rawArtifacts[0]?.relativePath]);
  assert.equal(manifest.artifacts[0]?.role, "artifact-1");
  assert.equal(manifest.artifacts[0]?.originalFileName, "whoop-01.json");
});

test("importDeviceBatch supports sample-only batches without raw artifacts", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-import-sample-only");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const result = await importDeviceBatch({
    vaultRoot,
    provider: "whoop",
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

  assert.equal(result.manifestPath, "");
  assert.equal(result.rawArtifacts.length, 0);
  assert.equal(sampleRecords.length, 1);
  assert.equal(sampleRecords[0]?.stream, "respiratory_rate");
});

test("importDeviceBatch rejects empty batches", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-import-empty");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  await assert.rejects(
    () => importDeviceBatch({ vaultRoot, provider: "whoop" }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_DEVICE_BATCH",
  );
});

test("importDeviceBatch rejects unsupported event kinds and invalid event fields", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-import-event-errors");
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
            fields: "not-an-object" as unknown as Record<string, unknown>,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_INVALID_EVENT_FIELDS",
  );
});

test("importDeviceBatch rejects unsupported sample streams and missing sample payloads", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-import-sample-errors");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

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

test("importDeviceBatch rejects duplicate raw roles and missing raw-role references", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-device-import-raw-errors");
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
  const vaultRoot = await makeTempDirectory("healthybob-device-import-metadata-errors");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

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
