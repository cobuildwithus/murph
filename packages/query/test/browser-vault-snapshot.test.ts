import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";

import {
  resolveCanonicalRecordClass,
  type CanonicalEntity,
} from "../src/canonical-entities.ts";
import {
  BROWSER_VAULT_SNAPSHOT_SCHEMA,
  createBrowserVaultSnapshot,
  parseBrowserVaultSnapshot,
} from "../src/browser-snapshot.ts";
import { createVaultReadModel } from "../src/model.ts";
import { readVaultTolerant } from "../src/vault-reader.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((vaultRoot) =>
    rm(vaultRoot, { recursive: true, force: true })
  ));
});

test("browser vault snapshots clone dashboard projections before serialization", () => {
  const experiment = createEntity("experiment", "exp_browser_01", {
    body: "# Trial\n\nKeep the sauna protocol lightweight.\n",
    date: "2026-04-17",
    experimentSlug: "sauna-protocol",
    occurredAt: "2026-04-17T08:00:00.000Z",
    status: "active",
    tags: ["browser"],
    title: "Browser experiment",
  });
  const journal = createEntity("journal", "journal_browser_01", {
    body: "# Journal\n\n- Good energy\n",
    date: "2026-04-16",
    occurredAt: "2026-04-16T08:00:00.000Z",
    tags: ["journal"],
    title: "Browser journal",
  });
  const sample = createEntity("sample", "sample_browser_01", {
    attributes: {
      unit: "ms",
      value: 48,
    },
    date: "2026-04-17",
    occurredAt: "2026-04-17T08:30:00.000Z",
    stream: "hrv",
    tags: ["signal"],
    title: "HRV sample",
  });
  const vault = createVaultReadModel({
    entities: [experiment, journal, sample],
    metadata: {
      title: "Browser vault",
    },
    vaultRoot: "browser://vault",
  });

  const snapshot = createBrowserVaultSnapshot({
    generatedAt: "2026-04-17T08:05:00.000Z",
    sourceVersion: "a".repeat(64),
    vault,
  });

  experiment.tags.push("mutated");
  experiment.body = "Mutated protocol body";
  journal.tags.push("mutated");
  sample.attributes = {
    unit: "ms",
    value: 90,
  };

  assert.deepEqual(snapshot.overview.trackedExperiments[0], {
    id: "exp_browser_01",
    slug: "sauna-protocol",
    startedOn: "2026-04-17",
    status: "active",
    summary: "Keep the sauna protocol lightweight.",
    tags: ["browser"],
    title: "Browser experiment",
  });
  assert.deepEqual(snapshot.overview.recentJournals[0], {
    date: "2026-04-16",
    id: "journal_browser_01",
    summary: "Good energy",
    tags: ["journal"],
    title: "Browser journal",
  });
  assert.equal(snapshot.history.timeline[0]?.id, "sample-summary:2026-04-17:hrv:ms");
  assert.deepEqual(snapshot.history.timeline[0]?.tags, ["sample_summary", "hrv"]);
  assert.equal(snapshot.overview.weeklySampleSummaries[0]?.averageValue, 48);
});

test("browser vault snapshots parse dashboard projections and validate schema", () => {
  const snapshot = createBrowserVaultSnapshot({
    generatedAt: "2026-04-17T08:05:00.000Z",
    sourceVersion: "b".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_browser_parse", {
          body: "Track the protocol.",
          date: "2026-04-17",
          occurredAt: "2026-04-17T08:00:00.000Z",
          status: "active",
          title: "Parse experiment",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });
  const parsed = parseBrowserVaultSnapshot(
    JSON.parse(JSON.stringify(snapshot)) as unknown,
  );

  assert.equal(parsed.schema, BROWSER_VAULT_SNAPSHOT_SCHEMA);
  assert.equal(parsed.overview.trackedExperiments[0]?.id, "exp_browser_parse");
  assert.equal(parsed.overview.trackedExperiments[0]?.title, "Parse experiment");
  assert.deepEqual(parsed.history.timeline, snapshot.history.timeline);

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        generatedAt: "2026-04-17T08:05:00.000Z",
        schema: "murph.browser-vault-dashboard-snapshot.wrong",
      }),
    /Browser vault snapshot\.schema must be murph\.browser-vault-dashboard-snapshot\.v1\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        history: {
          timeline: {},
        },
      }),
    /Browser vault snapshot\.history\.timeline must be an array\./,
  );

  assert.throws(
    () => parseBrowserVaultSnapshot(null),
    /Browser vault snapshot must be an object\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        overview: {},
      }),
    /Browser vault snapshot\.overview\.metrics must be an array\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        sourceVersion: "",
      }),
    /Browser vault snapshot\.sourceVersion must be a non-empty string\./,
  );
});

test("browser vault snapshots report field-level failures for overview history and signal rows", () => {
  const snapshot = createBrowserVaultSnapshot({
    generatedAt: "2026-04-17T08:05:00.000Z",
    sourceVersion: "e".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_browser_fields", {
          body: "Keep the training load light.",
          date: "2026-04-17",
          occurredAt: "2026-04-17T08:00:00.000Z",
          status: "active",
          tags: ["browser"],
          title: "Field-level experiment",
        }),
        createEntity("sample", "sample_browser_fields", {
          attributes: {
            unit: "min",
            value: 430,
          },
          date: "2026-04-17",
          occurredAt: "2026-04-17T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          tags: ["browser"],
          title: "Sleep duration",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        overview: {
          ...snapshot.overview,
          trackedExperiments: snapshot.overview.trackedExperiments.map((entry, index) =>
            index === 0 ? { ...entry, title: "" } : entry,
          ),
        },
      }),
    /Browser vault snapshot\.overview\.trackedExperiments\[0\]\.title must be a non-empty string\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        history: {
          ...snapshot.history,
          timeline: snapshot.history.timeline.map((entry, index) =>
            index === 0 ? { ...entry, tags: ["browser", ""] } : entry,
          ),
        },
      }),
    /Browser vault snapshot\.history\.timeline\[0\]\.tags\[1\] must be a non-empty string\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        signals: {
          ...snapshot.signals,
          assistantSummary: {
            ...snapshot.signals.assistantSummary,
            highlights: [""],
          },
        },
      }),
    /Browser vault snapshot\.signals\.assistantSummary\.highlights\[0\] must be a non-empty string\./,
  );
});

test("browser vault snapshots default generatedAt and parse nullable history fields", () => {
  const snapshot = createBrowserVaultSnapshot({
    sourceVersion: "c".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("event", "evt_browser_history", {
          occurredAt: "2026-04-17T08:00:00.000Z",
          tags: ["browser"],
          title: "Browser history event",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  assert.match(
    snapshot.generatedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  );

  const parsed = parseBrowserVaultSnapshot({
    ...snapshot,
    history: {
      timeline: [
        {
          date: "2026-04-17",
          entryType: "event",
          id: "evt_browser_history",
          kind: "event",
          occurredAt: "2026-04-17T08:00:00.000Z",
          tags: ["browser"],
          title: "Browser history event",
        },
        {
          date: "2026-04-16",
          entryType: "journal",
          id: "journal_browser_history",
          kind: "journal_day",
          occurredAt: "2026-04-16T08:00:00.000Z",
          stream: "journal",
          tags: ["journal", "browser"],
          title: "History journal",
        },
      ],
    },
  });

  assert.equal(parsed.history.timeline[0]?.stream, null);
  assert.deepEqual(parsed.history.timeline[0]?.tags, ["browser"]);
  assert.equal(parsed.history.timeline[1]?.stream, "journal");
  assert.deepEqual(parsed.history.timeline[1]?.tags, ["journal", "browser"]);
});

test("browser vault snapshots reject invalid generatedAt datetimes", () => {
  assert.throws(
    () =>
      createBrowserVaultSnapshot({
        generatedAt: "not-a-datetime",
        sourceVersion: "d".repeat(64),
        vault: createVaultReadModel({
          entities: [
            createEntity("sample", "sample_browser_invalid_datetime", {
              attributes: {
                unit: "ms",
                value: 48,
              },
              date: "2026-04-17",
              occurredAt: "2026-04-17T08:30:00.000Z",
              stream: "hrv",
              tags: ["signal"],
              title: "HRV sample",
            }),
          ],
          metadata: null,
          vaultRoot: "browser://vault",
        }),
      }),
    /Browser vault snapshot generatedAt must be a valid ISO datetime\./,
  );
});

test("browser vault snapshots parse nested wearable projections", () => {
  const parsed = parseBrowserVaultSnapshot({
    generatedAt: "2026-04-17T08:05:00.000Z",
    history: {
      timeline: [
        {
          date: "2026-04-17",
          entryType: "sample_summary",
          id: "sample-summary:2026-04-17:hrv:ms",
          kind: "sample_summary",
          occurredAt: "2026-04-17T08:05:00.000Z",
          path: "history/samples/2026-04-17.md",
          stream: "hrv",
          tags: ["sample_summary", "hrv"],
          title: "HRV",
        },
      ],
    },
    overview: {
      metrics: [
        {
          label: "Recovery score",
          note: "Strong recovery.",
          value: 82,
        },
      ],
      recentJournals: [
        {
          date: "2026-04-17",
          id: "journal_nested",
          summary: "Felt steady through the afternoon.",
          tags: ["journal", "recovery"],
          title: "Nested journal",
        },
      ],
      trackedExperiments: [
        {
          id: "exp_nested",
          slug: "steady-morning-light",
          startedOn: "2026-04-01",
          status: "active",
          summary: "Morning light remains helpful.",
          tags: ["light", "sleep"],
          title: "Morning light",
        },
      ],
      weeklySampleSummaries: [
        {
          averageValue: 47,
          date: "2026-04-17",
          firstSampleAt: "2026-04-17T06:00:00.000Z",
          lastSampleAt: "2026-04-17T06:05:00.000Z",
          maxValue: 49,
          minValue: 45,
          sampleCount: 3,
          sampleIds: ["sample_nested_1", "sample_nested_2", "sample_nested_3"],
          sourcePaths: ["samples/hrv/2026-04-17.ndjson"],
          stream: "hrv",
          sumValue: 141,
          unit: "ms",
          units: ["ms"],
        },
      ],
    },
    schema: BROWSER_VAULT_SNAPSHOT_SCHEMA,
    signals: {
      activity: [
        createWearableSummary({
          date: "2026-04-17",
          metrics: {
            activityScore: createResolvedMetric("activity_score", 82, "event"),
            activeCalories: createResolvedMetric("active_calories", 540, "sample"),
            dayStrain: createResolvedMetric("day_strain", 12.4, "derived"),
            distanceKm: createResolvedMetric("distance_km", 8.1, "sample"),
            sessionCount: createResolvedMetric("session_count", 2, "event"),
            sessionMinutes: createResolvedMetric("session_minutes", 61, "sample"),
            steps: createResolvedMetric("steps", 10234, "sample"),
          },
          notes: ["Daily activity summary"],
          summaryConfidence: createSummaryConfidence("high"),
        }),
      ],
      assistantSummary: {
        activity: createWearableSummary({
          date: "2026-04-17",
          metrics: {
            activityScore: createResolvedMetric("activity_score", 82, "event"),
            activeCalories: createResolvedMetric("active_calories", 540, "sample"),
            dayStrain: createResolvedMetric("day_strain", 12.4, "derived"),
            distanceKm: createResolvedMetric("distance_km", 8.1, "sample"),
            sessionCount: createResolvedMetric("session_count", 2, "event"),
            sessionMinutes: createResolvedMetric("session_minutes", 61, "sample"),
            steps: createResolvedMetric("steps", 10234, "sample"),
          },
          notes: ["Assistant activity summary"],
          summaryConfidence: createSummaryConfidence("high"),
        }),
        bodyState: {
          bmi: createResolvedMetric("bmi", 22.1, "derived"),
          bodyFatPercentage: createResolvedMetric("body_fat_percentage", 18.2, "sample"),
          date: "2026-04-17",
          notes: ["Body-state summary"],
          summaryConfidence: createSummaryConfidence("medium"),
          temperature: createResolvedMetric("temperature", 36.5, "sample"),
          weightKg: createResolvedMetric("weight_kg", 73.2, "sample"),
        },
        date: "2026-04-17",
        from: "2026-04-10",
        highlights: ["Recovery is trending up."],
        latestDate: "2026-04-17",
        providers: ["oura", "whoop"],
        recovery: {
          bodyBattery: createResolvedMetric("body_battery", 71, "derived"),
          date: "2026-04-17",
          hrv: createResolvedMetric("hrv", 47, "sample"),
          notes: ["Recovery summary"],
          readinessScore: createResolvedMetric("readiness_score", 84, "sample"),
          recoveryScore: createResolvedMetric("recovery_score", 79, "sample"),
          respiratoryRate: createResolvedMetric("respiratory_rate", 13.4, "sample"),
          restingHeartRate: createResolvedMetric("resting_heart_rate", 49, "sample"),
          spo2: createResolvedMetric("spo2", 98, "sample"),
          stressLevel: createResolvedMetric("stress_level", 22, "derived"),
          summaryConfidence: createSummaryConfidence("medium"),
          temperature: createResolvedMetric("temperature", 36.6, "sample"),
          temperatureDeviation: createResolvedMetric("temperature_deviation", 0.2, "derived"),
        },
        sleep: {
          averageHeartRate: createResolvedMetric("average_heart_rate", 53, "sample"),
          awakeMinutes: createResolvedMetric("awake_minutes", 24, "sample"),
          date: "2026-04-17",
          deepMinutes: createResolvedMetric("deep_minutes", 92, "sample"),
          hrv: createResolvedMetric("hrv", 47, "sample"),
          lightMinutes: createResolvedMetric("light_minutes", 244, "sample"),
          lowestHeartRate: createResolvedMetric("lowest_heart_rate", 44, "sample"),
          notes: ["Sleep summary"],
          remMinutes: createResolvedMetric("rem_minutes", 86, "sample"),
          respiratoryRate: createResolvedMetric("respiratory_rate", 13.1, "sample"),
          sessionMinutes: createResolvedMetric("session_minutes", 422, "sample"),
          sleepConsistency: createResolvedMetric("sleep_consistency", 88, "derived"),
          sleepEfficiency: createResolvedMetric("sleep_efficiency", 94, "derived"),
          sleepEndAt: "2026-04-17T06:35:00.000Z",
          sleepPerformance: createResolvedMetric("sleep_performance", 89, "derived"),
          sleepScore: createResolvedMetric("sleep_score", 91, "sample"),
          sleepStartAt: "2026-04-16T23:33:00.000Z",
          sleepWindowProvider: "oura",
          spo2: createResolvedMetric("spo2", 98, "sample"),
          summaryConfidence: createSummaryConfidence("high"),
          timeInBedMinutes: createResolvedMetric("time_in_bed_minutes", 442, "sample"),
          totalSleepMinutes: createResolvedMetric("total_sleep_minutes", 422, "sample"),
        },
        sourceHealth: [
          createSourceHealthSummary({
            provider: "oura",
            providerDisplayName: "Oura",
            stalenessVsNewestDays: 0,
          }),
        ],
        to: "2026-04-17",
      },
      bodyState: [
        {
          bmi: createResolvedMetric("bmi", 22.1, "derived"),
          bodyFatPercentage: createResolvedMetric("body_fat_percentage", 18.2, "sample"),
          date: "2026-04-17",
          notes: ["Body-state summary"],
          summaryConfidence: createSummaryConfidence("medium"),
          temperature: createResolvedMetric("temperature", 36.5, "sample"),
          weightKg: createResolvedMetric("weight_kg", 73.2, "sample"),
        },
      ],
      recovery: [
        {
          bodyBattery: createResolvedMetric("body_battery", 71, "derived"),
          date: "2026-04-17",
          hrv: createResolvedMetric("hrv", 47, "sample"),
          notes: ["Recovery summary"],
          readinessScore: createResolvedMetric("readiness_score", 84, "sample"),
          recoveryScore: createResolvedMetric("recovery_score", 79, "sample"),
          respiratoryRate: createResolvedMetric("respiratory_rate", 13.4, "sample"),
          restingHeartRate: createResolvedMetric("resting_heart_rate", 49, "sample"),
          spo2: createResolvedMetric("spo2", 98, "sample"),
          stressLevel: createResolvedMetric("stress_level", 22, "derived"),
          summaryConfidence: createSummaryConfidence("medium"),
          temperature: createResolvedMetric("temperature", 36.6, "sample"),
          temperatureDeviation: createResolvedMetric("temperature_deviation", 0.2, "derived"),
        },
      ],
      sleep: [
        {
          averageHeartRate: createResolvedMetric("average_heart_rate", 53, "sample"),
          awakeMinutes: createResolvedMetric("awake_minutes", 24, "sample"),
          date: "2026-04-17",
          deepMinutes: createResolvedMetric("deep_minutes", 92, "sample"),
          hrv: createResolvedMetric("hrv", 47, "sample"),
          lightMinutes: createResolvedMetric("light_minutes", 244, "sample"),
          lowestHeartRate: createResolvedMetric("lowest_heart_rate", 44, "sample"),
          notes: ["Sleep summary"],
          remMinutes: createResolvedMetric("rem_minutes", 86, "sample"),
          respiratoryRate: createResolvedMetric("respiratory_rate", 13.1, "sample"),
          sessionMinutes: createResolvedMetric("session_minutes", 422, "sample"),
          sleepConsistency: createResolvedMetric("sleep_consistency", 88, "derived"),
          sleepEfficiency: createResolvedMetric("sleep_efficiency", 94, "derived"),
          sleepEndAt: "2026-04-17T06:35:00.000Z",
          sleepPerformance: createResolvedMetric("sleep_performance", 89, "derived"),
          sleepScore: createResolvedMetric("sleep_score", 91, "sample"),
          sleepStartAt: "2026-04-16T23:33:00.000Z",
          sleepWindowProvider: "oura",
          spo2: createResolvedMetric("spo2", 98, "sample"),
          summaryConfidence: createSummaryConfidence("high"),
          timeInBedMinutes: createResolvedMetric("time_in_bed_minutes", 442, "sample"),
          totalSleepMinutes: createResolvedMetric("total_sleep_minutes", 422, "sample"),
        },
      ],
      sourceHealth: [
        createSourceHealthSummary({
          provider: "oura",
          providerDisplayName: "Oura",
          stalenessVsNewestDays: 0,
        }),
      ],
    },
    sourceVersion: "f".repeat(64),
  });

  assert.equal(parsed.signals.activity[0]?.activityScore.selection.sourceFamily, "event");
  assert.equal(parsed.signals.activity[0]?.activityScore.candidates[0]?.externalRef?.system, "oura");
  assert.equal(parsed.signals.assistantSummary.activity?.activityScore.selection.sourceFamily, "event");
  assert.equal(parsed.signals.assistantSummary.sourceHealth[0]?.stalenessVsNewestDays, 0);
  assert.equal(parsed.signals.sleep[0]?.sleepWindowProvider, "oura");
  assert.equal(parsed.signals.recovery[0]?.temperatureDeviation.selection.resolution, "direct");
  assert.equal(parsed.overview.weeklySampleSummaries[0]?.sampleCount, 3);
});

test("browser vault snapshots reject invalid wearable enum values", () => {
  const snapshot = createBrowserVaultSnapshot({
    generatedAt: "2026-04-17T08:05:00.000Z",
    sourceVersion: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("sample", "sample_browser_enum", {
          attributes: {
            unit: "ms",
            value: 48,
          },
          date: "2026-04-17",
          occurredAt: "2026-04-17T08:30:00.000Z",
          stream: "hrv",
          title: "HRV sample",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        signals: {
          ...snapshot.signals,
          activity: [
            createWearableSummary({
              date: "2026-04-17",
              metrics: {
                activityScore: createResolvedMetric("activity_score", 82, "sample", {
                  confidenceLevel: "impossible",
                }),
                activeCalories: createResolvedMetric("active_calories", 540, "sample"),
                dayStrain: createResolvedMetric("day_strain", 12.4, "derived"),
                distanceKm: createResolvedMetric("distance_km", 8.1, "sample"),
                sessionCount: createResolvedMetric("session_count", 2, "event"),
                sessionMinutes: createResolvedMetric("session_minutes", 61, "sample"),
                steps: createResolvedMetric("steps", 10234, "sample"),
              },
              summaryConfidence: createSummaryConfidence("high"),
            }),
          ],
        },
      }),
    /Browser vault snapshot\.signals\.activity\[0\]\.activityScore\.confidence\.level must be none, low, medium, or high\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        signals: {
          ...snapshot.signals,
          activity: [
            createWearableSummary({
              date: "2026-04-17",
              metrics: {
                activityScore: createResolvedMetric("activity_score", 82, "unknown"),
                activeCalories: createResolvedMetric("active_calories", 540, "sample"),
                dayStrain: createResolvedMetric("day_strain", 12.4, "derived"),
                distanceKm: createResolvedMetric("distance_km", 8.1, "sample"),
                sessionCount: createResolvedMetric("session_count", 2, "event"),
                sessionMinutes: createResolvedMetric("session_minutes", 61, "sample"),
                steps: createResolvedMetric("steps", 10234, "sample"),
              },
              summaryConfidence: createSummaryConfidence("high"),
            }),
          ],
        },
      }),
    /Browser vault snapshot\.signals\.activity\[0\]\.activityScore\.candidates\[0\]\.sourceFamily must be event, sample, or derived\./,
  );

  assert.throws(
    () =>
      parseBrowserVaultSnapshot({
        ...snapshot,
        signals: {
          ...snapshot.signals,
          activity: [
            createWearableSummary({
              date: "2026-04-17",
              metrics: {
                activityScore: createResolvedMetric("activity_score", 82, "sample", {
                  resolution: "mystery",
                }),
                activeCalories: createResolvedMetric("active_calories", 540, "sample"),
                dayStrain: createResolvedMetric("day_strain", 12.4, "derived"),
                distanceKm: createResolvedMetric("distance_km", 8.1, "sample"),
                sessionCount: createResolvedMetric("session_count", 2, "event"),
                sessionMinutes: createResolvedMetric("session_minutes", 61, "sample"),
                steps: createResolvedMetric("steps", 10234, "sample"),
              },
              summaryConfidence: createSummaryConfidence("high"),
            }),
          ],
        },
      }),
    /Browser vault snapshot\.signals\.activity\[0\]\.activityScore\.selection\.resolution must be direct, fallback, or none\./,
  );
});

test("readVaultTolerant materializes a read model from canonical vault files without the projection store", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-browser-tolerant-"));
  tempRoots.push(vaultRoot);

  await mkdir(path.join(vaultRoot, "bank/goals"), { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify({
      createdAt: "2026-04-17T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Browser tolerant vault",
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
    }),
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "bank/goals/morning-light.md"),
    `---
title: Morning light
status: active
tags:
  - recovery
---

Get outside after waking.
`,
    "utf8",
  );

  const vault = await readVaultTolerant(vaultRoot);

  assert.equal(vault.vaultRoot, vaultRoot);
  assert.equal(vault.metadata?.title, "Browser tolerant vault");
  assert.ok(Array.isArray(vault.entities));
});

function createEntity(
  family: CanonicalEntity["family"],
  entityId: string,
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  return {
    attributes: {},
    body: null,
    date: null,
    entityId,
    experimentSlug: null,
    family,
    frontmatter: null,
    kind: family,
    links: [],
    lookupIds: [entityId],
    occurredAt: null,
    path: `${family}/${entityId}.md`,
    primaryLookupId: entityId,
    recordClass: resolveCanonicalRecordClass(family),
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: entityId,
    ...overrides,
  };
}

function createWearableSummary(input: {
  date: string;
  metrics: {
    activityScore: ReturnType<typeof createResolvedMetric>;
    activeCalories: ReturnType<typeof createResolvedMetric>;
    dayStrain: ReturnType<typeof createResolvedMetric>;
    distanceKm: ReturnType<typeof createResolvedMetric>;
    sessionCount: ReturnType<typeof createResolvedMetric>;
    sessionMinutes: ReturnType<typeof createResolvedMetric>;
    steps: ReturnType<typeof createResolvedMetric>;
  };
  notes?: string[];
  summaryConfidence: ReturnType<typeof createSummaryConfidence>;
}) {
  return {
    activityScore: input.metrics.activityScore,
    activeCalories: input.metrics.activeCalories,
    activityTypes: ["walk", "run"],
    date: input.date,
    dayStrain: input.metrics.dayStrain,
    distanceKm: input.metrics.distanceKm,
    notes: input.notes ?? [],
    sessionCount: input.metrics.sessionCount,
    sessionMinutes: input.metrics.sessionMinutes,
    steps: input.metrics.steps,
    summaryConfidence: input.summaryConfidence,
  };
}

function createResolvedMetric(
  metric: string,
  value: number,
  sourceFamily: string,
  overrides: {
    confidenceLevel?: string;
    resolution?: string;
  } = {},
) {
  return {
    candidates: [
      {
        candidateId: `${metric}_candidate`,
        date: "2026-04-17",
        externalRef: {
          facet: "summary",
          resourceId: `${metric}_resource`,
          resourceType: "session",
          system: "oura",
          version: "v1",
        },
        metric,
        occurredAt: "2026-04-17T06:30:00.000Z",
        paths: [`wearables/${metric}.json`],
        provider: "oura",
        recordedAt: "2026-04-17T06:31:00.000Z",
        recordIds: [`${metric}_record`],
        sourceFamily,
        sourceKind: "summary",
        title: `${metric} title`,
        unit: "score",
        value,
      },
    ],
    confidence: {
      candidateCount: 1,
      conflictingProviders: [],
      exactDuplicateCount: 0,
      level: overrides.confidenceLevel ?? "high",
      reasons: ["selected"],
    },
    metric,
    selection: {
      fallbackFromMetric: null,
      fallbackReason: overrides.resolution === "fallback" ? "fallback enabled" : null,
      occurredAt: "2026-04-17T06:30:00.000Z",
      paths: [`wearables/${metric}.json`],
      provider: "oura",
      recordedAt: "2026-04-17T06:31:00.000Z",
      recordIds: [`${metric}_record`],
      resolution: overrides.resolution ?? "direct",
      sourceFamily: sourceFamily === "event" || sourceFamily === "sample" || sourceFamily === "derived"
        ? sourceFamily
        : "sample",
      sourceKind: "summary",
      title: `${metric} title`,
      unit: "score",
      value,
    },
  };
}

function createSummaryConfidence(level: string) {
  return {
    conflictingMetrics: [],
    level,
    lowConfidenceMetrics: [],
    notes: ["stable"],
    selectedProviders: ["oura"],
  };
}

function createSourceHealthSummary(input: {
  provider: string;
  providerDisplayName: string;
  stalenessVsNewestDays: number | null;
}) {
  return {
    activityDays: 7,
    bodyStateDays: 5,
    candidateMetrics: 12,
    conflictCount: 1,
    exactDuplicatesSuppressed: 0,
    firstDate: "2026-04-10",
    lastDate: "2026-04-17",
    latestRecordedAt: "2026-04-17T06:31:00.000Z",
    metricsContributed: ["activity_score", "sleep_score"],
    notes: ["Fresh data"],
    provider: input.provider,
    providerDisplayName: input.providerDisplayName,
    recoveryDays: 7,
    selectedMetrics: 10,
    sleepNights: 7,
    stalenessVsNewestDays: input.stalenessVsNewestDays,
  };
}
