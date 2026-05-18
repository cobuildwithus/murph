import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R992_NSHAP_FUNCTION_COGNITION_SCAFFOLD_SCHEMA_VERSION,
  runR992NshapFunctionCognitionScaffold,
} from "./r992-nshap-function-cognition-scaffold.ts";

describe("R992 NSHAP function cognition scaffold", () => {
  it("emits a no-score fresh-execution scaffold only when activation and R977 gates are ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r992-ready-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { ready: true });
      const { output, outputPath } = await runR992NshapFunctionCognitionScaffold({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r992-nshap-function-cognition-scaffold.latest.json");
      expect(output.schemaVersion).toBe(R992_NSHAP_FUNCTION_COGNITION_SCAFFOLD_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.blockedReason).toBeNull();
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
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
        variableNamesStored: false,
      });
      expect(output.readiness).toEqual({
        activationLabelsComplete: true,
        r977RowGateStatus: "metadata_ready_no_score_scaffold_only",
        r991SupportiveDiagnosticPresent: true,
      });
      expect(output.freshExecutionScaffold).toEqual({
        noScorePlan: [
          {
            candidateFamilyId: "anchor_plus_function_sidecar",
            executionState: "planned_no_score_only",
            freshExecutionRole: "lead_sidecar",
            prerequisites: [
              "activation_labels_complete",
              "mhas_function_diagnostic_supportive",
              "no_row_execution_unlocked",
              "no_scoring_unlocked",
              "r977_row_gate_metadata_ready_no_score_scaffold_only",
            ],
            rowExecutionUnlocked: false,
            scoringUnlocked: false,
          },
          {
            candidateFamilyId: "cognition_shadow_after_function",
            executionState: "planned_no_score_only",
            freshExecutionRole: "shadow_after_function",
            prerequisites: [
              "activation_labels_complete",
              "anchor_plus_function_sidecar_scaffold_precedes_shadow",
              "no_row_execution_unlocked",
              "no_scoring_unlocked",
              "r977_row_gate_metadata_ready_no_score_scaffold_only",
            ],
            rowExecutionUnlocked: false,
            scoringUnlocked: false,
          },
        ],
        rowExecutionUnlocked: false,
        scoringUnlocked: false,
        status: "no_score_scaffold_only",
      });
      expect(output.summary).toEqual({
        artifactVerdict: "no_score_scaffold_ready",
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
        scoringUnlocked: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("CASEID");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("source text");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks with exact upstream activation reasons when labels are not complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r992-blocked-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { ready: false });
      const { output } = await runR992NshapFunctionCognitionScaffold({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(output.blockedReason).toBe([
        "activation_labels_incomplete",
        "aggregate_output_permission_not_active",
        "missing_activation_label_aggregate_output_permission_clear",
        "missing_activation_label_mortality_or_followup_endpoint_available",
        "row_readiness_blocked_source_rights_or_output_permission_unconfirmed",
        "source_rights_or_aggregate_output_permission_unconfirmed",
      ].join(";"));
      expect(output.freshExecutionScaffold).toEqual({
        noScorePlan: [],
        rowExecutionUnlocked: false,
        scoringUnlocked: false,
        status: "blocked",
      });
      expect(output.summary.artifactVerdict).toBe("blocked_no_execution");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks when activation labels are complete but the R977 row gate is not metadata-ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r992-r977-blocked-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { ready: true, r977Ready: false });
      const { output } = await runR992NshapFunctionCognitionScaffold({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(output.blockedReason).toBe([
        "outcome_scoring_requires_separate_execution_gate",
        "r977_row_gate_blocked_source_rights_or_endpoint_labels",
      ].join(";"));
      expect(output.readiness.activationLabelsComplete).toBe(true);
      expect(output.freshExecutionScaffold.noScorePlan).toEqual([]);
      expect(output.summary.rowExecutionUnlocked).toBe(false);
      expect(output.summary.scoringUnlocked).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when an input boundary exports unsafe values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r992-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { ready: true });
      const unsafePath = path.join(tmp, "unsafe-r977.json");
      await writeJson(unsafePath, {
        ...r977ProbeFixture({ ready: true }),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR992NshapFunctionCognitionScaffold({
        ...paths,
        r977ProbePath: unsafePath,
      })).rejects.toThrow("r977Probe boundary has unsafe boundary flag rowValuesStored");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r992-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { ready: true });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r992-nshap-function-cognition-scaffold.ts",
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R614_NSHAP_LABELS_PATH: paths.activationLabelsPath,
          MURPH_AGE_R977_NSHAP_PROBE_PATH: paths.r977ProbePath,
          MURPH_AGE_R991_MHAS_DIAGNOSTIC_PATH: paths.r991MhasDiagnosticPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r992-nshap-function-cognition-scaffold.latest.json",
        artifactVerdict: "no_score_scaffold_ready",
        blockedReason: null,
        packetId: "r992-nshap-function-cognition-scaffold",
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
        scaffoldStatus: "no_score_scaffold_only",
        schemaVersion: R992_NSHAP_FUNCTION_COGNITION_SCAFFOLD_SCHEMA_VERSION,
        scoringUnlocked: false,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { r977Ready?: boolean; ready: boolean },
): Promise<{
  activationLabelsPath: string;
  outputDir: string;
  r977ProbePath: string;
  r991MhasDiagnosticPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    activationLabelsPath: path.join(fixtureDir, "r614.json"),
    outputDir,
    r977ProbePath: path.join(fixtureDir, "r977.json"),
    r991MhasDiagnosticPath: path.join(fixtureDir, "r991.json"),
  };
  await Promise.all([
    writeJson(paths.activationLabelsPath, activationLabelsFixture(options.ready)),
    writeJson(paths.r977ProbePath, r977ProbeFixture({ ready: options.r977Ready ?? options.ready })),
    writeJson(paths.r991MhasDiagnosticPath, r991DiagnosticFixture()),
  ]);
  return paths;
}

function activationLabelsFixture(ready: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r614-nshap-activation-labels",
    rowExecutionReadiness: {
      blockingReasons: ready ? ["outcome_scoring_requires_separate_execution_gate"] : [
        "source_rights_or_aggregate_output_permission_unconfirmed",
      ],
      rowExecutionUnlocked: false,
      status: ready
        ? "metadata_ready_activation_labels_complete_no_scoring"
        : "blocked_source_rights_or_output_permission_unconfirmed",
    },
    schemaVersion: "murph-age-r614-nshap-activation-labels.v1",
    sourceRightsAndAggregateOutput: {
      aggregateOutputsActive: ready,
      labelsComplete: ready,
      requiredHumanLabels: ready ? [] : [
        "aggregate_output_permission_clear",
        "mortality_or_followup_endpoint_available",
      ],
    },
    status: "research-local-aggregate-only",
  };
}

function r977ProbeFixture(options: { ready: boolean }): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r977-nshap-next-activation-probe",
    rowExecutionGate: {
      blockingReasons: options.ready ? ["outcome_scoring_requires_separate_execution_gate"] : [
        "outcome_scoring_requires_separate_execution_gate",
      ],
      rowExecutionUnlocked: false,
      status: options.ready
        ? "metadata_ready_no_score_scaffold_only"
        : "blocked_source_rights_or_endpoint_labels",
    },
    schemaVersion: "murph-age-r977-nshap-next-activation-probe.v1",
    status: "research-local-aggregate-only",
    summary: {
      rowExecutionUnlocked: false,
    },
  };
}

function r991DiagnosticFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r991-mhas-deep-diagnostic-reducer",
    schemaVersion: "murph-age-r991-mhas-deep-diagnostic-reducer.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      verdict: "function_disability_survives_age_residualized_deep_diagnostic",
    },
  };
}

function safeBoundary(): Record<string, false | true> {
  return {
    aggregateOnly: true,
    archiveBasenamesStored: false,
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
