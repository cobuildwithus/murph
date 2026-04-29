import assert from "node:assert/strict";

import { test } from "vitest";

import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  selectBrowserVaultExperimentResults,
  type BrowserVaultEntity,
  type BrowserVaultMetricDayRow,
  type BrowserVaultMetricDomain,
  type BrowserVaultMetricRow,
  type BrowserVaultReplica,
  type BrowserVaultResolvedMetric,
} from "../src/browser.ts";

test("returns null when no matching private run exists", () => {
  const client = createBrowserVaultQueryClient(createReplica());

  assert.equal(
    selectBrowserVaultExperimentResults(client, "missing-run", {
      asOf: "2026-04-10T12:00:00.000Z",
    }),
    null,
  );
});

test("matches private runs by experiment id slug and protocol keys", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          id: "exp_completed",
          slug: "older-sauna-run",
          status: "completed",
          occurredAt: "2026-04-01T08:00:00.000Z",
        }),
        experimentEntity({
          id: "exp_active",
          slug: "active-sauna-run",
          status: "active",
          occurredAt: "2026-04-02T08:00:00.000Z",
        }),
      ],
    }),
  );

  assert.equal(
    selectBrowserVaultExperimentResults(client, { experimentId: "exp_active" })?.experiment.id,
    "exp_active",
  );
  assert.equal(
    selectBrowserVaultExperimentResults(client, { slug: "active-sauna-run" })?.experiment.slug,
    "active-sauna-run",
  );
  assert.equal(
    selectBrowserVaultExperimentResults(client, { protocolKeys: ["protocol:finnish-sauna"] })
      ?.experiment.id,
    "exp_active",
  );
});

test("uses the latest active matching private run when lookup candidates tie", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          id: "exp_active_old",
          slug: "sauna-old",
          status: "active",
          occurredAt: "2026-04-01T08:00:00.000Z",
        }),
        experimentEntity({
          id: "exp_active_new",
          slug: "sauna-new",
          status: "active",
          occurredAt: "2026-04-10T08:00:00.000Z",
        }),
      ],
    }),
  );

  assert.equal(
    selectBrowserVaultExperimentResults(client, { protocolKeys: ["protocol:finnish-sauna"] })
      ?.experiment.id,
    "exp_active_new",
  );
});

test("builds active baseline results using generatedAt as the default asOf", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-04T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-21",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
            targetSessions: 14,
            minimumUsefulSessions: 8,
          },
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-02", 61],
        ["2026-04-03", 63],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, {
    slug: "finnish-sauna-run",
  });

  assert.ok(result);
  assert.equal(result.asOf, "2026-04-04T12:00:00.000Z");
  assert.equal(result.experiment.phase, "baseline");
  assert.equal(result.progress?.phase, "baseline");
  assert.equal(result.outcome, null);
  assert.equal(result.biomarkers[0]?.status, "available");
  assert.equal(result.biomarkers[0]?.baseline.daysWithData, 3);
  assert.equal(result.biomarkers[0]?.intervention.daysWithData, 0);
  assert.equal(result.biomarkers[0]?.points.every((point) => point.phase === "baseline"), true);
  assert.equal(result.schedule?.cells[0]?.kind, "scheduled");
  assert.equal(Object.hasOwn(result, "events"), false);
});

test("builds active intervention progress and preserves schedule session statuses", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-12T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-14",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
            targetSessions: 7,
            minimumUsefulSessions: 4,
          },
        }),
        sessionEvent("2026-04-08", "completed"),
        sessionEvent("2026-04-09", "partial"),
        sessionEvent("2026-04-10", "skipped"),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-02", 61],
        ["2026-04-03", 63],
        ["2026-04-08", 60],
        ["2026-04-09", 59],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "exp_sauna", {
    asOf: "2026-04-12T12:00:00.000Z",
  });

  assert.ok(result);
  assert.equal(result.experiment.phase, "intervention");
  assert.equal(result.progress?.adherence.completedSessions, 1);
  assert.equal(result.progress?.adherence.partialSessions, 1);
  assert.equal(result.progress?.adherence.skippedSessions, 1);
  assert.equal(result.progress?.adherence.loggedSessions, 2);
  assert.deepEqual(
    result.schedule?.cells
      .filter((cell) => cell.source === "event")
      .map((cell) => [cell.localDate, cell.kind]),
    [
      ["2026-04-08", "completed"],
      ["2026-04-09", "partial"],
      ["2026-04-10", "skipped"],
    ],
  );
  assert.equal(result.biomarkers[0]?.intervention.daysWithData, 2);
});

test("matches session events to schedule cells using the run schedule time zone", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-11T12:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-11",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
          },
        }),
        sessionEvent("2026-04-11", "completed", {
          occurredAt: "2026-04-11T03:30:00.000Z",
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run", {
    asOf: "2026-04-11T12:00:00.000Z",
  });

  assert.ok(result);
  assert.deepEqual(
    result.schedule?.cells
      .filter((cell) => cell.source === "event")
      .map((cell) => [cell.localDate, cell.kind]),
    [["2026-04-10", "completed"]],
  );
});

test("uses the run schedule time zone for phase and adherence dates", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-08T01:00:00.000Z",
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-07",
            interventionStart: "2026-04-08",
            interventionEnd: "2026-04-14",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/Los_Angeles",
            },
            targetSessions: 7,
          },
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.phase, "baseline");
  assert.equal(result.progress?.phase, "baseline");
  assert.equal(result.progress?.adherence.expectedSessionsByNow, null);
});

test("builds finished outcomes when enough baseline and intervention data exists", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-20T12:00:00.000Z",
      entities: [
        experimentEntity({
          status: "completed",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-06",
            schedule: {
              kind: "dailyLocal",
              localTime: "08:00",
              timeZone: "America/New_York",
            },
            targetSessions: 3,
            minimumUsefulSessions: 2,
          },
        }),
        sessionEvent("2026-04-04", "completed"),
        sessionEvent("2026-04-05", "completed"),
        sessionEvent("2026-04-06", "completed"),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 63],
        ["2026-04-02", 62],
        ["2026-04-03", 61],
        ["2026-04-04", 59],
        ["2026-04-05", 58],
        ["2026-04-06", 57],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.experiment.phase, "completed");
  assert.equal(result.progress?.dataCoverage.status, "ready_for_review");
  assert.equal(result.outcome?.status, "enough_data");
  assert.equal(result.outcome?.confidence.level, "high");
  assert.equal(result.biomarkers[0]?.completeness, "good");
  assert.equal(result.biomarkers[0]?.deltaAbs, -4);
  assert.equal(result.biomarkers[0]?.movedAsExpected, true);
});

test("keeps sparse finished outcomes low-confidence instead of inventing certainty", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      generatedAt: "2026-04-20T12:00:00.000Z",
      entities: [
        experimentEntity({
          status: "completed",
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-06",
            targetSessions: 3,
            minimumUsefulSessions: 2,
          },
        }),
        sessionEvent("2026-04-04", "completed"),
      ],
      metricRows: restingHeartRateRows([["2026-04-01", 63]]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.biomarkers[0]?.status, "available");
  assert.equal(result.biomarkers[0]?.completeness, "partial");
  assert.equal(result.outcome?.status, "sparse_data");
  assert.equal(result.outcome?.confidence.level, "low");
  assert.ok(
    result.outcome?.confidence.reasons.some((reason) =>
      reason.includes("Primary biomarker coverage is insufficient"),
    ),
  );
});

test("represents unsupported biomarkers instead of dropping them", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          analysisPlan: {
            primaryBiomarkerKey: "biomarker:resting-heart-rate",
            secondaryBiomarkerKeys: ["biomarker:morning-blood-pressure"],
            desiredDirection: "decrease",
          },
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-08", 60],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.deepEqual(
    result.biomarkers.map((biomarker) => [biomarker.biomarkerKey, biomarker.status]),
    [
      ["biomarker:resting-heart-rate", "available"],
      ["biomarker:morning-blood-pressure", "unsupported_source"],
    ],
  );
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "unsupported_biomarker" &&
        diagnostic.biomarkerKey === "biomarker:morning-blood-pressure",
    ),
  );
});

test("keeps supported biomarkers with no browser points as no_data", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          analysisPlan: {
            primaryBiomarkerKey: "biomarker:resting-heart-rate",
            desiredDirection: "decrease",
          },
        }),
      ],
      metricRows: [],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.biomarkers[0]?.status, "no_data");
  assert.equal(result.biomarkers[0]?.points.length, 0);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "sparse_data" &&
        diagnostic.biomarkerKey === "biomarker:resting-heart-rate",
    ),
  );
});

test("keeps expected-effect records without creating an expected range band", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          expectedSignalDescriptions: [
            {
              biomarkerKey: "biomarker:resting-heart-rate",
              description: "Watch averaged resting heart rate without expecting a guaranteed drop.",
              expected: "mixed_or_contextual",
              sourceKeys: ["source_artifact:example"],
            },
          ],
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-08", 60],
      ]),
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.biomarkers[0]?.expectedEffect.direction, "mixed");
  assert.equal(result.biomarkers[0]?.expectedEffect.expectedRange, null);
  assert.deepEqual(result.biomarkers[0]?.expectedEffect.sourceKeys, ["source_artifact:example"]);
});

test("parses only complete expected-effect ranges", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          expectedSignalDescriptions: [
            {
              biomarkerKey: "biomarker:resting-heart-rate",
              range: {
                startDay: 8,
                endDay: 14,
                low: -5,
                high: -2,
                scale: "percent",
                sourceKeys: ["source_artifact:range"],
              },
            },
          ],
        }),
        experimentEntity({
          id: "exp_bad_range",
          slug: "bad-range-run",
          expectedSignalDescriptions: [
            {
              biomarkerKey: "biomarker:resting-heart-rate",
              range: {
                startDay: 8,
                low: -5,
                high: -2,
                scale: "percent",
              },
            },
          ],
        }),
      ],
      metricRows: restingHeartRateRows([
        ["2026-04-01", 62],
        ["2026-04-08", 60],
      ]),
    }),
  );

  const valid = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");
  const malformed = selectBrowserVaultExperimentResults(client, "bad-range-run");

  assert.equal(valid?.biomarkers[0]?.expectedEffect.expectedRange?.scale, "percent");
  assert.deepEqual(valid?.biomarkers[0]?.expectedEffect.expectedRange?.sourceKeys, [
    "source_artifact:range",
  ]);
  assert.equal(malformed?.biomarkers[0]?.expectedEffect.expectedRange, null);
});

test("returns null schedule when the run has no structured schedule", () => {
  const client = createBrowserVaultQueryClient(
    createReplica({
      entities: [
        experimentEntity({
          runPlan: {
            baselineStart: "2026-04-01",
            baselineEnd: "2026-04-03",
            interventionStart: "2026-04-04",
            interventionEnd: "2026-04-06",
          },
        }),
      ],
    }),
  );

  const result = selectBrowserVaultExperimentResults(client, "finnish-sauna-run");

  assert.ok(result);
  assert.equal(result.schedule, null);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "no_schedule"));
});

function createReplica(input: {
  entities?: BrowserVaultEntity[];
  generatedAt?: string;
  metricRows?: BrowserVaultMetricRow[];
} = {}): BrowserVaultReplica {
  const metricRows = input.metricRows ?? [];

  return {
    assistantSummary: {
      highlights: [],
      latestDate: null,
    },
    entities: input.entities ?? [],
    generatedAt: input.generatedAt ?? "2026-04-10T12:00:00.000Z",
    metricDayRows: metricRowsToDayRows(metricRows),
    metricRows,
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: ["experiment", "event"],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: {
      dataVersion: "test",
      sourceBundleHash: "a".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}

function experimentEntity(input: {
  analysisPlan?: Record<string, unknown>;
  expectedSignalDescriptions?: unknown[];
  id?: string;
  occurredAt?: string;
  runPlan?: Record<string, unknown>;
  slug?: string;
  status?: string;
} = {}): BrowserVaultEntity {
  const id = input.id ?? "exp_sauna";
  const slug = input.slug ?? "finnish-sauna-run";
  const status = input.status ?? "active";

  return {
    attributes: {
      analysisPlan: input.analysisPlan ?? {
        primaryBiomarkerKey: "biomarker:resting-heart-rate",
        desiredDirection: "decrease",
      },
      commonsProtocolRef: {
        key: "protocol:finnish-sauna",
        pageRevisionId: "sha256:page",
        runSpecRevisionId: "sha256:run",
        testPlanId: "rhr-21d",
      },
      expectedSignalDescriptions: input.expectedSignalDescriptions,
      experimentId: id,
      runPlan: input.runPlan ?? {
        baselineStart: "2026-04-01",
        baselineEnd: "2026-04-07",
        interventionStart: "2026-04-08",
        interventionEnd: "2026-04-21",
        targetSessions: 6,
        minimumUsefulSessions: 4,
      },
      slug,
      status,
    },
    bodyPreview: null,
    date: "2026-04-01",
    experimentSlug: slug,
    family: "experiment",
    id,
    kind: "experiment",
    links: [],
    lookupIds: [id, slug],
    occurredAt: input.occurredAt ?? "2026-04-01T08:00:00.000Z",
    recordClass: "bank",
    status,
    stream: null,
    tags: ["sauna"],
    title: "Finnish sauna run",
  };
}

function sessionEvent(
  date: string,
  sessionStatus: string,
  overrides: Partial<Pick<BrowserVaultEntity, "occurredAt">> = {},
): BrowserVaultEntity {
  return {
    attributes: {
      experimentId: "exp_sauna",
      experimentSlug: "finnish-sauna-run",
      sessionStatus,
    },
    bodyPreview: null,
    date,
    experimentSlug: "finnish-sauna-run",
    family: "event",
    id: `evt_${date}_${sessionStatus}`,
    kind: "intervention_session",
    links: [{ targetId: "exp_sauna", type: "related" }],
    lookupIds: [`evt_${date}_${sessionStatus}`],
    occurredAt: overrides.occurredAt ?? `${date}T13:00:00.000Z`,
    recordClass: "ledger",
    status: null,
    stream: null,
    tags: ["sauna"],
    title: "Sauna session",
  };
}

function restingHeartRateRows(entries: readonly (readonly [string, number])[]): BrowserVaultMetricRow[] {
  return entries.map(([date, value]) =>
    metricRow({
      date,
      domain: "recovery",
      metric: "restingHeartRate",
      unit: "bpm",
      value,
    }),
  );
}

function metricRow(input: {
  date: string;
  domain: BrowserVaultMetricDomain;
  metric: string;
  unit: string;
  value: number;
}): BrowserVaultMetricRow {
  return {
    confidence: "medium",
    date: input.date,
    domain: input.domain,
    id: `${input.domain}:${input.date}:${input.metric}`,
    metric: input.metric,
    recordIds: [],
    sourceFamily: "derived",
    sourceKind: "summary",
    unit: input.unit,
    value: input.value,
  };
}

function metricRowsToDayRows(rows: readonly BrowserVaultMetricRow[]): BrowserVaultMetricDayRow[] {
  const dayRows = new Map<string, BrowserVaultMetricDayRow>();

  for (const row of rows) {
    const id = `${row.domain}:${row.date}`;
    const existing = dayRows.get(id);
    const metrics: Record<string, BrowserVaultResolvedMetric> = {
      ...(existing?.metrics ?? {}),
      [row.metric]: {
        selection: {
          unit: row.unit,
          value: row.value,
        },
      },
    };

    dayRows.set(id, {
      attributes: existing?.attributes ?? {},
      confidence: existing?.confidence ?? row.confidence,
      date: row.date,
      domain: row.domain,
      id,
      metricIds: Object.keys(metrics).map((metric) => `${row.domain}:${row.date}:${metric}`),
      metrics,
      notes: existing?.notes ?? [],
    });
  }

  return [...dayRows.values()].sort((left, right) => right.date.localeCompare(left.date));
}
