import assert from "node:assert/strict";

import { test } from "vitest";

import type { MetricPoint } from "../src/metrics/index.ts";
import {
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultReplica,
  selectBrowserVaultHistory,
  selectBrowserVaultOverview,
  selectBrowserVaultTrackedExperiments,
} from "../src/browser.ts";
import { buildMetricProjection } from "../src/index.ts";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];
type CreateReplicaInput = Omit<Parameters<typeof createBrowserVaultReplica>[0], "metricPoints">;

async function createBrowserVaultReplicaFromVault(input: CreateReplicaInput) {
  return createBrowserVaultReplica({
    ...input,
    metricPoints: buildMetricProjection(input.vault).metricPoints,
  });
}

test("browser vault replicas round-trip and expose the query-client selectors", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "a".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_1", {
          body: "# Trial\n\nShort walks are helping with afternoon energy.\n",
          date: "2026-04-18",
          experimentSlug: "light-morning-walk",
          occurredAt: "2026-04-18T08:00:00.000Z",
          status: "active",
          tags: ["movement"],
          title: "Morning walk",
        }),
        createEntity("journal", "journal_1", {
          body: "# Note\n\nFelt steadier after a full night of sleep.\n",
          date: "2026-04-20",
          occurredAt: "2026-04-20T07:30:00.000Z",
          tags: ["sleep", "travel"],
          title: "Travel recovery note",
        }),
        createEntity("sample", "sample_1", {
          attributes: {
            unit: "min",
            value: 430,
          },
          date: "2026-04-20",
          occurredAt: "2026-04-20T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
        createEntity("sample", "sample_2", {
          attributes: {
            unit: "min",
            value: 400,
          },
          date: "2026-04-13",
          occurredAt: "2026-04-13T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
      ],
      metadata: {
        title: "Browser vault fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });

  assert.equal(replica.schema, BROWSER_VAULT_REPLICA_SCHEMA);
  assert.equal(replica.source.sourceBundleHash, "a".repeat(64));
  assert.match(replica.source.dataVersion, /^[0-9a-f]{64}$/u);

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const overview = selectBrowserVaultOverview(client);
  const history = selectBrowserVaultHistory(client);

  assert.equal(selectBrowserVaultTrackedExperiments(client)[0]?.title, "Morning walk");
  assert.equal(overview.recentJournals[0]?.title, "Travel recovery note");
  assert.ok(history.timeline.some((entry) => entry.title === "Travel recovery note"));
  assert.equal(client.entities.get("exp_1")?.title, "Morning walk");
  assert.ok(client.search("steadier").some((row) => row.entityId === "journal_1"));
});

test("browser vault overview experiment summary is uncapped and completed-status specific", async () => {
  const activeExperiments = Array.from({ length: 25 }, (_, index) => {
    const day = String(30 - index).padStart(2, "0");
    return createEntity("experiment", `active_${index}`, {
      date: `2026-05-${day}`,
      occurredAt: `2026-05-${day}T08:00:00.000Z`,
      status: "active",
      title: `Active ${index}`,
    });
  });
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-05-31T12:00:00.000Z",
    sourceBundleHash: "f".repeat(64),
    vault: createVaultReadModel({
      entities: [
        ...activeExperiments,
        createEntity("experiment", "done_old", {
          date: "2026-04-02",
          occurredAt: "2026-04-02T08:00:00.000Z",
          status: "done",
          title: "Finished repeat",
        }),
        createEntity("experiment", "completed_old", {
          date: "2026-04-01",
          occurredAt: "2026-04-01T08:00:00.000Z",
          status: "completed",
          title: "Finished hydration",
        }),
        createEntity("experiment", "paused_old", {
          date: "2026-03-31",
          occurredAt: "2026-03-31T08:00:00.000Z",
          status: "paused",
          title: "Paused baseline",
        }),
      ],
      metadata: {
        title: "Browser vault fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });
  const overview = selectBrowserVaultOverview(createBrowserVaultQueryClient(replica));

  assert.equal(overview.trackedExperiments.length, 24);
  assert.equal(overview.experimentSummary.activeCount, 25);
  assert.equal(overview.experimentSummary.activePreview.length, 4);
  assert.equal(overview.experimentSummary.completedCount, 2);
  assert.equal(overview.experimentSummary.latestCompleted?.title, "Finished repeat");
  assert.equal(
    overview.trackedExperiments.some((entry) => entry.id === "done_old"),
    false,
  );
});

test("browser vault replica dataVersion stays stable when only generatedAt changes", async () => {
  const vault = createVaultReadModel({
    entities: [
      createEntity("journal", "journal_1", {
        body: "Kept the baseline ordinary.",
        title: "Baseline note",
      }),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });

  const first = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "b".repeat(64),
    vault,
  });
  const second = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-21T12:00:00.000Z",
    sourceBundleHash: "b".repeat(64),
    vault,
  });

  assert.equal(first.source.dataVersion, second.source.dataVersion);
});

test("browser vault replica dataVersion changes when only sourceBundleHash changes", async () => {
  const vault = createVaultReadModel({
    entities: [
      createEntity("journal", "journal_1", {
        body: "Kept the baseline ordinary.",
        title: "Baseline note",
      }),
    ],
    metadata: null,
    vaultRoot: "browser://vault",
  });

  const first = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "b".repeat(64),
    vault,
  });
  const second = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "c".repeat(64),
    vault,
  });

  assert.notEqual(first.source.dataVersion, second.source.dataVersion);
});

test("browser vault query client freezes the exposed replica graph", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "e".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("journal", "journal_1", {
          attributes: {
            mood: "steady",
          },
          body: "A stable private note.",
          title: "Private note",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const entity = client.replica.entities[0];
  assert.ok(entity);

  assert.equal(Object.isFrozen(client.replica), true);
  assert.equal(Object.isFrozen(client.replica.entities), true);
  assert.equal(Object.isFrozen(entity), true);
  assert.equal(Object.isFrozen(entity.attributes), true);
  assert.throws(() => {
    entity.title = "Mutated";
  }, TypeError);
});

test("browser vault replicas validate schema", () => {
  assert.throws(
    () => parseBrowserVaultReplica({
      schema: "murph.browser-vault-replica.wrong",
    }),
    /Browser vault replica\.schema must be murph\.browser-vault-replica\./u,
  );
});

test("browser vault replica keeps metric adherence targets", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "c".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_adherence", {
          frontmatter: {
            runPlan: {
              baselineStart: "2026-04-01",
              baselineEnd: "2026-04-07",
              interventionStart: "2026-04-08",
              interventionEnd: "2026-04-14",
              adherenceTargets: [
                {
                  targetId: "sauna",
                  label: "Sauna",
                  phase: "intervention",
                  calendar: {
                    kind: "daily",
                    timeZone: "America/New_York",
                  },
                  evidence: {
                    kind: "linkedEventCount",
                    eventKind: "intervention_session",
                    missing: "missed_after_grace",
                  },
                },
                {
                  targetId: "steps",
                  label: "Step floor",
                  phase: "intervention",
                  calendar: {
                    kind: "daily",
                    timeZone: "America/New_York",
                  },
                  evidence: {
                    kind: "metricThreshold",
                    metricKey: "steps",
                    op: ">=",
                    value: 8000,
                    missing: "unknown",
                  },
                },
              ],
            },
          },
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const experiment = parseBrowserVaultReplica(replica).entities[0];
  const runPlan = experiment?.attributes.runPlan;
  assert.ok(runPlan && typeof runPlan === "object" && !Array.isArray(runPlan));
  const targets = (runPlan as Record<string, unknown>).adherenceTargets;
  assert.ok(Array.isArray(targets));
  assert.equal(targets.length, 2);
  assert.equal((targets[0] as Record<string, unknown>).targetId, "sauna");
  assert.equal((targets[1] as Record<string, unknown>).targetId, "steps");
});

test("browser vault replica does not request custom metric rows for unsupported adherence targets", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "d".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_custom_metric_adherence", {
          frontmatter: {
            runPlan: {
              baselineStart: "2026-04-01",
              baselineEnd: "2026-04-07",
              interventionStart: "2026-04-08",
              interventionEnd: "2026-04-14",
              adherenceTargets: [{
                targetId: "custom-score",
                label: "Custom score",
                phase: "intervention",
                calendar: {
                  kind: "daily",
                  timeZone: "UTC",
                },
                evidence: {
                  kind: "metricThreshold",
                  metricKey: "custom-reaction-time",
                  op: "<=",
                  value: 300,
                  missing: "unknown",
                },
              }],
            },
          },
        }),
        createEntity("sample", "smp_custom_reaction_time", {
          attributes: {
            metric: "custom-reaction-time",
            source: "manual",
            unit: "ms",
            value: 280,
          },
          kind: "metric_sample",
          occurredAt: "2026-04-08T08:00:00.000Z",
          path: "ledger/metric-samples/custom-reaction-time/2026/2026-04.jsonl",
          stream: "custom-reaction-time",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  assert.equal(replica.metricRows.some((row) =>
    row.metricKey === "custom-reaction-time" &&
    row.recordIds.includes("smp_custom_reaction_time")
  ), false);
});

test("browser vault replica keeps old anchored metric points by contributing record id", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-06-01T12:00:00.000Z",
    metricPoints: [
      createMetricPoint({
        biomarkerKey: "biomarker:resting-heart-rate",
        contributingRecordIds: ["sample_anchor_rhr_baseline"],
        effectiveDate: "2025-01-01",
        metricKey: "resting-heart-rate",
        recordId: "summary_rhr_baseline",
        unit: "bpm",
        value: 62,
      }),
    ],
    sourceBundleHash: "d".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_anchor_rhr", {
          frontmatter: {
            analysisPlan: {
              primaryBiomarkerKey: "biomarker:resting-heart-rate",
              measurementAnchors: [{
                role: "baseline",
                kind: "wearable_summary",
                recordId: "sample_anchor_rhr_baseline",
                biomarkerKeys: ["biomarker:resting-heart-rate"],
              }],
            },
            runPlan: {
              baselineStart: "2026-05-01",
              baselineEnd: "2026-05-07",
              interventionStart: "2026-05-08",
              interventionEnd: "2026-05-14",
            },
          },
          kind: "experiment",
        }),
      ],
      metadata: null,
      vaultRoot: "browser://vault",
    }),
  });

  const row = replica.metricRows.find((entry) => entry.metricKey === "resting-heart-rate");
  assert.ok(row);
  assert.equal(row.date, "2025-01-01");
  assert.equal(row.recordIds.includes("sample_anchor_rhr_baseline"), true);
});

test("browser vault replica projects experiment event fields only for relevant event kinds", async () => {
  const replica = await createBrowserVaultReplicaFromVault({
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "d".repeat(64),
    vault: createVaultReadModel({
      entities: [
        createEntity("event", "evt_session", {
          attributes: {
            afterExercise: true,
            confounders: {
              travel: true,
              trainingLoad: "heavy",
            },
            durationMinutes: 18,
            effectiveProtocolSnapshot: {
              doseSignature: "Sensitive generic snapshot should not be projected.",
            },
            experimentId: "exp_sauna",
            experimentSlug: "sauna-rhr",
            externalId: "provider-session-1",
            externalRef: {
              resourceId: "provider-session-1",
              system: "provider",
            },
            interventionType: "dry-sauna",
            markdownBody: "# Raw note",
            note: "Felt lightheaded near the end.",
            protocolId: "prot_sauna",
            provenance: {
              importedFrom: "provider",
            },
            rawProvenance: {
              payloadId: "raw-1",
            },
            regimenId: "reg_sauna",
            runPlan: {
              interventionStart: "2026-04-20",
            },
            scheduledLocalDate: "2026-04-20",
            sessionStatus: "partial",
            sessionLocalDate: "2026-04-20",
            summary: "Generic event summary should not be projected.",
            symptoms: ["lightheaded"],
            temperatureC: 88,
            timing: "evening",
          },
          body: "# Session note\n\nFelt lightheaded near the end.",
          experimentSlug: "sauna-rhr",
          kind: "intervention_session",
          links: [
            {
              targetId: "reg_sauna",
              type: "related_to",
            },
          ],
          lookupIds: ["provider-session-1", "reg_sauna"],
          primaryLookupId: "provider-session-1",
          tags: ["dry-sauna", "lightheaded"],
          title: "Dry sauna 25 minutes lightheaded",
        }),
        createEntity("event", "evt_context", {
          attributes: {
            contextType: "travel",
            experimentId: "exp_sauna",
            experimentSlug: "sauna-rhr",
            externalId: "provider-context-1",
            note: "Travel day.",
            providerRef: "provider-context-1",
            rawProvenance: {
              payloadId: "raw-2",
            },
            severity: "potential_confounder",
            summary: "Context summary should not be projected.",
          },
          body: "# Context note\n\nTravel day.",
          experimentSlug: "sauna-rhr",
          kind: "experiment_context",
          links: [
            {
              targetId: "provider-context-1",
              type: "related_to",
            },
          ],
          lookupIds: ["provider-context-1"],
          primaryLookupId: "provider-context-1",
          tags: ["travel"],
          title: "Travel day",
        }),
        createEntity("event", "evt_activity", {
          attributes: {
            afterExercise: true,
            contextType: "training",
            durationMinutes: 45,
            experimentId: "exp_sauna",
            experimentSlug: "sauna-rhr",
            externalId: "activity-1",
            interventionType: "running",
            severity: "info",
            symptoms: ["sore"],
          },
          body: "# Activity note\n\nUnrelated activity details.",
          kind: "activity_session",
          tags: ["morning-run"],
          title: "Morning run",
        }),
        createEntity("journal", "journal_structured_keys", {
          attributes: {
            contextType: "travel",
            durationMinutes: 10,
            experimentId: "exp_sauna",
            experimentSlug: "sauna-rhr",
            interventionType: "dry-sauna",
            sessionStatus: "completed",
          },
          title: "Journal note with structured-looking keys",
        }),
      ],
      metadata: {
        title: "Browser vault event projection fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });

  const client = createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
  const session = client.entities.get("evt_session");
  const context = client.entities.get("evt_context");
  const activity = client.entities.get("evt_activity");
  const journal = client.entities.get("journal_structured_keys");

  assert.ok(session);
  assert.deepEqual(session.attributes, {
    afterExercise: true,
    confounders: {
      travel: true,
      trainingLoad: "heavy",
    },
    experimentId: "exp_sauna",
    experimentSlug: "sauna-rhr",
    note: "Felt lightheaded near the end.",
    protocolId: "prot_sauna",
    scheduledLocalDate: "2026-04-20",
    sessionStatus: "partial",
    sessionLocalDate: "2026-04-20",
    symptoms: ["lightheaded"],
  });
  assert.equal(Object.hasOwn(session.attributes, "durationMinutes"), false);
  assert.equal(Object.hasOwn(session.attributes, "interventionType"), false);
  assert.equal(Object.hasOwn(session.attributes, "regimenId"), false);
  assert.equal(Object.hasOwn(session.attributes, "temperatureC"), false);
  assert.equal(Object.hasOwn(session.attributes, "timing"), false);
  assert.equal(Object.hasOwn(session.attributes, "markdownBody"), false);
  assert.equal(Object.hasOwn(session.attributes, "externalId"), false);
  assert.equal(Object.hasOwn(session.attributes, "externalRef"), false);
  assert.equal(Object.hasOwn(session.attributes, "provenance"), false);
  assert.equal(Object.hasOwn(session.attributes, "rawProvenance"), false);
  assert.equal(Object.hasOwn(session.attributes, "effectiveProtocolSnapshot"), false);
  assert.equal(Object.hasOwn(session.attributes, "runPlan"), false);
  assert.equal(Object.hasOwn(session.attributes, "summary"), false);
  assert.equal(session.bodyPreview, null);
  assert.deepEqual(session.links, []);
  assert.deepEqual(session.lookupIds, ["evt_session"]);
  assert.deepEqual(session.tags, []);
  assert.equal(session.title, null);

  assert.ok(context);
  assert.deepEqual(context.attributes, {
    contextType: "travel",
    experimentId: "exp_sauna",
    experimentSlug: "sauna-rhr",
    note: "Travel day.",
    severity: "potential_confounder",
  });
  assert.equal(Object.hasOwn(context.attributes, "externalId"), false);
  assert.equal(Object.hasOwn(context.attributes, "providerRef"), false);
  assert.equal(Object.hasOwn(context.attributes, "rawProvenance"), false);
  assert.equal(Object.hasOwn(context.attributes, "summary"), false);
  assert.equal(context.bodyPreview, null);
  assert.deepEqual(context.links, []);
  assert.deepEqual(context.lookupIds, ["evt_context"]);
  assert.deepEqual(context.tags, []);
  assert.equal(context.title, null);

  assert.ok(activity);
  assert.deepEqual(activity.attributes, {});
  assert.equal(activity.bodyPreview, null);
  assert.deepEqual(activity.links, []);
  assert.deepEqual(activity.lookupIds, ["evt_activity"]);
  assert.deepEqual(activity.tags, []);
  assert.equal(activity.title, null);

  const timelineTitlesByEntityId = new Map(
    client.replica.timelineRows.map((row) => [row.entityId, row.title]),
  );
  assert.equal(timelineTitlesByEntityId.get("evt_session"), "Intervention session");
  assert.equal(timelineTitlesByEntityId.get("evt_context"), "Experiment context");
  assert.equal(timelineTitlesByEntityId.get("evt_activity"), "Event");

  const timelineTagsByEntityId = new Map(
    client.replica.timelineRows.map((row) => [row.entityId, row.tags]),
  );
  assert.deepEqual(timelineTagsByEntityId.get("evt_session"), []);
  assert.deepEqual(timelineTagsByEntityId.get("evt_context"), []);
  assert.deepEqual(timelineTagsByEntityId.get("evt_activity"), []);

  assert.deepEqual(client.search("sauna", { families: ["event"] }), []);
  assert.deepEqual(client.search("lightheaded", { families: ["event"] }), []);
  assert.deepEqual(client.search("travel", { families: ["event"] }), []);
  assert.deepEqual(client.search("run", { families: ["event"] }), []);

  assert.ok(journal);
  assert.deepEqual(journal.attributes, {});
});

function createEntity(
  family: BrowserVaultEntity["family"],
  entityId: string,
  overrides: Partial<BrowserVaultEntity> = {},
): BrowserVaultEntity {
  const title = overrides.title ?? entityId;
  const kind = overrides.kind ?? `${family}_entry`;
  const stream = overrides.stream ?? null;
  const lookupId = overrides.primaryLookupId ?? entityId;

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
    lookupIds: overrides.lookupIds ?? [lookupId],
    occurredAt: overrides.occurredAt ?? "2026-04-20T00:00:00.000Z",
    path: overrides.path ?? `history/${family}/${entityId}.md`,
    primaryLookupId: lookupId,
    recordClass: overrides.recordClass ?? resolveRecordClass(family),
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream,
    tags: overrides.tags ?? [],
    title,
  };
}

function createMetricPoint(input: {
  biomarkerKey: string | null;
  contributingRecordIds?: readonly string[];
  effectiveDate: string;
  metricKey: string;
  recordId: string;
  unit: string;
  value: number;
}): MetricPoint {
  return {
    biomarkerKey: input.biomarkerKey,
    canonicalUnit: input.unit,
    canonicalValue: input.value,
    comparator: null,
    confidence: "medium",
    context: input.contributingRecordIds
      ? { contributingRecordIds: input.contributingRecordIds.slice() }
      : {},
    effectiveDate: input.effectiveDate,
    grain: "day",
    id: `metric-point:${input.metricKey}:${input.effectiveDate}`,
    metricKey: input.metricKey,
    observedAt: `${input.effectiveDate}T00:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "Wearable summary",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: "murph.metric-point.v1",
    source: {
      family: "derived",
      kind: "wearable-summary",
      path: "",
      recordId: input.recordId,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: input.unit,
    value: input.value,
  };
}

function resolveRecordClass(family: BrowserVaultEntity["family"]): BrowserVaultEntity["recordClass"] {
  switch (family) {
    case "event":
      return "ledger";
    case "experiment":
      return "bank";
    case "journal":
      return "ledger";
    case "sample":
      return "sample";
    default:
      throw new Error(`Unsupported browser-vault test family: ${family}`);
  }
}
