import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { listMetricPoints } from "@murphai/query";

import {
  analyzeExperimentOutcomeRecord,
  showExperimentProgress,
  showExperimentProgressCard,
} from "../src/usecases/experiment-journal-vault.ts";

const createdVaultRoots: string[] = [];

async function createExperimentMetricProjectionVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-experiment-progress-metrics-"));
  createdVaultRoots.push(vaultRoot);

  await mkdir(path.join(vaultRoot, "bank/experiments"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

  await writeFile(
    path.join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      createdAt: "2026-06-01T00:00:00.000Z",
      title: "Experiment Progress Metrics",
      timezone: "UTC",
    })}\n`,
    "utf8",
  );

  await writeFile(
    path.join(vaultRoot, "bank/experiments/sleep-efficiency.md"),
    `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_01JNV4458HYPP53JDQCBP1QJFM
slug: sleep-efficiency
status: active
title: Sleep Efficiency
startedOn: 2026-06-01
runPlan:
  baselineStart: 2026-06-01
  baselineEnd: 2026-06-03
  interventionStart: 2026-06-04
  interventionEnd: 2026-06-06
  targetSessions: 3
  minimumUsefulSessions: 2
  adherenceTargets:
    - targetId: sleep-efficiency-threshold
      label: Sleep efficiency threshold
      phase: intervention
      calendar:
        kind: daily
        timeZone: UTC
      evidence:
        kind: metricThreshold
        metricKey: sleep-efficiency
        op: ">="
        value: 90
        missing: unknown
      rollup:
        targetCompletions: 3
        minimumUsefulCompletions: 2
analysisPlan:
  primaryBiomarkerKey: biomarker:sleep-onset-latency
  secondaryBiomarkerKeys:
    - biomarker:sleep-efficiency
  expectedDirections:
    - biomarkerKey: biomarker:sleep-efficiency
      direction: increase
---
# Sleep Efficiency
`,
    "utf8",
  );

  const values = [
    ["2026-06-01", 90],
    ["2026-06-02", 91],
    ["2026-06-03", 92],
    ["2026-06-04", 95],
    ["2026-06-05", 96],
    ["2026-06-06", 97],
  ] as const;
  const observations = values.map(([date, value], index) => JSON.stringify({
    schemaVersion: "murph.event.v1",
    id: `evt_progress_metric_projection_${String(index + 1).padStart(2, "0")}`,
    kind: "observation",
    dayKey: date,
    occurredAt: `${date}T07:00:00Z`,
    recordedAt: `${date}T07:01:00Z`,
    source: "device",
    title: "WHOOP sleep efficiency",
    metric: "sleep-efficiency",
    value,
    unit: "percent",
    externalRef: {
      system: "whoop",
      resourceType: "sleep",
      resourceId: `whoop-sleep-${date}`,
      facet: "sleep_efficiency",
    },
  }));

  await writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-06.jsonl"),
    `${observations.join("\n")}\n`,
    "utf8",
  );

  return vaultRoot;
}

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("experiment progress usecases read metrics from the query metric projection", async () => {
  const vaultRoot = await createExperimentMetricProjectionVault();

  const metricPoints = await listMetricPoints(vaultRoot, {
    limit: null,
    metricKey: "sleep-efficiency",
  });
  assert.equal(metricPoints.length, 6);

  const progress = await showExperimentProgress({
    vault: vaultRoot,
    lookup: "sleep-efficiency",
    asOf: "2026-06-06",
  });

  const sleepEfficiency = progress.progress.signals.find(
    (signal: { biomarkerKey: string }) =>
      signal.biomarkerKey === "biomarker:sleep-efficiency",
  );
  assert.equal(sleepEfficiency?.baselineDayCount, 3);
  assert.equal(sleepEfficiency?.interventionDayCount, 3);
  assert.equal(progress.progress.dataCoverage.baselineDaysAvailable, 3);
  assert.equal(progress.progress.dataCoverage.interventionDaysAvailable, 3);
  assert.equal(progress.progress.dataCoverage.primaryMetricDaysAvailable, 0);
  assert.equal(progress.progress.dataCoverage.status, "partial");
  assert.equal(progress.progress.adherence.completedSessions, 3);
  assert.equal(progress.progress.adherence.expectedSessionsByNow, 3);
  assert.equal(progress.progress.adherence.status, "met_target");

  const outcome = await analyzeExperimentOutcomeRecord({
    vault: vaultRoot,
    lookup: "sleep-efficiency",
    asOf: "2026-06-06",
  });
  const outcomeSleepEfficiency = outcome.outcome.metricResults.find(
    (signal: { biomarkerKey: string }) =>
      signal.biomarkerKey === "biomarker:sleep-efficiency",
  );
  assert.equal(outcomeSleepEfficiency?.baselineDayCount, 3);
  assert.equal(outcomeSleepEfficiency?.interventionDayCount, 3);
  assert.equal(outcomeSleepEfficiency?.baselineMean, 91);
  assert.equal(outcomeSleepEfficiency?.interventionMean, 96);

  const card = await showExperimentProgressCard({
    vault: vaultRoot,
    lookup: "sleep-efficiency",
    asOf: "2026-06-06",
  });
  assert.equal(card.card.movers.length, 1);
  assert.equal(card.card.movers[0]?.label, "Sleep Efficiency");
  assert.equal(card.card.sessions.logged, 3);
  assert.equal(card.card.weeks[0]?.cells, "CCCOOOO");
});
