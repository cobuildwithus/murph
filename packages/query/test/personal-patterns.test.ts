import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  createBrowserVaultReplica,
  parseBrowserVaultReplica,
} from "../src/browser.ts";
import { buildPersonalPatternReport } from "../src/personal-patterns.ts";
import { createVaultReadModel } from "../src/read-model.ts";
import {
  buildPersonalPatternReportRuntime,
  rebuildQueryProjection,
} from "../src/query-projection.ts";

test("Personal Patterns keeps a repeated next-day link and matched comparison evidence", async () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) => addDays(start, index * 14));
  const entities: CanonicalEntity[] = [
    ...runningDates.map((date, index) => event(`run_${index}`, date, "activity_session", {
      activityType: index % 2 === 0 ? "run" : "running",
    })),
    ...Array.from({ length: 112 }, (_, index) => {
      const date = addDays(start, index);
      const priorDate = addDays(date, -1);
      return observation(`hrv_${index}`, date, "hrv", runningDates.includes(priorDate) ? 70 : 50, "ms");
    }),
  ];
  const vault = createVaultReadModel({
    entities,
    vaultRoot: "test://personal-patterns",
  });
  const report = buildPersonalPatternReport(vault, {
    asOf: "2026-04-27T12:00:00.000Z",
  });

  assert.deepEqual(report.factors, [{
    id: "running",
    kind: "activity",
    label: "Running",
    observedDays: 8,
  }]);
  const hrv = report.cells.find((cell) => cell.factorId === "running" && cell.outcomeId === "hrv");
  assert.ok(hrv);
  assert.equal(hrv.stage, "seen_again");
  assert.equal(hrv.direction, "higher");
  assert.equal(hrv.repeatedDirection, true);
  assert.equal(hrv.exposedDays, 8);
  assert.equal(hrv.comparisonDays, 8);
  assert.equal(hrv.exposedMean, 70);
  assert.equal(hrv.comparisonMean, 50);
  assert.equal(hrv.deltaPercent, 40);
  assert.equal(report.lagDays, 1);
  assert.match(report.notes.join(" "), /association, not proof/u);

  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-27T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "p".repeat(64),
    vault,
  });
  const parsed = parseBrowserVaultReplica(replica);
  assert.deepEqual(parsed.personalPatterns, report);
});

test("Browser Vault parsing preserves a missing legacy Personal Patterns projection", async () => {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-27T12:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "l".repeat(64),
    vault: createVaultReadModel({
      entities: [],
      vaultRoot: "test://legacy-personal-patterns",
    }),
  });
  replica.generation = BROWSER_VAULT_REPLICA_CURRENT_GENERATION - 1;
  delete replica.personalPatterns;

  const parsed = parseBrowserVaultReplica(replica);

  assert.equal(parsed.personalPatterns, undefined);
});

test("Personal Patterns qualifies factors before applying the six-row display cap", () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) => addDays(start, index * 14));
  const dailyFactors = ["breathwork", "journaling", "meditation", "mobility", "stretching", "walking"];
  const entities: CanonicalEntity[] = [
    ...Array.from({ length: 112 }, (_, dayIndex) =>
      dailyFactors.map((activityType, factorIndex) =>
        event(`daily_${factorIndex}_${dayIndex}`, addDays(start, dayIndex), "activity_session", { activityType })
      )
    ).flat(),
    ...runningDates.map((date, index) => event(`run_cap_${index}`, date, "activity_session", {
      activityType: "running",
    })),
    ...Array.from({ length: 112 }, (_, index) => {
      const date = addDays(start, index);
      return observation(
        `hrv_cap_${index}`,
        date,
        "hrv",
        runningDates.includes(addDays(date, -1)) ? 70 : 50,
        "ms",
      );
    }),
  ];
  const report = buildPersonalPatternReport(createVaultReadModel({
    entities,
    vaultRoot: "test://personal-pattern-cap",
  }), {
    asOf: "2026-04-27T12:00:00.000Z",
  });

  assert.deepEqual(report.factors.map((factor) => factor.id), ["running"]);
  assert.equal(report.cells.find((cell) => cell.outcomeId === "hrv")?.stage, "seen_again");
});

test("Personal Patterns uses the nearest unused same-weekday comparisons", () => {
  const start = "2026-01-05";
  const runningDates = [0, 14, 28, 42, 56].map((offset) => addDays(start, offset));
  const comparisonDates = [7, 21, 35, 49, 63].map((offset) => addDays(start, offset));
  const comparisonValues = [10, 50, 50, 50, 50];
  const wrongWeekdayDates = [1, 15, 29, 43, 57].map((offset) => addDays(start, offset));
  const report = buildPersonalPatternReport(createVaultReadModel({
    entities: [
      ...runningDates.map((date, index) => event(`run_match_${index}`, date, "activity_session", {
        activityType: "running",
      })),
      ...runningDates.map((date, index) =>
        observation(`hrv_exposed_${index}`, addDays(date, 1), "hrv", 70, "ms")
      ),
      ...comparisonDates.map((date, index) =>
        observation(`hrv_control_${index}`, addDays(date, 1), "hrv", comparisonValues[index] ?? 50, "ms")
      ),
      ...wrongWeekdayDates.map((date, index) =>
        observation(`hrv_wrong_weekday_${index}`, addDays(date, 1), "hrv", 95, "ms")
      ),
    ],
    vaultRoot: "test://personal-pattern-matching",
  }), {
    asOf: addDays(start, 70),
  });
  const hrv = report.cells.find((cell) => cell.outcomeId === "hrv");

  assert.ok(hrv);
  assert.equal(hrv.comparisonDays, 5);
  assert.equal(hrv.comparisonMean, 42);
  assert.equal(hrv.exposedMean, 70);
});

test("Personal Patterns rejects controls on the wrong weekday or beyond 35 days", () => {
  const start = "2026-03-02";
  const runningDates = [0, 7, 14, 21, 28].map((offset) => addDays(start, offset));
  const remoteDates = [-70, -63, -56, -49, -42].map((offset) => addDays(start, offset));
  const report = buildPersonalPatternReport(createVaultReadModel({
    entities: [
      ...runningDates.map((date, index) => event(`run_guard_${index}`, date, "activity_session", {
        activityType: "running",
      })),
      ...runningDates.map((date, index) =>
        observation(`hrv_guard_exposed_${index}`, addDays(date, 1), "hrv", 70, "ms")
      ),
      ...runningDates.map((date, index) =>
        observation(`hrv_guard_wrong_${index}`, addDays(date, 2), "hrv", 40, "ms")
      ),
      ...remoteDates.map((date, index) =>
        observation(`hrv_guard_remote_${index}`, addDays(date, 1), "hrv", 50, "ms")
      ),
    ],
    vaultRoot: "test://personal-pattern-control-guards",
  }), {
    asOf: addDays(start, 35),
    windowDays: 120,
  });

  assert.deepEqual(report.factors, []);
  assert.deepEqual(report.cells, []);
});

test("Personal Patterns keeps the evidence-stage boundaries and repeated-direction guard", () => {
  const cases = [
    { count: 5, expected: "new_clue", exposed: () => 70, name: "five over 21 days", span: 21 },
    { count: 5, expected: undefined, exposed: () => 70, name: "five under 21 days", span: 20 },
    { count: 8, expected: "seen_again", exposed: () => 70, name: "eight over 42 days", span: 42 },
    { count: 8, expected: "new_clue", exposed: () => 70, name: "eight under 42 days", span: 41 },
    { count: 12, expected: "worth_testing", exposed: () => 53.75, name: "twelve over 56 days at 1.5x", span: 56 },
    { count: 12, expected: "seen_again", exposed: () => 53.74, name: "twelve over 56 days under 1.5x", span: 56 },
    { count: 12, expected: "seen_again", exposed: () => 53.75, name: "twelve under 56 days", span: 55 },
    {
      count: 8,
      expected: "no_clear_pattern",
      exposed: (index: number) => index < 4 ? 80 : 45,
      name: "conflicting historical halves",
      span: 42,
    },
  ] as const;

  for (const entry of cases) {
    const report = buildHrvStageFixture(entry.count, entry.span, entry.exposed);
    const stage = report.cells.find((cell) => cell.outcomeId === "hrv")?.stage;
    assert.equal(stage, entry.expected, entry.name);
  }
});

test("Personal Patterns anchors sleep outcomes to the localized sleep-end date in direct and runtime reads", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-personal-pattern-sleep-date-"));
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) => addDays(start, index * 14));
  const canonicalEntities: CanonicalEntity[] = runningDates.map((date, index) =>
    event(`run_sleep_${index}`, date, "activity_session", { activityType: "running" })
  );
  const ledgerEvents: Array<Record<string, unknown>> = runningDates.map((date, index) => ({
    activityType: "running",
    dayKey: date,
    id: `evt_sleep_date_run_${index}`,
    kind: "activity_session",
    occurredAt: `${date}T12:00:00.000Z`,
    schemaVersion: "murph.event.v1",
    source: "manual",
    title: "Running",
  }));

  for (let index = 0; index < 112; index += 1) {
    const localEndDate = addDays(start, index);
    const storedDate = addDays(localEndDate, -1);
    const sleepScore = runningDates.includes(addDays(localEndDate, -1)) ? 90 : 70;
    const sleepAttributes = {
      durationMinutes: 480,
      endAt: `${storedDate}T23:00:00.000Z`,
      externalRef: {
        resourceId: `sleep-date-${index}`,
        resourceType: "sleep",
        system: "oura",
      },
      sleepType: "main_sleep",
      startAt: `${storedDate}T15:00:00.000Z`,
      timeZone: "Asia/Tokyo",
    };
    canonicalEntities.push(
      event(`sleep_date_${index}`, storedDate, "sleep_session", sleepAttributes),
      observation(`sleep_score_date_${index}`, storedDate, "sleep-score", sleepScore, "score"),
    );
    ledgerEvents.push(
      {
        dayKey: storedDate,
        id: `evt_sleep_date_${index}`,
        kind: "sleep_session",
        occurredAt: sleepAttributes.startAt,
        recordedAt: sleepAttributes.endAt,
        schemaVersion: "murph.event.v1",
        source: "device",
        title: "Provider sleep session",
        ...sleepAttributes,
      },
      {
        dayKey: storedDate,
        externalRef: {
          resourceId: `sleep-score-date-${index}`,
          resourceType: "daily-summary",
          system: "oura",
        },
        id: `evt_sleep_score_date_${index}`,
        kind: "observation",
        metric: "sleep-score",
        observationGrain: "daily-summary",
        occurredAt: `${storedDate}T23:00:00.000Z`,
        recordedAt: `${storedDate}T23:05:00.000Z`,
        schemaVersion: "murph.event.v1",
        source: "device",
        title: "Sleep score",
        unit: "score",
        value: sleepScore,
      },
    );
  }

  const direct = buildPersonalPatternReport(createVaultReadModel({
    entities: canonicalEntities,
    metadata: { timezone: "UTC" },
    vaultRoot: "test://personal-pattern-sleep-date",
  }), {
    asOf: "2026-04-27T12:00:00.000Z",
  });
  const directCell = direct.cells.find((cell) => cell.outcomeId === "sleep-score");
  assert.ok(directCell);
  assert.equal(directCell.exposedMean, 90);
  assert.equal(directCell.comparisonMean, 70);
  assert.equal(directCell.stage, "seen_again");

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), `${JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Personal Patterns localized sleep fixture",
      vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4S",
    })}\n`, "utf8");
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-01.jsonl"),
      `${ledgerEvents.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
    await rebuildQueryProjection(vaultRoot);

    const runtime = await buildPersonalPatternReportRuntime(vaultRoot, { asOf: "2026-04-27" });
    const runtimeCell = runtime.cells.find((cell) => cell.outcomeId === "sleep-score");
    assert.ok(runtimeCell);
    assert.equal(runtimeCell.exposedMean, directCell.exposedMean);
    assert.equal(runtimeCell.comparisonMean, directCell.comparisonMean);
    assert.equal(runtimeCell.stage, directCell.stage);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Personal Patterns uses the intended local date for retroactively logged interventions", () => {
  const start = "2026-01-05";
  const sessionDates = Array.from({ length: 8 }, (_, index) => addDays(start, index * 14));
  const entities: CanonicalEntity[] = [
    ...sessionDates.map((sessionLocalDate, index) =>
      event(
        `sauna_local_date_${index}`,
        addDays(sessionLocalDate, 1),
        "intervention_session",
        {
          interventionType: "dry-sauna",
          sessionLocalDate,
          sessionStatus: "completed",
        },
      )
    ),
    ...Array.from({ length: 112 }, (_, index) => {
      const date = addDays(start, index);
      return observation(
        `hrv_local_date_${index}`,
        date,
        "hrv",
        sessionDates.includes(addDays(date, -1)) ? 70 : 50,
        "ms",
      );
    }),
  ];
  const report = buildPersonalPatternReport(createVaultReadModel({
    entities,
    vaultRoot: "test://personal-pattern-intervention-local-date",
  }), {
    asOf: "2026-04-27T12:00:00.000Z",
  });
  const hrv = report.cells.find((cell) => cell.factorId === "dry-sauna" && cell.outcomeId === "hrv");

  assert.ok(hrv);
  assert.equal(hrv.exposedMean, 70);
  assert.equal(hrv.comparisonMean, 50);
  assert.equal(hrv.stage, "seen_again");
});

test("Personal Patterns excludes explicit nap-only days from sleep outcomes", () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) => addDays(start, index * 14));
  const entities: CanonicalEntity[] = [
    ...runningDates.map((date, index) => event(`run_nap_${index}`, date, "activity_session", {
      activityType: "running",
    })),
  ];

  for (let index = 0; index < 112; index += 1) {
    const date = addDays(start, index);
    entities.push(
      event(`nap_${index}`, date, "sleep_session", {
        durationMinutes: 60,
        endAt: `${date}T14:00:00.000Z`,
        externalRef: {
          resourceId: `nap-${index}`,
          resourceType: "sleep",
          system: "oura",
        },
        sleepType: "nap",
        startAt: `${date}T13:00:00.000Z`,
        timeZone: "UTC",
      }),
      observation(
        `nap_score_${index}`,
        date,
        "sleep-score",
        runningDates.includes(addDays(date, -1)) ? 90 : 70,
        "score",
      ),
    );
  }

  const report = buildPersonalPatternReport(createVaultReadModel({
    entities,
    vaultRoot: "test://personal-pattern-nap-only",
  }), {
    asOf: "2026-04-27T12:00:00.000Z",
  });

  assert.equal(report.outcomes.some((outcome) => outcome.id === "sleep-score"), false);
  assert.equal(report.cells.some((cell) => cell.outcomeId === "sleep-score"), false);
});

test("Personal Patterns reports a tested but unclear link without calling it a finding", () => {
  const start = "2026-01-05";
  const saunaDates = Array.from({ length: 8 }, (_, index) => addDays(start, index * 14));
  const entities: CanonicalEntity[] = [
    ...saunaDates.map((date, index) => event(`sauna_${index}`, date, "intervention_session", {
      interventionType: "dry-sauna",
      sessionStatus: "completed",
    })),
    event("missed_sauna", addDays(start, 3), "intervention_session", {
      interventionType: "dry-sauna",
      sessionStatus: "missed",
    }),
    ...Array.from({ length: 112 }, (_, index) =>
      observation(`sleep_${index}`, addDays(start, index), "sleep-score", 80, "score")
    ),
  ];
  const report = buildPersonalPatternReport(createVaultReadModel({
    entities,
    vaultRoot: "test://personal-patterns",
  }), {
    asOf: "2026-04-27T12:00:00.000Z",
  });

  assert.equal(report.factors[0]?.observedDays, 8);
  const cell = report.cells.find((candidate) => candidate.outcomeId === "sleep-score");
  assert.ok(cell);
  assert.equal(cell.stage, "no_clear_pattern");
  assert.equal(cell.direction, "flat");
  assert.equal(report.repeatableCellCount, 0);
  assert.equal(report.testedCellCount, 1);
});

test("Personal Patterns suppresses factors without enough matched history", () => {
  const start = "2026-03-02";
  const entities: CanonicalEntity[] = [
    ...[0, 7, 14].map((offset, index) => event(`walk_${index}`, addDays(start, offset), "activity_session", {
      activityType: "walking",
    })),
    ...Array.from({ length: 35 }, (_, index) =>
      sample(`recovery_${index}`, addDays(start, index), "recovery_score", 70 + (index % 2), "%")
    ),
  ];
  const report = buildPersonalPatternReport(createVaultReadModel({
    entities,
    vaultRoot: "test://personal-patterns",
  }), {
    asOf: "2026-04-05T12:00:00.000Z",
  });

  assert.deepEqual(report.factors, []);
  assert.deepEqual(report.outcomes, []);
  assert.deepEqual(report.cells, []);
  assert.equal(report.testedCellCount, 0);
});

test("Personal Patterns suppresses outcome-like activity and intervention factors", () => {
  const start = "2026-01-05";
  const factorDates = Array.from({ length: 8 }, (_, index) => addDays(start, index * 14));
  const entities: CanonicalEntity[] = [
    ...factorDates.flatMap((date, index) => [
      event(`sleep_${index}`, date, "intervention_session", {
        interventionType: "sleep",
        sessionStatus: "completed",
      }),
      event(`hrv_${index}`, date, "activity_session", {
        activityType: "hrv",
      }),
    ]),
    ...Array.from({ length: 112 }, (_, index) => {
      const date = addDays(start, index);
      return observation(
        `sleep_score_${index}`,
        date,
        "sleep-score",
        factorDates.includes(addDays(date, -1)) ? 90 : 70,
        "score",
      );
    }),
  ];
  const report = buildPersonalPatternReport(createVaultReadModel({
    entities,
    vaultRoot: "test://personal-patterns",
  }), {
    asOf: "2026-04-27T12:00:00.000Z",
  });

  assert.deepEqual(report.factors, []);
  assert.deepEqual(report.cells, []);
  assert.equal(report.testedCellCount, 0);
});

test("Personal Patterns runtime reuses projected wearable summaries without exposing raw observations", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-personal-pattern-runtime-"));
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) => addDays(start, index * 14));
  const events = [
    ...runningDates.map((date, index) => ({
      activityType: "running",
      dayKey: date,
      id: `evt_runtime_run_${index}`,
      kind: "activity_session",
      occurredAt: `${date}T12:00:00.000Z`,
      schemaVersion: "murph.event.v1",
      source: "manual",
      title: "Running",
    })),
    ...Array.from({ length: 112 }, (_, index) => {
      const date = addDays(start, index);
      return {
        dayKey: date,
        externalRef: {
          resourceId: `runtime-hrv-${date}`,
          resourceType: "daily-summary",
          system: "whoop",
        },
        id: `evt_runtime_hrv_${index}`,
        kind: "observation",
        metric: "hrv",
        observationGrain: "summary",
        occurredAt: `${date}T07:00:00.000Z`,
        recordedAt: `${date}T07:05:00.000Z`,
        schemaVersion: "murph.event.v1",
        source: "device",
        title: "Daily HRV",
        unit: "ms",
        value: runningDates.includes(addDays(date, -1)) ? 70 : 50,
      };
    }),
  ];

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), `${JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Personal Patterns runtime fixture",
      vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4P",
    })}\n`, "utf8");
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-01.jsonl"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    await rebuildQueryProjection(vaultRoot);
    const report = await buildPersonalPatternReportRuntime(vaultRoot, {
      asOf: "2026-04-27",
    });

    assert.equal(report.factors[0]?.id, "running");
    assert.equal(report.cells.find((cell) => cell.outcomeId === "hrv")?.stage, "seen_again");
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

function event(
  id: string,
  date: string,
  kind: string,
  attributes: Record<string, unknown>,
): CanonicalEntity {
  return entity("event", id, {
    attributes,
    date,
    kind,
    occurredAt: `${date}T12:00:00.000Z`,
  });
}

function sample(
  id: string,
  date: string,
  stream: string,
  value: number,
  unit: string,
): CanonicalEntity {
  return entity("sample", id, {
    attributes: {
      externalRef: {
        resourceId: id,
        resourceType: "daily-summary",
        system: "whoop",
      },
      unit,
      value,
    },
    date,
    kind: "sample",
    occurredAt: `${date}T07:00:00.000Z`,
    recordClass: "sample",
    stream,
  });
}

function observation(
  id: string,
  date: string,
  metric: string,
  value: number,
  unit: string,
): CanonicalEntity {
  return event(id, date, "observation", {
    externalRef: {
      resourceId: id,
      resourceType: "daily-summary",
      system: "whoop",
    },
    metric,
    observationGrain: "summary",
    queryVisibility: "default",
    unit,
    value,
  });
}

function entity(
  family: CanonicalEntity["family"],
  id: string,
  overrides: Partial<CanonicalEntity>,
): CanonicalEntity {
  return {
    attributes: {},
    body: null,
    date: null,
    entityId: id,
    experimentSlug: null,
    family,
    frontmatter: null,
    kind: family,
    links: [],
    lookupIds: [id],
    occurredAt: null,
    path: `${family}/${id}.jsonl`,
    primaryLookupId: id,
    recordClass: family === "sample" ? "sample" : "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: null,
    ...overrides,
  };
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildHrvStageFixture(
  count: number,
  spanDays: number,
  exposedValue: (index: number) => number,
) {
  const start = "2026-01-05";
  const offsets = Array.from({ length: count }, (_, index) =>
    Math.round(index * spanDays / (count - 1))
  );
  const factorIndexByDate = new Map(
    offsets.map((offset, index) => [addDays(start, offset), index] as const),
  );
  const asOfOffset = spanDays + 14;
  const entities: CanonicalEntity[] = [
    ...offsets.map((offset, index) => {
      const date = addDays(start, offset);
      return event(`run_stage_${count}_${spanDays}_${index}`, date, "activity_session", {
        activityType: "running",
      });
    }),
    ...Array.from({ length: asOfOffset + 1 }, (_, offset) => {
      const date = addDays(start, offset);
      const factorIndex = factorIndexByDate.get(addDays(date, -1));
      return observation(
        `hrv_stage_${count}_${spanDays}_${offset}`,
        date,
        "hrv",
        factorIndex === undefined ? 50 : exposedValue(factorIndex),
        "ms",
      );
    }),
  ];

  return buildPersonalPatternReport(createVaultReadModel({
    entities,
    vaultRoot: `test://personal-pattern-stage-${count}-${spanDays}`,
  }), {
    asOf: addDays(start, asOfOffset),
    windowDays: Math.max(28, asOfOffset + 1),
  });
}
