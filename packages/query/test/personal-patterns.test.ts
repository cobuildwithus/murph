import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  JUNCTION_WEARABLE_TAG_EXTERNAL_REF_FACET,
  JUNCTION_WEARABLE_TAG_NOTE_TYPE,
} from "@murphai/contracts";
import { test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { readBrowserVaultPersonalPatternVocabulary } from "../src/browser-replica/source.ts";
import { DERIVED_KNOWLEDGE_PAGES_ROOT } from "../src/knowledge-graph.ts";
import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  createBrowserVaultReplica,
  parseBrowserVaultReplica,
} from "../src/browser.ts";
import {
  buildPersonalPatternReport,
  parsePersonalPatternVocabulary,
} from "../src/personal-patterns.ts";
import { createVaultReadModel } from "../src/read-model.ts";
import type { MetricPoint } from "../src/metrics/index.ts";
import {
  buildPersonalPatternReportRuntime,
  listMetricPointsRuntime,
  loadProjectedVaultSource,
  rebuildQueryProjection,
} from "../src/query-projection.ts";

test("Personal Patterns keeps a repeated next-day link and matched comparison evidence", async () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const entities: CanonicalEntity[] = [
    ...runningDates.map((date, index) =>
      event(`run_${index}`, date, "activity_session", {
        activityType: index % 2 === 0 ? "run" : "running",
        durationMinutes: [20, 45, 90][index % 3],
      }),
    ),
    ...Array.from({ length: 112 }, (_, index) => {
      const date = addDays(start, index);
      const priorDate = addDays(date, -1);
      return observation(
        `hrv_${index}`,
        date,
        "hrv",
        runningDates.includes(priorDate) ? 70 : 50,
        "ms",
      );
    }),
  ];
  const vault = createVaultReadModel({
    entities,
    vaultRoot: "test://personal-patterns",
  });
  const report = buildPersonalPatternReport(vault, {
    asOf: "2026-04-27T12:00:00.000Z",
  });

  assert.deepEqual(report.factors, [
    {
      id: "running",
      kind: "activity",
      label: "Running",
      observedDays: 8,
    },
  ]);
  assert.equal(
    report.factors.some((factor) => factor.id.includes("--duration-")),
    false,
  );
  const hrv = report.cells.find(
    (cell) => cell.factorId === "running" && cell.outcomeId === "hrv",
  );
  assert.ok(hrv);
  assert.equal(hrv.grade, "B");
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

test("Personal Patterns applies one validated vocabulary before aggregation", async () => {
  const vocabulary = parsePersonalPatternVocabulary(
    JSON.stringify({
      concepts: [
        {
          aliases: ["cardio-dance", "dancing"],
          icon: "dance",
          id: "dance",
          label: "Dance",
        },
      ],
      version: 1,
    }),
  );
  assert.ok(vocabulary);
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        event("dance_1", "2026-08-20", "activity_session", {
          activityType: "dancing",
        }),
        event("dance_2", "2026-08-21", "activity_session", {
          activityType: "cardio_dance",
        }),
      ],
      vaultRoot: "test://personal-pattern-vocabulary",
    }),
    { asOf: "2026-08-22", vocabulary },
  );

  assert.deepEqual(report.factors, [
    {
      icon: "dance",
      id: "dance",
      kind: "activity",
      label: "Dance",
      observedDays: 2,
    },
  ]);

  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-08-22T12:00:00.000Z",
    metricPoints: [],
    personalPatternVocabulary: vocabulary,
    sourceBundleHash: "v".repeat(64),
    vault: createVaultReadModel({
      entities: [
        event("dance_1", "2026-08-20", "activity_session", {
          activityType: "dancing",
        }),
        event("dance_2", "2026-08-21", "activity_session", {
          activityType: "cardio_dance",
        }),
      ],
      vaultRoot: "test://personal-pattern-vocabulary-replica",
    }),
  });
  assert.deepEqual(
    parseBrowserVaultReplica(replica).personalPatterns?.factors,
    report.factors,
  );
});

test("Personal Patterns rejects ambiguous or unbounded vocabulary", () => {
  assert.equal(
    parsePersonalPatternVocabulary(
      JSON.stringify({
        concepts: [
          {
            aliases: ["dancing"],
            icon: "dance",
            id: "dance",
            label: "Dance",
          },
          {
            aliases: ["dancing"],
            icon: "activity",
            id: "performance",
            label: "Performance",
          },
        ],
        version: 1,
      }),
    ),
    null,
  );
  assert.equal(parsePersonalPatternVocabulary("not json"), null);
});

test("Browser Vault reads the bounded vocabulary from its private Knowledge page", async () => {
  const testTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  assert.ok(testTempRoot);
  const vaultRoot = await mkdtemp(
    path.join(testTempRoot, "personal-pattern-vocabulary-"),
  );
  try {
    const pagesRoot = path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT);
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), {
      recursive: true,
    });
    await mkdir(pagesRoot, { recursive: true });
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        createdAt: "2026-01-01T00:00:00.000Z",
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC",
        title: "Personal Pattern vocabulary fixture",
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4V",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-08.jsonl"),
      `${[
        {
          activityType: "dancing",
          dayKey: "2026-08-20",
          id: "evt_vocabulary_dance_1",
          kind: "activity_session",
          occurredAt: "2026-08-20T12:00:00.000Z",
          schemaVersion: "murph.event.v1",
          source: "device",
          title: "Dancing",
        },
        {
          activityType: "cardio_dance",
          dayKey: "2026-08-21",
          id: "evt_vocabulary_dance_2",
          kind: "activity_session",
          occurredAt: "2026-08-21T12:00:00.000Z",
          schemaVersion: "murph.event.v1",
          source: "device",
          title: "Cardio dance",
        },
      ].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
    await writeFile(
      path.join(pagesRoot, "journal-pattern-vocabulary.md"),
      [
        "---",
        "title: Journal and Pattern vocabulary",
        "slug: journal-pattern-vocabulary",
        "pageType: ledger",
        "status: active",
        "---",
        "",
        "# Journal and Pattern vocabulary",
        "",
        JSON.stringify({
          concepts: [
            {
              aliases: ["cardio-dance", "dancing"],
              icon: "dance",
              id: "dance",
              label: "Dance",
            },
          ],
          version: 1,
        }),
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(
      await readBrowserVaultPersonalPatternVocabulary(vaultRoot),
      {
        concepts: [
          {
            aliases: ["cardio-dance", "dancing"],
            icon: "dance",
            id: "dance",
            label: "Dance",
          },
        ],
        version: 1,
      },
    );
    await rebuildQueryProjection(vaultRoot);
    assert.deepEqual(
      (await buildPersonalPatternReportRuntime(vaultRoot, {
        asOf: "2026-08-22",
      })).factors,
      [
        {
          icon: "dance",
          id: "dance",
          kind: "activity",
          label: "Dance",
          observedDays: 2,
        },
      ],
    );
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});

test("Personal Patterns keeps a repeated eight-minute deep-sleep change", async () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const vault = createVaultReadModel({
    entities: runningDates.map((date, index) =>
      event(`deep_sleep_run_${index}`, date, "activity_session", {
        activityType: "running",
        durationMinutes: 45,
      }),
    ),
    vaultRoot: "test://personal-pattern-deep-sleep-threshold",
  });
  const metricPoints = Array.from({ length: 112 }, (_, index) => {
    const date = addDays(start, index);
    return metricPoint(
      `deep_sleep_${index}`,
      date,
      "deep-sleep-minutes",
      runningDates.includes(addDays(date, -1)) ? 68 : 60,
      "min",
    );
  });
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-27T12:00:00.000Z",
    metricPoints,
    sourceBundleHash: "d".repeat(64),
    vault,
  });
  const report = parseBrowserVaultReplica(replica).personalPatterns;

  const deepSleep = report?.cells.find(
    (cell) => cell.factorId === "running" && cell.outcomeId === "deep-sleep",
  );
  assert.ok(deepSleep);
  assert.equal(deepSleep.delta, 8);
  assert.equal(deepSleep.direction, "higher");
  assert.equal(deepSleep.stage, "seen_again");
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

test("Personal Patterns reuses the canonical provider activity-kind resolver", () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        ...runningDates.map((date, index) =>
          event(`provider_run_${index}`, date, "activity_session", {
            workout: { sportName: "Run" },
          }),
        ),
        ...Array.from({ length: 112 }, (_, index) => {
          const date = addDays(start, index);
          return observation(
            `provider_hrv_${index}`,
            date,
            "hrv",
            runningDates.includes(addDays(date, -1)) ? 70 : 50,
            "ms",
          );
        }),
      ],
      vaultRoot: "test://personal-pattern-provider-activity",
    }),
    {
      asOf: "2026-04-27T12:00:00.000Z",
    },
  );

  assert.equal(report.factors[0]?.id, "running");
  assert.equal(
    report.cells.find(
      (cell) => cell.factorId === "running" && cell.outcomeId === "hrv",
    )?.stage,
    "seen_again",
  );
});

test("Personal Patterns admits only the product-owned Oura sauna tag from neutral notes", () => {
  const start = "2026-01-05";
  const ouraDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const garminDates = ouraDates.map((date) => addDays(date, 7));
  const legacyDates = ouraDates.map((date) => addDays(date, 3));
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        ...ouraDates.map((date, index) =>
          junctionWearableTagNote(`oura_tags_${index}`, date, "oura", [
            "sauna",
            "headache",
            "late-meal",
            "recovery",
            "custom-tag",
          ]),
        ),
        ...garminDates.map((date, index) =>
          junctionWearableTagNote(`garmin_tags_${index}`, date, "garmin", [
            "sauna",
          ]),
        ),
        ...legacyDates.map((date, index) =>
          legacyJunctionNoteTagIntervention(
            `legacy_oura_tag_${index}`,
            date,
            "sauna",
          ),
        ),
        ...Array.from({ length: 112 }, (_, index) => {
          const date = addDays(start, index);
          return observation(
            `oura_tag_hrv_${index}`,
            date,
            "hrv",
            ouraDates.includes(addDays(date, -1)) ? 70 : 50,
            "ms",
          );
        }),
      ],
      vaultRoot: "test://personal-pattern-oura-tags",
    }),
    {
      asOf: "2026-04-27T12:00:00.000Z",
    },
  );

  assert.deepEqual(report.factors, [
    {
      id: "sauna",
      kind: "intervention",
      label: "Sauna",
      observedDays: 8,
    },
  ]);
  assert.equal(
    report.cells.find(
      (cell) => cell.factorId === "sauna" && cell.outcomeId === "hrv",
    )?.stage,
    "seen_again",
  );
  assert.equal(
    report.factors.some((factor) => factor.id === "headache"),
    false,
  );
  assert.equal(
    report.factors.some((factor) => factor.id === "late-meal"),
    false,
  );
  assert.equal(
    report.factors.some((factor) => factor.id === "recovery"),
    false,
  );
  assert.equal(
    report.factors.some((factor) => factor.id === "custom-tag"),
    false,
  );
});

test("Browser Vault Personal Patterns falls back to its selected metric rows", async () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const vault = createVaultReadModel({
    entities: runningDates.map((date, index) =>
      event(`metric_run_${index}`, date, "activity_session", {
        activityType: "running",
      }),
    ),
    vaultRoot: "test://personal-pattern-metric-rows",
  });
  const metricPoints = Array.from({ length: 112 }, (_, index) => {
    const date = addDays(start, index);
    return metricPoint(
      `metric_hrv_${index}`,
      date,
      "hrv-rmssd",
      runningDates.includes(addDays(date, -1)) ? 70 : 50,
      "ms",
    );
  });
  const duplicate = {
    ...metricPoints[1]!,
    confidence: "low" as const,
    id: "metric_hrv_duplicate",
    value: 999,
  };

  assert.deepEqual(
    buildPersonalPatternReport(vault, {
      asOf: "2026-04-27T12:00:00.000Z",
    }).factors.map((factor) => factor.id),
    ["running"],
  );

  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-27T12:00:00.000Z",
    metricPoints: [duplicate, ...metricPoints],
    sourceBundleHash: "m".repeat(64),
    vault,
  });
  const report = parseBrowserVaultReplica(replica).personalPatterns;

  assert.equal(report?.factors[0]?.id, "running");
  assert.equal(
    report?.cells.find((cell) => cell.outcomeId === "hrv")?.stage,
    "seen_again",
  );
  assert.equal(report?.testedCellCount, 1);
  assert.equal(
    report?.cells.find((cell) => cell.outcomeId === "hrv")?.exposedMean,
    70,
  );

  const reversedReplica = await createBrowserVaultReplica({
    generatedAt: "2026-04-27T12:00:00.000Z",
    metricPoints: [...metricPoints, duplicate],
    sourceBundleHash: "n".repeat(64),
    vault,
  });
  assert.deepEqual(
    parseBrowserVaultReplica(reversedReplica).personalPatterns,
    report,
  );
});

test("Browser Vault Personal Patterns includes sleep outcomes from metric rows", async () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const vault = createVaultReadModel({
    entities: runningDates.map((date, index) =>
      event(`sleep_metric_run_${index}`, date, "activity_session", {
        activityType: "running",
      }),
    ),
    vaultRoot: "test://personal-pattern-sleep-metric-rows",
  });
  const metricPoints = Array.from({ length: 112 }, (_, index) => {
    const date = addDays(start, index);
    const followsRunning = runningDates.includes(addDays(date, -1));
    return [
      metricPoint(
        `metric_total_sleep_${index}`,
        date,
        "total-sleep-minutes",
        followsRunning ? 420 : 480,
        "min",
      ),
      metricPoint(
        `metric_sleep_score_${index}`,
        date,
        "sleep-score",
        followsRunning ? 70 : 80,
        "score",
      ),
      metricPoint(
        `metric_sleep_efficiency_${index}`,
        date,
        "sleep-efficiency",
        followsRunning ? 84 : 90,
        "%",
      ),
    ];
  }).flat();

  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-27T12:00:00.000Z",
    metricPoints,
    sourceBundleHash: "s".repeat(64),
    vault,
  });
  const report = parseBrowserVaultReplica(replica).personalPatterns;

  assert.deepEqual(report?.outcomes.map((outcome) => outcome.id), [
    "total-sleep",
    "sleep-score",
    "sleep-efficiency",
  ]);
  assert.equal(
    report?.cells.find((cell) => cell.outcomeId === "sleep-score")?.stage,
    "seen_again",
  );
  assert.equal(
    report?.cells.find((cell) => cell.outcomeId === "total-sleep")?.exposedMean,
    420,
  );
});

test("Personal Patterns does not duplicate the canonical readiness metric as recovery", async () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const vault = createVaultReadModel({
    entities: runningDates.map((date, index) =>
      event(`readiness_run_${index}`, date, "activity_session", {
        activityType: "running",
      }),
    ),
    vaultRoot: "test://personal-pattern-readiness-alias",
  });
  const metricPoints = Array.from({ length: 112 }, (_, index) => {
    const date = addDays(start, index);
    return metricPoint(
      `metric_readiness_${index}`,
      date,
      "readiness-score",
      runningDates.includes(addDays(date, -1)) ? 90 : 70,
      "score",
    );
  });

  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-04-27T12:00:00.000Z",
    metricPoints,
    sourceBundleHash: "q".repeat(64),
    vault,
  });
  const report = parseBrowserVaultReplica(replica).personalPatterns;

  assert.deepEqual(report?.outcomes.map((outcome) => outcome.id), [
    "readiness-score",
  ]);
  assert.deepEqual(report?.cells.map((cell) => cell.outcomeId), [
    "readiness-score",
  ]);
  assert.equal(report?.cells[0]?.stage, "seen_again");
});

test("Personal Patterns keeps qualified factors for the expandable report", () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const dailyFactors = Array.from(
    { length: 17 },
    (_, index) => `daily-factor-${String(index + 1).padStart(2, "0")}`,
  );
  const entities: CanonicalEntity[] = [
    ...Array.from({ length: 112 }, (_, dayIndex) =>
      dailyFactors.map((activityType, factorIndex) =>
        event(
          `daily_${factorIndex}_${dayIndex}`,
          addDays(start, dayIndex),
          "activity_session",
          { activityType },
        ),
      ),
    ).flat(),
    ...runningDates.map((date, index) =>
      event(`run_cap_${index}`, date, "activity_session", {
        activityType: "running",
      }),
    ),
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
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities,
      vaultRoot: "test://personal-pattern-cap",
    }),
    {
      asOf: "2026-04-27T12:00:00.000Z",
    },
  );

  assert.equal(report.factors.length, 18);
  assert.equal(report.factors[0]?.id, "running");
  assert.deepEqual(
    report.factors.slice(1).map((factor) => factor.id),
    dailyFactors,
  );
  assert.equal(
    report.cells.find(
      (cell) => cell.factorId === "running" && cell.outcomeId === "hrv",
    )?.stage,
    "seen_again",
  );
});

test("Personal Patterns uses the nearest unused same-weekday comparisons", () => {
  const start = "2026-01-05";
  const runningDates = [0, 14, 28, 42, 56].map((offset) =>
    addDays(start, offset),
  );
  const comparisonDates = [7, 21, 35, 49, 63].map((offset) =>
    addDays(start, offset),
  );
  const comparisonValues = [10, 50, 50, 50, 50];
  const wrongWeekdayDates = [1, 15, 29, 43, 57].map((offset) =>
    addDays(start, offset),
  );
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        ...runningDates.map((date, index) =>
          event(`run_match_${index}`, date, "activity_session", {
            activityType: "running",
          }),
        ),
        ...runningDates.map((date, index) =>
          observation(
            `hrv_exposed_${index}`,
            addDays(date, 1),
            "hrv",
            70,
            "ms",
          ),
        ),
        ...comparisonDates.map((date, index) =>
          observation(
            `hrv_control_${index}`,
            addDays(date, 1),
            "hrv",
            comparisonValues[index] ?? 50,
            "ms",
          ),
        ),
        ...wrongWeekdayDates.map((date, index) =>
          observation(
            `hrv_wrong_weekday_${index}`,
            addDays(date, 1),
            "hrv",
            95,
            "ms",
          ),
        ),
      ],
      vaultRoot: "test://personal-pattern-matching",
    }),
    {
      asOf: addDays(start, 70),
    },
  );
  const hrv = report.cells.find((cell) => cell.outcomeId === "hrv");

  assert.ok(hrv);
  assert.equal(hrv.comparisonDays, 5);
  assert.equal(hrv.comparisonMean, 42);
  assert.equal(hrv.exposedMean, 70);
});

test("Personal Patterns rejects controls on the wrong weekday or beyond 35 days", () => {
  const start = "2026-03-02";
  const runningDates = [0, 7, 14, 21, 28].map((offset) =>
    addDays(start, offset),
  );
  const remoteDates = [-70, -63, -56, -49, -42].map((offset) =>
    addDays(start, offset),
  );
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        ...runningDates.map((date, index) =>
          event(`run_guard_${index}`, date, "activity_session", {
            activityType: "running",
          }),
        ),
        ...runningDates.map((date, index) =>
          observation(
            `hrv_guard_exposed_${index}`,
            addDays(date, 1),
            "hrv",
            70,
            "ms",
          ),
        ),
        ...runningDates.map((date, index) =>
          observation(
            `hrv_guard_wrong_${index}`,
            addDays(date, 2),
            "hrv",
            40,
            "ms",
          ),
        ),
        ...remoteDates.map((date, index) =>
          observation(
            `hrv_guard_remote_${index}`,
            addDays(date, 1),
            "hrv",
            50,
            "ms",
          ),
        ),
      ],
      vaultRoot: "test://personal-pattern-control-guards",
    }),
    {
      asOf: addDays(start, 35),
      windowDays: 120,
    },
  );

  assert.deepEqual(
    report.factors.map((factor) => factor.id),
    ["running"],
  );
  assert.deepEqual(
    report.outcomes.map((outcome) => outcome.id),
    ["hrv"],
  );
  assert.equal(report.cells.length, 1);
  assert.equal(report.cells[0]?.stage, "insufficient");
});

test("Personal Patterns keeps the evidence-stage boundaries and repeated-direction guard", () => {
  const cases = [
    {
      count: 5,
      expected: "seen_again",
      exposed: () => 70,
      name: "five over 21 days",
      span: 21,
    },
    {
      count: 5,
      expected: "new_clue",
      exposed: () => 70,
      name: "five under 21 days",
      span: 20,
    },
    {
      count: 8,
      expected: "seen_again",
      exposed: () => 70,
      name: "eight over 42 days",
      span: 42,
    },
    {
      count: 8,
      expected: "seen_again",
      exposed: () => 70,
      name: "eight under 42 days",
      span: 41,
    },
    {
      count: 12,
      expected: "worth_testing",
      exposed: () => 53.75,
      name: "twelve over 56 days at 1.5x",
      span: 56,
    },
    {
      count: 12,
      expected: "seen_again",
      exposed: () => 53.74,
      name: "twelve over 56 days under 1.5x",
      span: 56,
    },
    {
      count: 12,
      expected: "seen_again",
      exposed: () => 53.75,
      name: "twelve under 56 days",
      span: 55,
    },
    {
      count: 8,
      expected: "no_clear_pattern",
      exposed: (index: number) => (index < 4 ? 80 : 45),
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

test("Personal Patterns labels one result as an Observation and repeated results as an Early signal", () => {
  const one = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        event("single_run", "2026-01-05", "activity_session", {
          activityType: "running",
        }),
        observation("single_exposed", "2026-01-06", "hrv", 70, "ms"),
        observation("single_control", "2026-01-13", "hrv", 50, "ms"),
      ],
      vaultRoot: "test://personal-pattern-observation",
    }),
    { asOf: "2026-01-20", windowDays: 28 },
  );
  const observationCell = one.cells.find((cell) => cell.factorId === "running");
  assert.equal(observationCell?.grade, "E");
  assert.equal(observationCell?.classification, "observation");

  const repeated = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        journalFactor("coffee_1", "2026-01-05", "coffee", "happened"),
        journalFactor("coffee_2", "2026-01-19", "coffee", "happened"),
        journalFactor(
          "coffee_absent_1",
          "2026-01-12",
          "coffee",
          "did-not-happen",
        ),
        journalFactor(
          "coffee_absent_2",
          "2026-01-26",
          "coffee",
          "did-not-happen",
        ),
        observation(
          "coffee_exposed_1",
          "2026-01-06",
          "sleep-score",
          55,
          "score",
        ),
        observation(
          "coffee_exposed_2",
          "2026-01-20",
          "sleep-score",
          54,
          "score",
        ),
        observation(
          "coffee_control_1",
          "2026-01-13",
          "sleep-score",
          80,
          "score",
        ),
        observation(
          "coffee_control_2",
          "2026-01-27",
          "sleep-score",
          82,
          "score",
        ),
      ],
      vaultRoot: "test://personal-pattern-early-signal",
    }),
    { asOf: "2026-02-01", windowDays: 35 },
  );
  const earlyCell = repeated.cells.find((cell) => cell.factorId === "coffee");
  assert.equal(earlyCell?.grade, "D");
  assert.equal(earlyCell?.classification, "early_signal");
  assert.equal(earlyCell?.comparisonBasis, "confirmed_absence");
  assert.equal(repeated.factors[0]?.confirmedAbsentDays, 2);
});

test("Personal Patterns caps manual activities that use an unobserved baseline", () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        ...runningDates.map((date, index) =>
          event(`manual_run_${index}`, date, "activity_session", {
            activityType: "running",
            source: "manual",
          }),
        ),
        ...Array.from({ length: 112 }, (_, index) => {
          const date = addDays(start, index);
          return observation(
            `manual_run_hrv_${index}`,
            date,
            "hrv",
            runningDates.includes(addDays(date, -1)) ? 75 : 50,
            "ms",
          );
        }),
      ],
      vaultRoot: "test://manual-activity-pattern",
    }),
    { asOf: "2026-04-27", windowDays: 120 },
  );

  const cell = report.cells.find(
    (candidate) => candidate.factorId === "running",
  );
  assert.equal(cell?.comparisonBasis, "unobserved_baseline");
  assert.equal(cell?.grade, "D");
});

test("Personal Patterns caps mixed device and manual observations that use an unobserved baseline", () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        ...runningDates.map((date, index) =>
          event(`mixed_run_${index}`, date, "activity_session", {
            activityType: "running",
            source: index === runningDates.length - 1 ? "manual" : "device",
          }),
        ),
        ...Array.from({ length: 112 }, (_, index) => {
          const date = addDays(start, index);
          return observation(
            `mixed_run_hrv_${index}`,
            date,
            "hrv",
            runningDates.includes(addDays(date, -1)) ? 75 : 50,
            "ms",
          );
        }),
      ],
      vaultRoot: "test://mixed-activity-pattern",
    }),
    { asOf: "2026-04-27", windowDays: 120 },
  );

  const cell = report.cells.find(
    (candidate) => candidate.factorId === "running",
  );
  assert.equal(cell?.comparisonBasis, "unobserved_baseline");
  assert.equal(cell?.grade, "D");
});

test("Personal Patterns counts a multi-day context as one episode", () => {
  const tripDates = [
    "2026-01-05",
    "2026-01-06",
    "2026-01-07",
    "2026-01-08",
    "2026-01-09",
  ];
  const entities = tripDates.flatMap((date, index) => [
    journalFactor(`trip_${index}`, date, "travel", "happened", [
      "episode-winter-trip",
    ]),
    observation(`trip_hrv_${index}`, addDays(date, 1), "hrv", 40, "ms"),
    journalFactor(
      `home_${index}`,
      addDays(date, 14),
      "travel",
      "did-not-happen",
    ),
    observation(`home_hrv_${index}`, addDays(date, 15), "hrv", 60, "ms"),
  ]);
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities,
      vaultRoot: "test://personal-pattern-episode",
    }),
    { asOf: "2026-02-15", windowDays: 60 },
  );

  assert.equal(
    report.factors.find((factor) => factor.id === "travel")?.episodeCount,
    1,
  );
  const hrv = report.cells.find(
    (cell) => cell.factorId === "travel" && cell.outcomeId === "hrv",
  );
  assert.equal(hrv?.exposedDays, 1);
  assert.equal(hrv?.comparisonDays, 1);
  assert.equal(hrv?.grade, "E");
});

test("Personal Patterns keeps explicit absence for a bounded factor detail", () => {
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        journalFactor("coffee_late_1", "2026-01-05", "coffee", "happened", [
          "timing-late",
          "amount-high",
        ]),
        journalFactor("coffee_late_2", "2026-01-19", "coffee", "happened", [
          "timing-late",
          "amount-high",
        ]),
        journalFactor("coffee_late_3", "2026-01-08", "coffee", "happened", [
          "timing-late",
        ]),
        journalFactor(
          "coffee_early_1",
          "2026-01-12",
          "coffee",
          "did-not-happen",
          ["timing-late", "amount-high"],
        ),
        journalFactor(
          "coffee_early_2",
          "2026-01-26",
          "coffee",
          "did-not-happen",
          ["timing-late", "amount-high"],
        ),
        observation("late_sleep_1", "2026-01-06", "sleep-score", 55, "score"),
        observation("late_sleep_2", "2026-01-20", "sleep-score", 54, "score"),
        observation("early_sleep_1", "2026-01-13", "sleep-score", 80, "score"),
        observation("early_sleep_2", "2026-01-27", "sleep-score", 82, "score"),
      ],
      vaultRoot: "test://personal-pattern-factor-detail-absence",
    }),
    { asOf: "2026-02-01", windowDays: 35 },
  );

  const detailedCell = report.cells.find(
    (cell) => cell.factorId === "coffee--amount-high",
  );
  assert.equal(detailedCell?.grade, "D");
  assert.equal(detailedCell?.comparisonBasis, "confirmed_absence");
  assert.equal(
    report.cells.some((cell) => cell.factorId === "coffee--timing-late"),
    false,
  );
});

test("Personal Patterns removes detail rows that repeat the base exposure", () => {
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        journalFactor("coffee_1", "2026-01-05", "late-caffeine", "happened", [
          "timing-afternoon",
        ]),
        journalFactor("coffee_2", "2026-01-19", "late-caffeine", "happened", [
          "timing-afternoon",
        ]),
        observation("sleep_1", "2026-01-06", "sleep-score", 60, "score"),
        observation("sleep_2", "2026-01-20", "sleep-score", 62, "score"),
      ],
      vaultRoot: "test://personal-pattern-redundant-detail",
    }),
    { asOf: "2026-02-01", windowDays: 35 },
  );

  assert.deepEqual(
    report.factors.map((factor) => factor.id),
    ["late-caffeine"],
  );
});

test("Personal Patterns uses same-day subjective outcomes", () => {
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities: [
        journalFactor("tennis_1", "2026-01-05", "tennis", "happened"),
        journalOutcome("soreness_1", "2026-01-05", "soreness", "high"),
        journalFactor("rest_1", "2026-01-12", "tennis", "did-not-happen"),
        journalOutcome("baseline_1", "2026-01-12", "soreness", "low"),
        journalFactor("tennis_2", "2026-01-19", "tennis", "happened"),
        journalOutcome("soreness_2", "2026-01-19", "soreness", "high"),
        journalFactor("rest_2", "2026-01-26", "tennis", "did-not-happen"),
        journalOutcome("baseline_2", "2026-01-26", "soreness", "low"),
      ],
      vaultRoot: "test://personal-pattern-same-day-outcome",
    }),
    { asOf: "2026-02-01", windowDays: 35 },
  );

  const outcome = report.outcomes.find(
    (entry) => entry.id === "subjective-soreness",
  );
  const cell = report.cells.find(
    (entry) =>
      entry.factorId === "tennis" && entry.outcomeId === "subjective-soreness",
  );
  assert.equal(outcome?.lagDays, 0);
  assert.equal(cell?.grade, "D");
  assert.equal(cell?.direction, "higher");
});

test("Personal Patterns keeps common synthetic health links as regression baselines", () => {
  const scenarios = [
    {
      baseline: 440,
      exposed: 380,
      factor: "late-caffeine",
      outcome: "total-sleep",
      unit: "min",
    },
    {
      baseline: 82,
      exposed: 64,
      factor: "alcohol",
      outcome: "sleep-score",
      unit: "score",
    },
    {
      baseline: 54,
      exposed: 60,
      factor: "late-meal",
      outcome: "resting-heart-rate",
      unit: "bpm",
    },
    {
      baseline: 74,
      exposed: 84,
      factor: "exercise",
      outcome: "readiness-score",
      unit: "score",
    },
    { baseline: 52, exposed: 40, factor: "travel", outcome: "hrv", unit: "ms" },
    { baseline: 44, exposed: 56, factor: "sauna", outcome: "hrv", unit: "ms" },
  ] as const;

  for (const scenario of scenarios) {
    const start = "2026-01-05";
    const entities = Array.from({ length: 5 }, (_, index) => {
      const exposedDate = addDays(start, index * 14);
      const baselineDate = addDays(exposedDate, 7);
      return [
        journalFactor(
          `${scenario.factor}_yes_${index}`,
          exposedDate,
          scenario.factor,
          "happened",
        ),
        observation(
          `${scenario.factor}_exposed_${index}`,
          addDays(exposedDate, 1),
          scenario.outcome,
          scenario.exposed,
          scenario.unit,
        ),
        journalFactor(
          `${scenario.factor}_no_${index}`,
          baselineDate,
          scenario.factor,
          "did-not-happen",
        ),
        observation(
          `${scenario.factor}_baseline_${index}`,
          addDays(baselineDate, 1),
          scenario.outcome,
          scenario.baseline,
          scenario.unit,
        ),
      ];
    }).flat();
    const report = buildPersonalPatternReport(
      createVaultReadModel({
        entities,
        vaultRoot: `test://personal-pattern-regression-${scenario.factor}`,
      }),
      { asOf: "2026-03-15", windowDays: 84 },
    );
    const cell = report.cells.find(
      (entry) =>
        entry.factorId === scenario.factor &&
        entry.outcomeId === scenario.outcome,
    );

    assert.equal(cell?.grade, "C", scenario.factor);
    assert.equal(
      cell?.direction,
      scenario.exposed > scenario.baseline ? "higher" : "lower",
      scenario.factor,
    );
  }
});

test("Personal Patterns anchors sleep outcomes to the localized sleep-end date in direct and runtime reads", async () => {
  const vaultRoot = await mkdtemp(
    path.join(os.tmpdir(), "murph-personal-pattern-sleep-date-"),
  );
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const canonicalEntities: CanonicalEntity[] = runningDates.map((date, index) =>
    event(`run_sleep_${index}`, date, "activity_session", {
      activityType: "running",
    }),
  );
  const ledgerEvents: Array<Record<string, unknown>> = runningDates.map(
    (date, index) => ({
      activityType: "running",
      dayKey: date,
      id: `evt_sleep_date_run_${index}`,
      kind: "activity_session",
      occurredAt: `${date}T12:00:00.000Z`,
      schemaVersion: "murph.event.v1",
      source: "device",
      title: "Running",
    }),
  );

  for (let index = 0; index < 112; index += 1) {
    const localEndDate = addDays(start, index);
    const storedDate = addDays(localEndDate, -1);
    const sleepScore = runningDates.includes(addDays(localEndDate, -1))
      ? 90
      : 70;
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
      event(
        `sleep_date_${index}`,
        storedDate,
        "sleep_session",
        sleepAttributes,
      ),
      observation(
        `sleep_score_date_${index}`,
        storedDate,
        "sleep-score",
        sleepScore,
        "score",
      ),
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

  const direct = buildPersonalPatternReport(
    createVaultReadModel({
      entities: canonicalEntities,
      metadata: { timezone: "UTC" },
      vaultRoot: "test://personal-pattern-sleep-date",
    }),
    {
      asOf: "2026-04-27T12:00:00.000Z",
    },
  );
  const directCell = direct.cells.find(
    (cell) => cell.outcomeId === "sleep-score",
  );
  assert.ok(directCell);
  assert.equal(directCell.exposedMean, 90);
  assert.equal(directCell.comparisonMean, 70);
  assert.equal(directCell.stage, "seen_again");

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        createdAt: "2026-01-01T00:00:00.000Z",
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC",
        title: "Personal Patterns localized sleep fixture",
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4S",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-01.jsonl"),
      `${ledgerEvents.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
    await rebuildQueryProjection(vaultRoot);

    const runtime = await buildPersonalPatternReportRuntime(vaultRoot, {
      asOf: "2026-04-27",
    });
    const runtimeCell = runtime.cells.find(
      (cell) => cell.outcomeId === "sleep-score",
    );
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
  const sessionDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
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
      ),
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
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities,
      vaultRoot: "test://personal-pattern-intervention-local-date",
    }),
    {
      asOf: "2026-04-27T12:00:00.000Z",
    },
  );
  const hrv = report.cells.find(
    (cell) => cell.factorId === "dry-sauna" && cell.outcomeId === "hrv",
  );

  assert.ok(hrv);
  assert.equal(hrv.exposedMean, 70);
  assert.equal(hrv.comparisonMean, 50);
  assert.equal(hrv.stage, "new_clue");
  assert.equal(hrv.grade, "D");
});

test("Personal Patterns excludes explicit nap-only days from sleep outcomes", () => {
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const entities: CanonicalEntity[] = [
    ...runningDates.map((date, index) =>
      event(`run_nap_${index}`, date, "activity_session", {
        activityType: "running",
      }),
    ),
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

  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities,
      vaultRoot: "test://personal-pattern-nap-only",
    }),
    {
      asOf: "2026-04-27T12:00:00.000Z",
    },
  );

  assert.equal(
    report.outcomes.some((outcome) => outcome.id === "sleep-score"),
    false,
  );
  assert.equal(
    report.cells.some((cell) => cell.outcomeId === "sleep-score"),
    false,
  );
});

test("Personal Patterns reports a tested but unclear link without calling it a finding", () => {
  const start = "2026-01-05";
  const saunaDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const entities: CanonicalEntity[] = [
    ...saunaDates.map((date, index) =>
      event(`sauna_${index}`, date, "intervention_session", {
        interventionType: "dry-sauna",
        sessionStatus: "completed",
      }),
    ),
    event("missed_sauna", addDays(start, 3), "intervention_session", {
      interventionType: "dry-sauna",
      sessionStatus: "missed",
    }),
    ...Array.from({ length: 112 }, (_, index) =>
      observation(
        `sleep_${index}`,
        addDays(start, index),
        "sleep-score",
        80,
        "score",
      ),
    ),
  ];
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities,
      vaultRoot: "test://personal-patterns",
    }),
    {
      asOf: "2026-04-27T12:00:00.000Z",
    },
  );

  assert.equal(report.factors[0]?.observedDays, 8);
  const cell = report.cells.find(
    (candidate) => candidate.outcomeId === "sleep-score",
  );
  assert.ok(cell);
  assert.equal(cell.stage, "no_clear_pattern");
  assert.equal(cell.direction, "flat");
  assert.equal(report.repeatableCellCount, 0);
  assert.equal(report.testedCellCount, 1);
});

test("Personal Patterns keeps recognized factors when matched history is insufficient", () => {
  const start = "2026-03-02";
  const entities: CanonicalEntity[] = [
    ...Array.from({ length: 35 }, (_, index) =>
      event(`yard_${index}`, addDays(start, index), "activity_session", {
        activityType: "yardwork",
      }),
    ),
    ...Array.from({ length: 34 }, (_, index) =>
      observation(
        `recovery_${index}`,
        addDays(start, index + 1),
        "hrv",
        70 + (index % 2),
        "ms",
      ),
    ),
  ];
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities,
      vaultRoot: "test://personal-patterns",
    }),
    {
      asOf: "2026-04-05T12:00:00.000Z",
    },
  );

  assert.deepEqual(
    report.factors.map((factor) => [factor.id, factor.label]),
    [["yardwork", "Yard work"]],
  );
  assert.deepEqual(
    report.outcomes.map((outcome) => outcome.id),
    ["hrv"],
  );
  assert.equal(report.cells.length, 1);
  assert.equal(report.cells[0]?.stage, "insufficient");
  assert.equal(report.testedCellCount, 0);
});

test("Personal Patterns uses vocabulary instead of a factor-specific label rule", () => {
  const start = "2026-03-02";
  const entities: CanonicalEntity[] = [
    ...Array.from({ length: 5 }, (_, index) => ({
      ...event(`glasses_${index}`, addDays(start, index), "note", {}),
      tags: [
        "key-high-filtering-amber-red-or-orange-evening-glasses-with-spectral-data-when-available",
      ],
      attributes: { noteType: "journal-factor" },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      ...event(`generic_glasses_${index}`, addDays(start, index + 1), "note", {}),
      tags: ["key-blue-light-blocking-glasses"],
      attributes: { noteType: "journal-factor" },
    })),
    ...Array.from({ length: 6 }, (_, index) =>
      observation(
        `sleep_${index}`,
        addDays(start, index + 1),
        "sleep-score",
        80,
        "score",
      ),
    ),
  ];
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities,
      vaultRoot: "test://personal-pattern-light-filtering-glasses",
    }),
    {
      asOf: "2026-03-08T12:00:00.000Z",
      vocabulary: parsePersonalPatternVocabulary(
        JSON.stringify({
          concepts: [
            {
              aliases: [
                "blue-light-blocking-glasses",
                "high-filtering-amber-red-or-orange-evening-glasses-with-spectral-data-when-available",
              ],
              icon: "red-light",
              id: "red-light-glasses",
              label: "Red light glasses",
            },
          ],
          version: 1,
        }),
      ),
    },
  );

  assert.deepEqual(
    report.factors.map((factor) => [factor.id, factor.label]),
    [["red-light-glasses", "Red light glasses"]],
  );
});

test("Personal Patterns suppresses outcome-like activity and intervention factors", () => {
  const start = "2026-01-05";
  const factorDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
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
  const report = buildPersonalPatternReport(
    createVaultReadModel({
      entities,
      vaultRoot: "test://personal-patterns",
    }),
    {
      asOf: "2026-04-27T12:00:00.000Z",
    },
  );

  assert.deepEqual(report.factors, []);
  assert.deepEqual(report.cells, []);
  assert.equal(report.testedCellCount, 0);
});

test("Personal Patterns runtime and Browser Vault reuse the same projected metric samples", async () => {
  const vaultRoot = await mkdtemp(
    path.join(os.tmpdir(), "murph-personal-pattern-runtime-"),
  );
  const start = "2026-01-05";
  const runningDates = Array.from({ length: 8 }, (_, index) =>
    addDays(start, index * 14),
  );
  const events = runningDates.map((date, index) => ({
    activityType: "running",
    dayKey: date,
    id: `evt_runtime_run_${index}`,
    kind: "activity_session",
    occurredAt: `${date}T12:00:00.000Z`,
    schemaVersion: "murph.event.v1",
    source: "device",
    title: "Running",
  }));
  const metricSamples = Array.from({ length: 112 }, (_, index) => {
    const date = addDays(start, index);
    return {
      dayKey: date,
      id: `smp_runtime_hrv_${index}`,
      metric: "hrv-rmssd",
      quality: "derived",
      recordedAt: `${date}T07:00:00.000Z`,
      schemaVersion: "murph.metric-sample.v1",
      source: "device",
      unit: "ms",
      value: runningDates.includes(addDays(date, -1)) ? 70 : 50,
    };
  });

  try {
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), {
      recursive: true,
    });
    await mkdir(path.join(vaultRoot, "ledger/metric-samples/hrv-rmssd/2026"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, "vault.json"),
      `${JSON.stringify({
        createdAt: "2026-01-01T00:00:00.000Z",
        formatVersion: CURRENT_VAULT_FORMAT_VERSION,
        timezone: "UTC",
        title: "Personal Patterns runtime fixture",
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4P",
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-01.jsonl"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
    for (const month of ["01", "02", "03", "04"]) {
      const monthSamples = metricSamples.filter((sample) =>
        sample.dayKey.startsWith(`2026-${month}`),
      );
      await writeFile(
        path.join(
          vaultRoot,
          `ledger/metric-samples/hrv-rmssd/2026/2026-${month}.jsonl`,
        ),
        `${monthSamples.map((sample) => JSON.stringify(sample)).join("\n")}\n`,
        "utf8",
      );
    }

    await rebuildQueryProjection(vaultRoot);
    const runtimeReport = await buildPersonalPatternReportRuntime(vaultRoot, {
      asOf: "2026-04-27",
    });
    const snapshot = await loadProjectedVaultSource(vaultRoot);
    const metricPoints = await listMetricPointsRuntime(vaultRoot, {
      limit: null,
    });
    assert.equal(metricPoints.length, 112);
    assert.ok(metricPoints.every((point) => point.metricKey === "hrv-rmssd"));
    const replica = await createBrowserVaultReplica({
      generatedAt: "2026-04-27T12:00:00.000Z",
      metricPoints,
      sourceBundleHash: "r".repeat(64),
      vault: createVaultReadModel({
        entities: snapshot.entities,
        metadata: snapshot.metadata,
        vaultRoot,
      }),
    });
    const browserReport = parseBrowserVaultReplica(replica).personalPatterns;

    assert.equal(runtimeReport.factors[0]?.id, "running");
    assert.equal(
      runtimeReport.cells.find((cell) => cell.outcomeId === "hrv")?.stage,
      "seen_again",
    );
    assert.deepEqual(browserReport, runtimeReport);
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
    attributes:
      kind === "activity_session" && attributes.source === undefined
        ? { ...attributes, source: "device" }
        : attributes,
    date,
    kind,
    occurredAt: `${date}T12:00:00.000Z`,
  });
}

function junctionWearableTagNote(
  id: string,
  date: string,
  sourceProviderSlug: string,
  tags: string[],
): CanonicalEntity {
  return entity("event", id, {
    attributes: {
      dataOrigin: { sourceProviderSlug },
      externalRef: {
        facet: JUNCTION_WEARABLE_TAG_EXTERNAL_REF_FACET,
        resourceId: id,
        resourceType: `junction-${sourceProviderSlug}-note`,
        system: "junction",
      },
      note: "Wearable tags",
      noteType: JUNCTION_WEARABLE_TAG_NOTE_TYPE,
      source: "device",
    },
    date,
    kind: "note",
    occurredAt: `${date}T12:00:00.000Z`,
    tags,
  });
}

function journalFactor(
  id: string,
  date: string,
  key: string,
  state: "did-not-happen" | "happened",
  extraTags: string[] = [],
): CanonicalEntity {
  return entity("event", id, {
    attributes: {
      note: key,
      noteType: "journal-factor",
      source: "manual",
    },
    date,
    kind: "note",
    occurredAt: `${date}T12:00:00.000Z`,
    tags: ["journal", `key-${key}`, state, ...extraTags],
  });
}

function journalOutcome(
  id: string,
  date: string,
  key: string,
  value: string,
): CanonicalEntity {
  return entity("event", id, {
    attributes: {
      note: key,
      noteType: "journal-outcome",
      source: "manual",
    },
    date,
    kind: "note",
    occurredAt: `${date}T12:00:00.000Z`,
    tags: ["journal", `key-${key}`, `value-${value}`],
  });
}

function legacyJunctionNoteTagIntervention(
  id: string,
  date: string,
  tag: string,
): CanonicalEntity {
  return event(id, date, "intervention_session", {
    dataOrigin: { sourceProviderSlug: "oura" },
    externalRef: {
      facet: `tag-${tag}`,
      resourceId: id,
      resourceType: "junction-oura-note",
      system: "junction",
    },
    interventionType: tag,
    sessionStatus: "completed",
    source: "device",
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

function metricPoint(
  id: string,
  date: string,
  metricKey: string,
  value: number,
  unit: string,
): MetricPoint {
  return {
    biomarkerKey: null,
    canonicalUnit: unit,
    canonicalValue: value,
    comparator: null,
    confidence: "high",
    context: {},
    effectiveDate: date,
    grain: "day",
    id,
    metricKey,
    observedAt: `${date}T00:00:00.000Z`,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: "whoop",
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
      recordId: `record:${id}`,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value,
  };
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
    Math.round((index * spanDays) / (count - 1)),
  );
  const factorIndexByDate = new Map(
    offsets.map((offset, index) => [addDays(start, offset), index] as const),
  );
  const asOfOffset = spanDays + 14;
  const entities: CanonicalEntity[] = [
    ...offsets.map((offset, index) => {
      const date = addDays(start, offset);
      return event(
        `run_stage_${count}_${spanDays}_${index}`,
        date,
        "activity_session",
        {
          activityType: "running",
        },
      );
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

  return buildPersonalPatternReport(
    createVaultReadModel({
      entities,
      vaultRoot: `test://personal-pattern-stage-${count}-${spanDays}`,
    }),
    {
      asOf: addDays(start, asOfOffset),
      windowDays: Math.max(28, asOfOffset + 1),
    },
  );
}
