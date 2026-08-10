import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import {
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
