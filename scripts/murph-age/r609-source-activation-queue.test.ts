import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R609_SOURCE_ACTIVATION_QUEUE_SCHEMA_VERSION,
  runR609SourceActivationQueue,
} from "./r609-source-activation-queue.ts";

describe("R609 source activation queue", () => {
  it("builds a compact aggregate-only activation queue from current source-readiness outputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r609-queue-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR609SourceActivationQueue({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r609-source-activation-queue.latest.json");
      expect(output.schemaVersion).toBe(R609_SOURCE_ACTIVATION_QUEUE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        outcomeScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
      });
      expect(output.candidateLanes.map((lane) => lane.laneId)).toEqual([
        "mhas-harmonized-eol",
        "nshap",
        "haalsi",
        "creles-transport",
        "midus-refresher-triad",
      ]);
      expect(output.candidateLanes.every((lane) => lane.outcomeScoringUnlocked === false)).toBe(true);
      expect(output.candidateLanes[0]).toMatchObject({
        allowedNextLocalAction: "draft_locked_mhas_join_and_endpoint_contract",
        currentStatus: "metadata_ready",
        laneId: "mhas-harmonized-eol",
        reviewGptHighLevelSourceStrategyOnly: true,
        reviewGptReason: "locked_join_strategy_needed",
      });
      expect(output.candidateLanes[1]).toMatchObject({
        allowedNextLocalAction: "design_locked_metadata_only_benchmark_card",
        currentStatus: "metadata_ready_activation_required",
        laneId: "nshap",
        reviewGptHighLevelSourceStrategyOnly: true,
      });
      expect(output.candidateLanes[2]).toMatchObject({
        allowedNextLocalAction: "fill_source_rights_and_activation_labels_before_row_execution",
        currentStatus: "metadata_ready_activation_required",
        laneId: "haalsi",
      });
      expect(output.candidateLanes[3]).toMatchObject({
        allowedNextLocalAction: "refresh-r603-transport-readiness-before-next-review",
        currentStatus: "inventory_candidate",
        laneId: "creles-transport",
        reviewGptHighLevelSourceStrategyOnly: false,
      });
      expect(output.reviewGptStrategyQueue).toEqual([
        {
          laneId: "mhas-harmonized-eol",
          reason: "locked_join_strategy_needed",
          reviewScope: "high_level_source_strategy_only",
        },
        {
          laneId: "nshap",
          reason: "benchmark_design_strategy_needed",
          reviewScope: "high_level_source_strategy_only",
        },
        {
          laneId: "haalsi",
          reason: "future_outcome_strategy_needed",
          reviewScope: "high_level_source_strategy_only",
        },
      ]);
      expect(output.summary).toEqual({
        candidateLaneCountBand: "1-9",
        conclusion: "source_activation_queue_ready",
        outcomeScoringUnlockedCountBand: "0",
        reviewGptLaneCountBand: "1-9",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("source body");
      expect(persisted).not.toContain("\"rowCount\":");
      expect(persisted).not.toContain("\"columnCount\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when input artifacts are absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r609-missing-"));
    try {
      const { output } = await runR609SourceActivationQueue({
        haalsiSourceFeasibilityPath: path.join(tmp, "missing-haalsi.json"),
        mhasJoinProbePath: path.join(tmp, "missing-mhas-join.json"),
        mhasSourceFeasibilityPath: path.join(tmp, "missing-mhas-source.json"),
        nshapActivationFeasibilityPath: path.join(tmp, "missing-nshap.json"),
        outputDir: path.join(tmp, "out"),
        r604NextSourceInventoryPath: path.join(tmp, "missing-r604.json"),
      });

      expect(Object.values(output.artifactInputs).every((artifact) => artifact.status === "missing")).toBe(true);
      expect(output.candidateLanes.map((lane) => lane.laneId)).toEqual([
        "mhas-harmonized-eol",
        "nshap",
        "haalsi",
      ]);
      expect(output.candidateLanes.every((lane) => lane.currentStatus === "missing_input_artifact")).toBe(true);
      expect(output.candidateLanes.every((lane) => lane.outcomeScoringUnlocked === false)).toBe(true);
      expect(output.reviewGptStrategyQueue).toEqual([]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r609-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r609-source-activation-queue.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_HAALSI_SOURCE_FEASIBILITY_PATH: paths.haalsiSourceFeasibilityPath,
          MURPH_AGE_MHAS_JOIN_PROBE_PATH: paths.mhasJoinProbePath,
          MURPH_AGE_MHAS_SOURCE_FEASIBILITY_PATH: paths.mhasSourceFeasibilityPath,
          MURPH_AGE_NSHAP_ACTIVATION_FEASIBILITY_PATH: paths.nshapActivationFeasibilityPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
          MURPH_AGE_R604_NEXT_SOURCE_INVENTORY_PATH: paths.r604NextSourceInventoryPath,
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({
        artifact: "r609-source-activation-queue.latest.json",
        candidateLaneCountBand: "1-9",
        outcomeScoringUnlockedCountBand: "0",
        packetId: "r609-source-activation-queue",
        reviewGptLaneCountBand: "1-9",
        schemaVersion: R609_SOURCE_ACTIVATION_QUEUE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  haalsiSourceFeasibilityPath: string;
  mhasJoinProbePath: string;
  mhasSourceFeasibilityPath: string;
  nshapActivationFeasibilityPath: string;
  r604NextSourceInventoryPath: string;
}> {
  await mkdir(tmp, { recursive: true });
  const haalsiSourceFeasibilityPath = path.join(tmp, "haalsi-source-feasibility.json");
  const mhasJoinProbePath = path.join(tmp, "mhas-join-probe.json");
  const mhasSourceFeasibilityPath = path.join(tmp, "mhas-source-feasibility.json");
  const nshapActivationFeasibilityPath = path.join(tmp, "nshap-activation-feasibility.json");
  const r604NextSourceInventoryPath = path.join(tmp, "r604-next-source-inventory.json");
  await Promise.all([
    writeJson(haalsiSourceFeasibilityPath, haalsiFixture()),
    writeJson(mhasJoinProbePath, mhasJoinFixture()),
    writeJson(mhasSourceFeasibilityPath, mhasSourceFixture()),
    writeJson(nshapActivationFeasibilityPath, nshapFixture()),
    writeJson(r604NextSourceInventoryPath, r604Fixture()),
  ]);
  return {
    haalsiSourceFeasibilityPath,
    mhasJoinProbePath,
    mhasSourceFeasibilityPath,
    nshapActivationFeasibilityPath,
    r604NextSourceInventoryPath,
  };
}

function mhasSourceFixture() {
  return {
    joinReadiness: {
      status: "metadata_join_probe_ready",
    },
    packetId: "mhas-harmonized-eol-source-feasibility",
    schemaVersion: "murph-age-mhas-source-feasibility.v1",
    transportLoopEligibility: {
      eligible: true,
      nextGate: "declare_mortality_join_contract_before_scoring",
    },
  };
}

function mhasJoinFixture() {
  return {
    joinFeasibility: {
      readyForLockedJoinContract: true,
      status: "metadata_ready",
    },
    nextRunnableAction: "draft_locked_mhas_join_and_endpoint_contract",
    packetId: "mhas-harmonized-eol-aggregate-join-probe",
    schemaVersion: "murph-age-mhas-join-probe.v1",
  };
}

function nshapFixture() {
  return {
    endpointReadiness: {
      readyForLockedBenchmarkDesign: true,
      rowActivationRequiredBeforeExecution: true,
      status: "metadata_ready_activation_required_before_rows",
    },
    noScoreReadiness: {
      nextAction: "design_locked_metadata_only_benchmark_card",
    },
    packetId: "nshap-activation-feasibility",
    schemaVersion: "murph-age-nshap-activation-feasibility.v1",
  };
}

function haalsiFixture() {
  return {
    endpointReadiness: {
      readyForFutureOutcomeDesign: true,
      rowActivationRequiredBeforeExecution: true,
      status: "metadata_ready_activation_required_before_rows",
    },
    laneAssessment: {
      classification: "no-score_activation_lane",
      nextAction: "fill_source_rights_and_activation_labels_before_row_execution",
    },
    packetId: "haalsi-source-feasibility",
    schemaVersion: "murph-age-haalsi-source-feasibility.v1",
  };
}

function r604Fixture() {
  return {
    nextLocalActionQueue: [
      {
        actionId: "refresh-r603-transport-readiness-before-next-review",
        actionKind: "local_packet_refresh",
        blockedUntil: [],
        laneGroup: "creles-transport",
      },
      {
        actionId: "fill-activation-labels-midus-refresher-triad",
        actionKind: "activation_label_fill",
        blockedUntil: ["lane-specific source-rights labels", "locked benchmark card before row parsing"],
        laneGroup: "midus-refresher-triad",
      },
    ],
    packetId: "r604-next-source-inventory",
    schemaVersion: "murph-age-r604-next-source-inventory.v1",
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
