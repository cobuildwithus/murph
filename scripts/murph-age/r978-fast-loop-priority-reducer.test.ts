import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R978_FAST_LOOP_PRIORITY_REDUCER_SCHEMA_VERSION,
  runR978FastLoopPriorityReducer,
} from "./r978-fast-loop-priority-reducer.ts";

describe("R978 fast-loop priority reducer", () => {
  it("prioritizes the MHAS function-disability fast loop from aggregate artifacts only", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r978-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR978FastLoopPriorityReducer({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r978-fast-loop-priority-reducer.latest.json");
      expect(output.schemaVersion).toBe(R978_FAST_LOOP_PRIORITY_REDUCER_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        markdownBodiesStored: false,
        modelParametersStored: false,
        outcomeScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformed: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        variableListsStored: false,
      });
      expect(output.consensusReduction).toEqual({
        labFamilyPolicy: {
          fallbackLabel: "lab5_fallback_warning",
          preferredLabel: "lab9_preferred",
          variableListsStored: false,
        },
        primaryExecutionLane: "mhas_function_disability",
        researchOnly: true,
        wearablePolicy: "shadow_only",
      });
      expect(output.summary).toEqual({
        conclusion: "next_loop_queue_ready",
        nextDataSource: "MHAS",
        nextLoopId: "mhas-function-disability-fast-loop",
        outcomeScoringUnlocked: false,
        productDisplayAuthorized: false,
        queueItemCountBand: "5-9",
        rowExecutionUnlocked: false,
      });

      const first = output.queue[0];
      expect(first).toMatchObject({
        dataSource: "MHAS",
        loopId: "mhas-function-disability-fast-loop",
        nextLocalAction: "draft_locked_mhas_endpoint_join_contract",
        outcomeScoringUnlocked: false,
        priorityBand: "p0_next",
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
        sourceLabels: {
          activationTier: "endpoint_contract_ready_no_scoring",
          aggregateOutputLabel: "green",
          evidenceClass: "non_us_external_candidate",
          functionOrDisability: "green",
          hardOutcome: "green",
          joinOrWaveLabel: "green",
          sourceRightsLabel: "green",
          wearableOrActivity: "yellow",
        },
      });
      expect(first?.frozen).toContain("primary_execution_lane");
      expect(first?.editable).toContain("function_disability_aggregate_reducer_scaffold");
      expect(output.queue.map((item) => [item.dataSource, item.priorityBand])).toEqual([
        ["MHAS", "p0_next"],
        ["CRELES", "p1_after_primary"],
        ["NSHAP", "p2_activation_blocked"],
        ["HAALSI", "p2_activation_blocked"],
        ["SAGE", "p2_activation_blocked"],
        ["NHANES", "shadow_only"],
      ]);
      expect(output.inputArtifacts.reviewMarkdown).toEqual({
        artifact: "reviewgpt-strategy-markdown",
        packetId: "markdown_signal_body_not_stored",
        schemaVersion: null,
        status: "available",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("CASEID");
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("source body");
      expect(persisted).not.toContain("ReviewGPT says");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when an input boundary exports unsafe values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r978-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeMatrixPath = path.join(tmp, "unsafe-r615.json");
      await writeJson(unsafeMatrixPath, {
        ...activationMatrixFixture(),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR978FastLoopPriorityReducer({
        ...paths,
        r615Path: unsafeMatrixPath,
      })).rejects.toThrow("r615CrossSourceActivationMatrix boundary has unsafe boundary flag rowValuesStored");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r978-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r978-fast-loop-priority-reducer.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R610_LOOP_SCAFFOLD_PATH: paths.r610Path,
          MURPH_AGE_R614_MHAS_LABELS_PATH: paths.r614MhasPath,
          MURPH_AGE_R615_ACTIVATION_MATRIX_PATH: paths.r615Path,
          MURPH_AGE_R976_GENERALIZATION_EVALUATOR_PATH: paths.r976Path,
          MURPH_AGE_R977_NSHAP_PROBE_PATH: paths.r977Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
          MURPH_AGE_REVIEW_MARKDOWN_PATH: paths.reviewMarkdownPath,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r978-fast-loop-priority-reducer.latest.json",
        conclusion: "next_loop_queue_ready",
        nextDataSource: "MHAS",
        nextLoopId: "mhas-function-disability-fast-loop",
        packetId: "r978-fast-loop-priority-reducer",
        productDisplayAuthorized: false,
        queueItemCountBand: "5-9",
        rowExecutionUnlocked: false,
        schemaVersion: R978_FAST_LOOP_PRIORITY_REDUCER_SCHEMA_VERSION,
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
  outputDir: string;
  r610Path: string;
  r614MhasPath: string;
  r615Path: string;
  r976Path: string;
  r977Path: string;
  reviewMarkdownPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const paths = {
    outputDir,
    r610Path: path.join(fixtureDir, "r610.json"),
    r614MhasPath: path.join(fixtureDir, "r614-mhas.json"),
    r615Path: path.join(fixtureDir, "r615.json"),
    r976Path: path.join(fixtureDir, "r976.json"),
    r977Path: path.join(fixtureDir, "r977.json"),
    reviewMarkdownPath: path.join(fixtureDir, "review.md"),
  };

  await Promise.all([
    writeJson(paths.r610Path, loopScaffoldFixture()),
    writeJson(paths.r614MhasPath, mhasLabelsFixture()),
    writeJson(paths.r615Path, activationMatrixFixture()),
    writeJson(paths.r976Path, generalizationFixture()),
    writeJson(paths.r977Path, nshapProbeFixture()),
    writeFile(paths.reviewMarkdownPath, "ReviewGPT says MHAS function disability remains a strategy cue only.\n"),
  ]);

  return paths;
}

function activationMatrixFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    nextBatch: [
      {
        actionId: "draft_locked_mhas_endpoint_join_contract",
        sourceFamily: "MHAS",
      },
    ],
    packetId: "r615-cross-source-activation-matrix",
    schemaVersion: "murph-age-r615-cross-source-activation-matrix.v1",
    sourceRows: [
      sourceRowFixture("MHAS", "endpoint_contract_ready_no_scoring", {
        evidenceClass: "non_us_external_candidate",
        functionOrDisability: "green",
        hardOutcome: "green",
        sourceRightsLabel: "green",
      }),
      sourceRowFixture("CRELES", "ready_for_aggregate_benchmark_completed", {
        evidenceClass: "non_nhanes_transport_diagnostic",
        functionOrDisability: "yellow",
        hardOutcome: "green",
        sourceRightsLabel: "green",
      }),
      sourceRowFixture("NSHAP", "rights_blocked", {
        evidenceClass: "metadata_transport_candidate",
        functionOrDisability: "green",
        hardOutcome: "yellow",
        sourceRightsLabel: "red",
      }),
      sourceRowFixture("HAALSI", "outcome_blocked", {
        evidenceClass: "metadata_transport_candidate",
        functionOrDisability: "green",
        hardOutcome: "red",
        sourceRightsLabel: "yellow",
      }),
      sourceRowFixture("SAGE", "metadata_only", {
        evidenceClass: "context_only_candidate",
        functionOrDisability: "green",
        hardOutcome: "yellow",
        sourceRightsLabel: "yellow",
      }),
      sourceRowFixture("NHANES", "same_family_internal_only", {
        evidenceClass: "same_family_internal",
        functionOrDisability: "missing",
        hardOutcome: "yellow",
        sourceRightsLabel: "green",
      }),
    ],
    status: "research-local-aggregate-only",
  };
}

function sourceRowFixture(
  sourceFamily: string,
  activationTier: string,
  labels: {
    evidenceClass: string;
    functionOrDisability: string;
    hardOutcome: string;
    sourceRightsLabel: string;
  },
): Record<string, unknown> {
  return {
    activationTier,
    aggregateOutputLabel: labels.sourceRightsLabel === "red" ? "red" : "green",
    allowedNextLocalActions: [`next_${sourceFamily.toLowerCase()}_metadata_action`],
    blockedNextActions: ["outcome_scoring_until_execution_gate", "product_claims_blocked"],
    candidateDomainLabels: {
      functionOrDisability: labels.functionOrDisability,
      hardOutcome: labels.hardOutcome,
      wearableOrActivity: "yellow",
    },
    evidenceClass: labels.evidenceClass,
    joinOrWaveLabel: sourceFamily === "NHANES" ? "not_applicable" : "green",
    rowExecutionUnlocked: false,
    sourceFamily,
    sourceRightsLabel: labels.sourceRightsLabel,
  };
}

function mhasLabelsFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    gates: {
      blockedActions: [
        "model_mutation_until_execution_gate",
        "outcome_scoring_until_locked_benchmark",
        "product_claims_blocked",
        "row_execution_until_locked_endpoint_join_contract",
      ],
      nextGate: "draft_locked_mhas_endpoint_join_contract",
      outcomeScoringUnlocked: false,
      rowExecutionUnlocked: false,
    },
    packetId: "r614-mhas-source-rights-activation-labels",
    schemaVersion: "murph-age-r614-mhas-source-rights-activation-labels.v1",
    status: "research-local-aggregate-only",
    summary: {
      endpointJoinContractReady: true,
      sourceRightsLabelsComplete: true,
    },
  };
}

function loopScaffoldFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    executableLocalLoops: [
      {
        laneId: "mhas-harmonized-eol",
        localAction: "draft_locked_mhas_join_and_endpoint_contract",
      },
    ],
    packetId: "r610-next-executable-loop-scaffold",
    schemaVersion: "murph-age-r610-next-executable-loop-scaffold.v1",
    status: "research-local-aggregate-only",
  };
}

function generalizationFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r976-external-generalization-evaluator",
    schemaVersion: "murph-age-r976-external-generalization-evaluator.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "external_generalization_slots_ready",
    },
  };
}

function nshapProbeFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r977-nshap-next-activation-probe",
    rowExecutionGate: {
      blockingReasons: [
        "mortality_or_followup_endpoint_label_unconfirmed",
        "outcome_scoring_requires_separate_execution_gate",
        "source_rights_or_aggregate_output_permission_unconfirmed",
      ],
      nextAction: "complete_source_rights_endpoint_and_aggregate_output_labels",
      rowExecutionUnlocked: false,
      sourceRightsLabelsComplete: false,
    },
    schemaVersion: "murph-age-r977-nshap-next-activation-probe.v1",
    status: "research-local-aggregate-only",
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformed: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowParsingPerformed: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableNamesStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
