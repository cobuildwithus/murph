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

async function createAnchoredLabMetricProjectionVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-experiment-anchor-metrics-"));
  createdVaultRoots.push(vaultRoot);

  await mkdir(path.join(vaultRoot, "bank/experiments"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

  await writeFile(
    path.join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4M",
      createdAt: "2026-06-01T00:00:00.000Z",
      title: "Experiment Anchor Metrics",
      timezone: "UTC",
    })}\n`,
    "utf8",
  );

  await writeFile(
    path.join(vaultRoot, "bank/experiments/psyllium-ldl.md"),
    `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_01JNV4458HYPP53JDQCBP1QJFK
slug: psyllium-ldl
status: completed
title: Psyllium LDL
startedOn: 2026-05-09
runPlan:
  baselineStart: 2026-05-02
  baselineEnd: 2026-05-08
  interventionStart: 2026-05-09
  interventionEnd: 2026-08-01
analysisPlan:
  primaryBiomarkerKey: biomarker:ldl-c
  desiredDirection: decrease
  measurementAnchors:
    - role: baseline
      kind: lab_panel
      recordId: evt_lipid_baseline
      biomarkerKeys:
        - biomarker:ldl-c
      observedOn: 2026-04-23
    - role: followup
      kind: lab_panel
      recordId: evt_lipid_followup
      biomarkerKeys:
        - biomarker:ldl-c
      observedOn: 2026-08-02
---
# Psyllium LDL
`,
    "utf8",
  );

  const results = [
    ["evt_lipid_baseline", "2026-04-23", 140],
    ["evt_lipid_followup", "2026-08-02", 120],
  ] as const;
  const events = results.map(([id, date, value]) => JSON.stringify({
    schemaVersion: "murph.event.v1",
    id,
    kind: "test",
    occurredAt: `${date}T08:00:00.000Z`,
    collectedAt: `${date}T08:00:00.000Z`,
    source: "manual",
    title: "Lab result",
    results: [{
      analyte: "ldl-c",
      biomarkerSlug: "ldl-c",
      unit: "mg/dL",
      value,
    }],
  }));

  await writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-labs.jsonl"),
    `${events.join("\n")}\n`,
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

  const midRunProgress = await showExperimentProgress({
    vault: vaultRoot,
    lookup: "sleep-efficiency",
    asOf: "2026-06-04",
  });
  assert.equal(midRunProgress.progress.adherence.completedSessions, 1);
  assert.equal(midRunProgress.progress.adherence.expectedSessionsByNow, 1);

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

  const midRunCard = await showExperimentProgressCard({
    vault: vaultRoot,
    lookup: "sleep-efficiency",
    asOf: "2026-06-04",
  });
  assert.equal(midRunCard.card.sessions.logged, 1);
  assert.equal(midRunCard.card.weeks[0]?.cells, "CSSOOOO");
});

test("experiment progress usecases keep anchored lab metrics outside run windows", async () => {
  const vaultRoot = await createAnchoredLabMetricProjectionVault();

  const progress = await showExperimentProgress({
    vault: vaultRoot,
    lookup: "psyllium-ldl",
    asOf: "2026-08-02",
  });
  assert.equal(progress.progress.signals[0]?.baselineMean, 140);
  assert.equal(progress.progress.signals[0]?.interventionMean, 120);
  assert.equal(progress.progress.signals[0]?.deltaAbs, -20);

  const outcome = await analyzeExperimentOutcomeRecord({
    vault: vaultRoot,
    lookup: "psyllium-ldl",
    asOf: "2026-08-02",
  });
  assert.equal(outcome.outcome.metricResults[0]?.baselineMean, 140);
  assert.equal(outcome.outcome.metricResults[0]?.interventionMean, 120);
  assert.equal(outcome.outcome.metricResults[0]?.deltaAbs, -20);
});
