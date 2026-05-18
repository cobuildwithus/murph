import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R977_NSHAP_NEXT_ACTIVATION_PROBE_SCHEMA_VERSION,
  runR977NshapNextActivationProbe,
} from "./r977-nshap-next-activation-probe.ts";

describe("R977 NSHAP next activation probe", () => {
  it("reports benchmark-card readiness while keeping the function-cognition lane blocked by activation labels", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r977-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR977NshapNextActivationProbe({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r977-nshap-next-activation-probe.latest.json");
      expect(output.schemaVersion).toBe(R977_NSHAP_NEXT_ACTIVATION_PROBE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        archiveBasenamesStored: false,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        modelScoringPerformed: false,
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
        splitMembershipStored: false,
        variableListsStored: false,
        variableNameSamplesStored: false,
      });
      expect(output.benchmarkCardReadiness).toEqual({
        available: true,
        endpointFamily: "mortality_or_followup",
        readyForBenchmarkCard: true,
        status: "available_locked_no_execution",
      });
      expect(output.rowExecutionGate).toEqual({
        blockingReasons: [
          "mortality_or_followup_endpoint_label_unconfirmed",
          "outcome_scoring_requires_separate_execution_gate",
          "source_rights_or_aggregate_output_permission_unconfirmed",
        ],
        aggregateOutputsActive: false,
        endpointLabelComplete: false,
        nextAction: "complete_source_rights_endpoint_and_aggregate_output_labels",
        rowExecutionUnlocked: false,
        sourceRightsLabelsComplete: false,
        status: "blocked_source_rights_or_endpoint_labels",
      });
      expect(output.functionCognitionSidecar).toMatchObject({
        laneStatus: "blocked_activation_report_only",
        rowExecutionUnlocked: false,
        scoringUnlocked: false,
      });
      expect(output.functionCognitionSidecar.functionLane).toMatchObject({
        candidateFamilyAvailable: true,
        headerSignal: {
          datasetCountBand: "1-9",
          headerMatchBand: "1-9",
          present: true,
        },
        status: "blocked_source_rights_or_endpoint_labels",
      });
      expect(output.functionCognitionSidecar.cognitionLane).toMatchObject({
        candidateFamilyAvailable: true,
        headerSignal: {
          datasetCountBand: "1-9",
          headerMatchBand: "1-9",
          present: true,
        },
        status: "blocked_source_rights_or_endpoint_labels",
      });
      expect(output.summary).toEqual({
        benchmarkCardReady: true,
        conclusion: "nshap_benchmark_card_ready_but_sidecar_blocked_by_activation_labels",
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("ICPSR_");
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("CASEID");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("source body");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("allows only a no-score sidecar scaffold when activation labels are complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r977-ready-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { activationLabelsComplete: true });
      const { output } = await runR977NshapNextActivationProbe({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(output.rowExecutionGate).toEqual({
        blockingReasons: ["outcome_scoring_requires_separate_execution_gate"],
        aggregateOutputsActive: true,
        endpointLabelComplete: true,
        nextAction: "draft_no_score_function_sidecar_scaffold",
        rowExecutionUnlocked: false,
        sourceRightsLabelsComplete: true,
        status: "metadata_ready_no_score_scaffold_only",
      });
      expect(output.functionCognitionSidecar.laneStatus).toBe("metadata_ready_for_no_score_sidecar_scaffold");
      expect(output.functionCognitionSidecar.functionLane.status).toBe("metadata_ready_for_no_score_scaffold");
      expect(output.functionCognitionSidecar.cognitionLane.status).toBe("metadata_ready_for_no_score_scaffold");
      expect(output.summary.conclusion).toBe("nshap_metadata_ready_for_no_score_sidecar_scaffold");
      expect(output.summary.rowExecutionUnlocked).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps the sidecar blocked when activation labels appear complete but aggregate output is not active", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r977-aggregate-blocked-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        activationLabelsComplete: true,
        aggregateOutputsActive: false,
        requiredHumanLabels: ["aggregate_output_permission_clear"],
      });
      const { output } = await runR977NshapNextActivationProbe({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(output.rowExecutionGate).toEqual({
        blockingReasons: [
          "aggregate_output_permission_not_active",
          "outcome_scoring_requires_separate_execution_gate",
          "required_activation_labels_still_present",
        ],
        aggregateOutputsActive: false,
        endpointLabelComplete: true,
        nextAction: "complete_source_rights_endpoint_and_aggregate_output_labels",
        rowExecutionUnlocked: false,
        sourceRightsLabelsComplete: true,
        status: "blocked_source_rights_or_endpoint_labels",
      });
      expect(output.functionCognitionSidecar.laneStatus).toBe("blocked_activation_report_only");
      expect(output.summary.conclusion).toBe("nshap_benchmark_card_ready_but_sidecar_blocked_by_activation_labels");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when an input artifact boundary exports unsafe values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r977-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeLabelsPath = path.join(tmp, "unsafe-labels.json");
      await writeJson(unsafeLabelsPath, {
        ...activationLabelsFixture(),
        boundary: safeBoundary(),
        artifactBoundary: {
          ...safeBoundary(),
          variableListsStored: true,
        },
      });

      await expect(runR977NshapNextActivationProbe({
        ...paths,
        activationLabelsPath: unsafeLabelsPath,
      })).rejects.toThrow("activationLabels boundary has unsafe boundary flag variableListsStored");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r977-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r977-nshap-next-activation-probe.ts",
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSHAP_ACTIVATION_FEASIBILITY_PATH: paths.activationFeasibilityPath,
          MURPH_AGE_NSHAP_HEADER_PREFLIGHT_PATH: paths.headerPreflightPath,
          MURPH_AGE_R613_NSHAP_BENCHMARK_CARD_PATH: paths.metadataBenchmarkCardPath,
          MURPH_AGE_R614_NSHAP_LABELS_PATH: paths.activationLabelsPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r977-nshap-next-activation-probe.latest.json",
        benchmarkCardReady: true,
        conclusion: "nshap_benchmark_card_ready_but_sidecar_blocked_by_activation_labels",
        nextAction: "complete_source_rights_endpoint_and_aggregate_output_labels",
        packetId: "r977-nshap-next-activation-probe",
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
        schemaVersion: R977_NSHAP_NEXT_ACTIVATION_PROBE_SCHEMA_VERSION,
        sidecarLaneStatus: "blocked_activation_report_only",
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("ICPSR_");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: {
    activationLabelsComplete?: boolean;
    aggregateOutputsActive?: boolean;
    requiredHumanLabels?: string[];
  } = {},
): Promise<{
  activationFeasibilityPath: string;
  activationLabelsPath: string;
  headerPreflightPath: string;
  metadataBenchmarkCardPath: string;
  outputDir: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    activationFeasibilityPath: path.join(fixtureDir, "nshap-feasibility.json"),
    activationLabelsPath: path.join(fixtureDir, "nshap-labels.json"),
    headerPreflightPath: path.join(fixtureDir, "nshap-header.json"),
    metadataBenchmarkCardPath: path.join(fixtureDir, "nshap-card.json"),
    outputDir,
  };
  await Promise.all([
    writeJson(paths.activationFeasibilityPath, activationFeasibilityFixture()),
    writeJson(paths.activationLabelsPath, activationLabelsFixture(options)),
    writeJson(paths.headerPreflightPath, headerPreflightFixture()),
    writeJson(paths.metadataBenchmarkCardPath, metadataBenchmarkCardFixture()),
  ]);
  return paths;
}

function activationFeasibilityFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    endpointReadiness: {
      readyForLockedBenchmarkDesign: true,
      rowActivationRequiredBeforeExecution: true,
      status: "metadata_ready_activation_required_before_rows",
    },
    featureFamilies: {
      activityOrFunction: {
        datasetCount: 1,
        headerMatchBand: "1-9",
        present: true,
      },
      cognition: {
        datasetCount: 2,
        headerMatchBand: "1-9",
        present: true,
      },
    },
    packetId: "nshap-activation-feasibility",
    schemaVersion: "murph-age-nshap-activation-feasibility.v1",
    status: "research-local-metadata-only",
  };
}

function activationLabelsFixture(options: {
  activationLabelsComplete?: boolean;
  aggregateOutputsActive?: boolean;
  requiredHumanLabels?: string[];
} = {}): Record<string, unknown> {
  const complete = options.activationLabelsComplete === true;
  const aggregateOutputsActive = options.aggregateOutputsActive ?? complete;
  const requiredHumanLabels = options.requiredHumanLabels ?? (complete
    ? []
    : [
      "aggregate_output_permission_clear",
      "biomarker_overlap_clear",
      "mortality_or_followup_endpoint_available",
      "terms_allow_local_research_rows",
      "wave_linkage_policy_clear",
    ]);
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r614-nshap-activation-labels",
    rowExecutionReadiness: {
      blockingReasons: complete
        ? ["outcome_scoring_requires_separate_execution_gate"]
        : [
          "outcome_scoring_requires_separate_execution_gate",
          "source_rights_or_aggregate_output_permission_unconfirmed",
        ],
      rowExecutionUnlocked: false,
      status: complete
        ? "metadata_ready_activation_labels_complete_no_scoring"
        : "blocked_source_rights_or_output_permission_unconfirmed",
    },
    schemaVersion: "murph-age-r614-nshap-activation-labels.v1",
    sourceRightsAndAggregateOutput: {
      aggregateOutputsActive,
      labelsComplete: complete,
      requiredHumanLabels,
    },
    status: "research-local-aggregate-only",
  };
}

function metadataBenchmarkCardFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    benchmarkCard: {
      candidateFamilies: [
        {
          candidateFamilyId: "anchor_plus_function_sidecar",
          role: "primary_increment",
        },
        {
          candidateFamilyId: "cognition_shadow_after_function",
          role: "shadow",
        },
      ],
      cardStatus: "metadata_locked_no_execution",
      endpointFamily: "mortality_or_followup",
      sourceFit: {
        endpointReadyForBenchmarkDesign: true,
      },
    },
    packetId: "r613-nshap-metadata-benchmark-card",
    schemaVersion: "murph-age-r613-nshap-metadata-benchmark-card.v1",
    status: "research-local-aggregate-only",
  };
}

function headerPreflightFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    packetId: "nshap-header-preflight",
    schemaVersion: "murph-age-source-header-preflight.v1",
    status: "research-local-metadata-only",
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    archiveBasenamesStored: false,
    codebookProseStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    modelScoringPerformed: false,
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
    variableListsStored: false,
    variableNamesStored: false,
    variableNameSamplesStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
