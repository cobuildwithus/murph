import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  parseBrowserVaultReplica,
  selectBrowserVaultHistory,
  selectBrowserVaultOverview,
  selectBrowserVaultSignals,
  type BrowserVaultMetricDayRow,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
} from "../src/browser.ts";
import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";

test("browser vault query clients parse full replicas and apply entity, metric, search, and timeline filters", () => {
  const parsed = parseBrowserVaultReplica(createReplicaFixture());
  const client = createBrowserVaultQueryClient(parsed);

  assert.equal(client.entities.get("exp_lookup")?.id, "exp_browser");
  assert.equal(client.entities.get("missing"), null);
  assert.deepEqual(
    client.entities.list({
      families: ["experiment"],
      from: "2026-04-18",
      ids: ["exp_lookup"],
      kinds: ["experiment_entry"],
      statuses: ["active"],
      tags: ["focus"],
      text: "steady",
      to: "2026-04-20",
    }).map((entity) => entity.id),
    ["exp_browser"],
  );
  assert.deepEqual(client.entities.list({ text: "reflection" }).map((entity) => entity.id), ["journal_browser"]);

  assert.deepEqual(
    client.metricDays.list({
      domain: "activity",
      from: "2026-04-20",
      metric: "steps",
      to: "2026-04-20",
    }).map((row) => row.id),
    ["activity:2026-04-20"],
  );
  assert.equal(
    client.metrics.latest({
      domain: "activity",
      from: "2026-04-20",
      metric: "steps",
      to: "2026-04-20",
    })?.value,
    920,
  );
  assert.deepEqual(
    client.metrics.list({ domain: "sleep", metric: "sleepScore" }).map((row) => row.id),
    ["sleep:2026-04-20:sleepScore"],
  );
  assert.deepEqual(
    client.metrics.series({ domain: "activity", metric: "steps" }).map((row) => row.date),
    ["2026-04-19", "2026-04-20"],
  );

  assert.deepEqual(client.search("  ", { families: ["experiment"] }), []);
  assert.deepEqual(client.search("steady", { families: ["experiment"] }).map((row) => row.entityId), ["exp_browser"]);
  assert.deepEqual(client.search("steadier", { families: ["journal"] }).map((row) => row.entityId), ["journal_browser"]);

  assert.deepEqual(
    client.timeline.list({
      families: ["journal"],
      from: "2026-04-19",
      kinds: ["journal_entry"],
      tags: ["sleep"],
      to: "2026-04-20",
    }).map((row) => row.id),
    ["timeline_journal"],
  );

  const overview = selectBrowserVaultOverview(client);
  const history = selectBrowserVaultHistory(client);
  const signals = selectBrowserVaultSignals(client);

  assert.equal(overview.weeklySampleSummaries[0]?.stream, "steps");
  assert.deepEqual(history.timeline.map((row) => row.id), ["timeline_journal", "timeline_event"]);
  assert.deepEqual(signals.activity[0]?.activityTypes, ["Running"]);
  assert.equal(signals.sleep[0]?.sleepWindowProvider, "garmin");
  assert.equal(signals.recovery[0]?.recoveryScore.selection.value, 77);
  assert.equal(signals.bodyState[0]?.weightKg.selection.value, 72.4);
  assert.equal(signals.sourceHealth[0]?.providerDisplayName, "Garmin");
});

test("browser vault replica creation projects safe fields, filters excluded families, and emits signal rows", async () => {
  const longBody = Array.from({ length: 90 }, (_, index) => `Paragraph ${index + 1}`).join("\n\n");
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createCanonicalEntity("experiment", "exp_long", {
          body: longBody,
          date: "2026-04-20",
          experimentSlug: "steady-sleep",
          frontmatter: {
            protocolRef: {
              key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
              pageRevisionId: "sha256:page-revision",
              runSpecRevisionId: "sha256:run-spec-revision",
              testPlanId: "rhr-21d",
            },
            category: "sleep",
            group: ["baseline", { phase: "week-1" }],
            privateNotes: "omit",
            runPlan: {
              baselineStart: "2026-04-15",
              baselineEnd: "2026-04-21",
              interventionStart: "2026-04-22",
              interventionEnd: "2026-05-05",
            },
            startedOn: "2026-04-15",
            status: "active",
            summary: { outcome: ["steadier", "lighter"] },
            value: 7n,
          },
          links: [{ targetId: "goal_sleep", type: "supports_goal" }],
          occurredAt: "2026-04-20T08:00:00.000Z",
          status: "active",
          tags: ["focus"],
          title: "Steady sleep experiment",
        }),
        createCanonicalEntity("food", "food_excluded", {
          title: "Excluded food",
        }),
        createCanonicalEntity("sample", "sample_steps", {
          attributes: {
            externalRef: {
              resourceId: "steps-1",
              resourceType: "summary",
              system: "garmin",
            },
            recordedAt: "2026-04-20T07:00:00.000Z",
            value: 920,
          },
          date: "2026-04-20",
          stream: "steps",
          title: "Daily steps",
        }),
        createCanonicalEntity("event", "evt_activity", {
          attributes: {
            durationMinutes: 45,
            externalRef: {
              resourceId: "activity-1",
              resourceType: "activity_session",
              system: "garmin",
            },
            recordedAt: "2026-04-20T07:30:00.000Z",
          },
          date: "2026-04-20",
          kind: "activity_session",
          occurredAt: "2026-04-20T06:45:00.000Z",
          title: "Morning running session",
        }),
        createCanonicalEntity("event", "evt_sleep", {
          attributes: {
            durationMinutes: 450,
            endAt: "2026-04-20T06:00:00.000Z",
            externalRef: {
              resourceId: "sleep-1",
              resourceType: "sleep_session",
              system: "garmin",
            },
            recordedAt: "2026-04-20T06:05:00.000Z",
            startAt: "2026-04-19T22:30:00.000Z",
          },
          kind: "sleep_session",
          occurredAt: "2026-04-19T22:30:00.000Z",
          title: "Night sleep",
        }),
        createCanonicalEntity("event", "obs_sleep_score", {
          attributes: {
            externalRef: {
              resourceId: "sleep-score-1",
              resourceType: "summary",
              system: "garmin",
            },
            metric: "sleep-score",
            recordedAt: "2026-04-20T06:10:00.000Z",
            value: 91,
          },
          kind: "observation",
          title: "Sleep score",
        }),
        createCanonicalEntity("event", "obs_recovery", {
          attributes: {
            externalRef: {
              resourceId: "recovery-1",
              resourceType: "summary",
              system: "garmin",
            },
            metric: "recovery-score",
            recordedAt: "2026-04-20T06:15:00.000Z",
            value: 77,
          },
          kind: "observation",
          title: "Recovery score",
        }),
        createCanonicalEntity("event", "obs_body_battery", {
          attributes: {
            externalRef: {
              resourceId: "body-battery-1",
              resourceType: "summary",
              system: "garmin",
            },
            metric: "body-battery",
            recordedAt: "2026-04-20T06:20:00.000Z",
            value: 74,
          },
          kind: "observation",
          title: "Body battery",
        }),
        createCanonicalEntity("event", "obs_weight", {
          attributes: {
            externalRef: {
              resourceId: "weight-1",
              resourceType: "summary",
              system: "garmin",
            },
            metric: "weight",
            recordedAt: "2026-04-20T06:25:00.000Z",
            unit: "kg",
            value: 72.4,
          },
          kind: "observation",
          title: "Weight",
        }),
      ],
      metadata: {
        title: "Signal-heavy browser vault",
      },
      vaultRoot: "browser://coverage",
    }),
  });

  const experiment = replica.entities.find((entity) => entity.id === "exp_long");
  assert.ok(experiment);
  assert.equal(replica.entities.some((entity) => entity.id === "food_excluded"), false);
  assert.equal(experiment?.bodyPreview?.endsWith("…"), true);
  assert.deepEqual(experiment?.attributes.group, ["baseline", { phase: "week-1" }]);
  assert.deepEqual(experiment?.attributes.protocolRef, {
    key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    pageRevisionId: "sha256:page-revision",
    runSpecRevisionId: "sha256:run-spec-revision",
    testPlanId: "rhr-21d",
  });
  assert.deepEqual(experiment?.attributes.runPlan, {
    baselineStart: "2026-04-15",
    baselineEnd: "2026-04-21",
    interventionStart: "2026-04-22",
    interventionEnd: "2026-05-05",
  });
  assert.deepEqual(experiment?.attributes.summary, { outcome: ["steadier", "lighter"] });
  assert.equal(experiment?.attributes.privateNotes, undefined);
  assert.equal(experiment?.attributes.value, undefined);

  assert.deepEqual(
    replica.metricDayRows.map((row) => row.domain).sort(),
    ["activity", "body_state", "recovery", "sleep"],
  );
  assert.equal(replica.metricRows.some((row) => row.domain === "activity" && row.metric === "sessionMinutes"), true);
  assert.equal(replica.sourceHealthRows[0]?.providerDisplayName, "Garmin");

  const signals = selectBrowserVaultSignals(createBrowserVaultQueryClient(parseBrowserVaultReplica(replica)));
  assert.deepEqual(signals.activity[0]?.activityTypes, ["Morning running"]);
  assert.equal(signals.sleep[0]?.sleepWindowProvider, "garmin");
  assert.equal(signals.recovery[0]?.bodyBattery.selection.value, 74);
  assert.equal(signals.bodyState[0]?.weightKg.selection.value, 72.4);
});

test("browser vault replica parsing rejects malformed policy, metric, and timeline fields", () => {
  const replica = createReplicaFixture();

  assert.throws(
    () => parseBrowserVaultReplica({
      ...replica,
      policy: { ...replica.policy, id: "wrong-policy" },
    }),
    /Browser vault replica\.policy\.id must be health-vault-browser-v1\./u,
  );
  assert.throws(
    () => parseBrowserVaultReplica({
      ...replica,
      metricRows: [{ ...replica.metricRows[0], domain: "energy" }],
    }),
    /Browser vault replica\.metricRows\[0\]\.domain must be a browser vault metric domain\./u,
  );
  assert.throws(
    () => parseBrowserVaultReplica({
      ...replica,
      metricDayRows: [{ ...replica.metricDayRows[0], confidence: "certain" }],
    }),
    /Browser vault replica\.metricDayRows\[0\]\.confidence must be a wearable confidence level\./u,
  );
  assert.throws(
    () => parseBrowserVaultReplica({
      ...replica,
      timelineRows: [{ ...replica.timelineRows[0], entryType: "goal" }],
    }),
    /Browser vault replica\.timelineRows\[0\]\.entryType must be a timeline entry type\./u,
  );
});

function createReplicaFixture(): BrowserVaultReplica {
  const activityDay = createMetricDayRow({
    attributes: { activityTypes: ["Running", 42] },
    confidence: "high",
    date: "2026-04-20",
    domain: "activity",
    metrics: {
      activityScore: metric("%", 81),
      activeCalories: metric("kcal", 330),
      dayStrain: metric("whoop_strain", 12.2),
      distanceKm: metric("km", 6.4),
      sessionCount: metric("count", 1),
      sessionMinutes: metric("minutes", 45),
      steps: metric("count", 920),
    },
    notes: ["Activity note."],
  });
  const sleepDay = createMetricDayRow({
    attributes: {
      sleepEndAt: "2026-04-20T06:00:00.000Z",
      sleepStartAt: "2026-04-19T22:30:00.000Z",
      sleepWindowProvider: "garmin",
    },
    confidence: "medium",
    date: "2026-04-20",
    domain: "sleep",
    metrics: {
      sessionMinutes: metric("minutes", 450),
      sleepScore: metric("%", 91),
      totalSleepMinutes: metric("minutes", 430),
    },
    notes: ["Sleep note."],
  });
  const recoveryDay = createMetricDayRow({
    attributes: {},
    confidence: "high",
    date: "2026-04-20",
    domain: "recovery",
    metrics: {
      bodyBattery: metric("score", 74),
      recoveryScore: metric("%", 77),
    },
    notes: ["Recovery note."],
  });
  const bodyStateDay = createMetricDayRow({
    attributes: {},
    confidence: "low",
    date: "2026-04-20",
    domain: "body_state",
    metrics: {
      weightKg: metric("kg", 72.4),
    },
    notes: ["Body note."],
  });
  const activityMetricRows = createMetricRows(activityDay);
  const sleepMetricRows = createMetricRows(sleepDay);

  return {
    assistantSummary: {
      highlights: ["Keep it light."],
      latestDate: "2026-04-20",
    },
    entities: [
      {
        attributes: { category: "sleep", summary: { note: "steady" } },
        bodyPreview: "Steady sleep note",
        date: "2026-04-20",
        experimentSlug: "steady-sleep",
        family: "experiment",
        id: "exp_browser",
        kind: "experiment_entry",
        links: [{ targetId: "goal_sleep", type: "supports_goal" }],
        lookupIds: ["exp_lookup", "exp_browser"],
        occurredAt: "2026-04-20T08:00:00.000Z",
        recordClass: "bank",
        status: "active",
        stream: null,
        tags: ["focus", "sleep"],
        title: "Steady sleep experiment",
      },
      {
        attributes: {},
        bodyPreview: "Reflection on steadier sleep",
        date: "2026-04-19",
        experimentSlug: null,
        family: "journal",
        id: "journal_browser",
        kind: "journal_entry",
        links: [],
        lookupIds: ["journal_browser"],
        occurredAt: "2026-04-19T20:00:00.000Z",
        recordClass: "ledger",
        status: null,
        stream: null,
        tags: ["sleep"],
        title: "Recovery reflection",
      },
    ],
    generatedAt: "2026-04-20T12:00:00.000Z",
    metricDayRows: [activityDay, sleepDay, recoveryDay, bodyStateDay],
    metricRows: [
      ...activityMetricRows,
      createMetricRow(activityDay, "steps", "2026-04-19"),
      ...sleepMetricRows,
      ...createMetricRows(recoveryDay),
      ...createMetricRows(bodyStateDay),
    ],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: ["audit", "core", "food", "recipe"],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: [
        "allergy",
        "assessment",
        "condition",
        "event",
        "experiment",
        "family",
        "genetics",
        "goal",
        "journal",
        "protocol",
        "provider",
        "sample",
        "workout_format",
      ],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [
      {
        date: "2026-04-20",
        entityId: "exp_browser",
        family: "experiment",
        id: "exp_browser",
        kind: "experiment_entry",
        occurredAt: "2026-04-20T08:00:00.000Z",
        tags: ["focus", "sleep"],
        text: "Steady sleep experiment\nSteady sleep note",
        title: "Steady sleep experiment",
      },
      {
        date: "2026-04-19",
        entityId: "journal_browser",
        family: "journal",
        id: "journal_browser",
        kind: "journal_entry",
        occurredAt: "2026-04-19T20:00:00.000Z",
        tags: ["sleep"],
        text: "Recovery reflection\nReflection on steadier sleep",
        title: "Recovery reflection",
      },
    ],
    source: {
      dataVersion: "a".repeat(64),
      sourceBundleHash: "b".repeat(64),
    },
    sourceHealthRows: [{
      activityDays: 1,
      bodyStateDays: 1,
      conflictCount: 0,
      firstDate: "2026-04-19",
      lastDate: "2026-04-20",
      latestRecordedAt: "2026-04-20T10:20:00.000Z",
      provider: "garmin",
      providerDisplayName: "Garmin",
      recoveryDays: 1,
      selectedMetrics: 6,
      sleepNights: 1,
      stalenessVsNewestDays: 0,
    }],
    timelineRows: [
      {
        date: "2026-04-19",
        entityId: "journal_browser",
        entryType: "journal",
        family: "journal",
        id: "timeline_journal",
        kind: "journal_entry",
        occurredAt: "2026-04-19T20:00:00.000Z",
        stream: null,
        tags: ["sleep"],
        title: "Recovery reflection",
      },
      {
        date: "2026-04-20",
        entityId: "evt_browser",
        entryType: "event",
        family: "event",
        id: "timeline_event",
        kind: "activity_session",
        occurredAt: "2026-04-20T06:45:00.000Z",
        stream: null,
        tags: ["movement"],
        title: "Morning running session",
      },
    ],
    weeklySampleSummaries: [{
      date: "2026-04-20",
      numericSampleCount: 1,
      sampleCount: 1,
      stream: "steps",
      sumValue: 920,
      unit: "count",
    }],
  };
}

function createMetricRows(day: BrowserVaultMetricDayRow): BrowserVaultMetricRow[] {
  return Object.entries(day.metrics).map(([metricName, resolved]) => ({
    confidence: day.confidence,
    date: day.date,
    domain: day.domain,
    id: `${day.id}:${metricName}`,
    metric: metricName,
    recordIds: [],
    sourceFamily: "derived",
    sourceKind: "summary",
    unit: resolved.selection.unit,
    value: resolved.selection.value,
  }));
}

function createMetricRow(
  day: BrowserVaultMetricDayRow,
  metricName: string,
  date: string,
): BrowserVaultMetricRow {
  const resolved = day.metrics[metricName];
  assert.ok(resolved);

  return {
    confidence: day.confidence,
    date,
    domain: day.domain,
    id: `${day.id}:${metricName}:${date}`,
    metric: metricName,
    recordIds: [],
    sourceFamily: "derived",
    sourceKind: "summary",
    unit: resolved.selection.unit,
    value: resolved.selection.value,
  };
}

function createMetricDayRow(input: {
  attributes: Record<string, unknown>;
  confidence: BrowserVaultMetricDayRow["confidence"];
  date: string;
  domain: BrowserVaultMetricDayRow["domain"];
  metrics: BrowserVaultMetricDayRow["metrics"];
  notes: string[];
}): BrowserVaultMetricDayRow {
  const metricIds = Object.keys(input.metrics).map((metricName) => `${input.domain}:${input.date}:${metricName}`);

  return {
    attributes: input.attributes,
    confidence: input.confidence,
    date: input.date,
    domain: input.domain,
    id: `${input.domain}:${input.date}`,
    metricIds,
    metrics: input.metrics,
    notes: input.notes,
  };
}

function metric(unit: string | null, value: number | null) {
  return {
    selection: {
      unit,
      value,
    },
  };
}

function createCanonicalEntity(
  family: CanonicalEntity["family"],
  entityId: string,
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  const kind = overrides.kind ?? defaultKindForFamily(family);
  const primaryLookupId = overrides.primaryLookupId ?? entityId;

  return {
    attributes: overrides.attributes ?? {},
    body: overrides.body ?? null,
    date: overrides.date ?? "2026-04-20",
    entityId,
    experimentSlug: overrides.experimentSlug ?? null,
    family,
    frontmatter: overrides.frontmatter ?? null,
    kind,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [primaryLookupId],
    occurredAt: overrides.occurredAt ?? "2026-04-20T00:00:00.000Z",
    path: overrides.path ?? `history/${family}/${entityId}.md`,
    primaryLookupId,
    recordClass: overrides.recordClass ?? defaultRecordClassForFamily(family),
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream: overrides.stream ?? null,
    tags: overrides.tags ?? [],
    title: overrides.title ?? entityId,
  };
}

function defaultKindForFamily(family: CanonicalEntity["family"]): string {
  switch (family) {
    case "experiment":
      return "experiment_entry";
    case "food":
      return "food_entry";
    case "sample":
      return "sample";
    default:
      return family;
  }
}

function defaultRecordClassForFamily(family: CanonicalEntity["family"]): CanonicalEntity["recordClass"] {
  switch (family) {
    case "sample":
      return "sample";
    case "event":
    case "journal":
      return "ledger";
    default:
      return "bank";
  }
}
