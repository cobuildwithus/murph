import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R976_EXTERNAL_GENERALIZATION_EVALUATOR_SCHEMA_VERSION,
  runR976ExternalGeneralizationEvaluator,
} from "./r976-external-generalization-evaluator.ts";

describe("R976 external generalization evaluator", () => {
  it("writes deterministic aggregate-only evaluator slots without row, variable, or model-parameter leakage", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r976-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR976ExternalGeneralizationEvaluator({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r976-external-generalization-evaluator.latest.json");
      expect(output.schemaVersion).toBe(R976_EXTERNAL_GENERALIZATION_EVALUATOR_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.evaluatorMode).toMatchObject({
        actualMetricComputationByR976: false,
        metricSlotPolicy: "copy_precomputed_aggregate_metrics_or_mark_missing",
      });
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        calibrationParametersStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        metricComputationPerformedByR976: false,
        modelParametersStored: false,
        outcomeScoringPerformedByR976: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformedByR976: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
        variableListsStored: false,
        variableNamesStored: false,
      });
      expect(output.sourceAgeSexReference).toMatchObject({
        referenceId: "age_sex_reference",
        status: "available",
      });
      expect(output.sourceAgeSexReference.metricSlots.test).toMatchObject({
        countBands: {
          eventCount: "100-499",
          rows: "1000-4999",
        },
        status: "available_from_aggregate_artifact",
        values: {
          auc: 0.731,
          brier: 0.121,
          logLoss: 0.402,
        },
      });
      expect(output.transportedCandidateFamilies.map((candidate) => [
        candidate.candidateFamilyId,
        candidate.candidateRole,
        candidate.calibrationPolicy,
        candidate.metricSlots.test?.status,
      ])).toEqual([
        ["creles_age_sex_reference", "target_reference", "creles-calibration-age-sex-reference", "available_from_aggregate_artifact"],
        ["midus2_lab5_source_creles_recalibrated", "target_calibrated_source_model", "creles-calibration-intercept-slope", "available_from_aggregate_artifact"],
        ["midus2_lab5_source_raw", "source_model", "none", "available_from_aggregate_artifact"],
      ]);
      expect(output.sourceCalibratedDiagnostic).toMatchObject({
        calibrationParametersStored: false,
        calibrationPolicy: "creles-calibration-intercept-slope",
        comparisonVsAgeSexReference: {
          aucDelta: 0.012,
          brierDelta: -0.004,
          logLossDelta: -0.01,
          status: "available_from_aggregate_artifact",
        },
        diagnosticId: "midus2_lab5_source_creles_recalibrated",
        status: "available",
      });
      expect(output.sourceCalibratedDiagnostic.metricSlots.calibration).toMatchObject({
        countBands: {
          eventCount: "10-49",
          rows: "500-999",
        },
        status: "available_from_aggregate_artifact",
      });
      expect(output.missingnessAndAbstention).toEqual({
        abstentionCountBand: "100-499",
        completeCaseRowsBand: "1000-4999",
        excludedFollowupRowsBand: "50-99",
        knownStatusRowsBand: "1000-4999",
        missingFeatureExcludedRowsBand: "100-499",
        policy: "bands_only_small_cells_suppressed",
      });
      expect(output.summary).toEqual({
        conclusion: "external_generalization_slots_ready",
        metricBearingCandidateFamilyCountBand: "1-4",
        nextAction: "review_aggregate_external_generalization_slots",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("featureKeys");
      expect(persisted).not.toContain("sourceFeatureMappingPolicy");
      expect(persisted).not.toContain("transportStressMatrix");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("source body");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("suppresses metric slots when aggregate support would expose small cells", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r976-small-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        sourceReferenceTestEvents: 6,
      });
      const { output } = await runR976ExternalGeneralizationEvaluator({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(output.sourceAgeSexReference.metricSlots.test).toEqual({
        countBands: {
          eventCount: "suppressed_under_10",
          rows: "1000-4999",
        },
        metricSource: "not_computed_by_r976",
        status: "suppressed_small_cell",
        values: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed for unsafe aggregate input boundaries and keeps the CLI summary pathless", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r976-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeTransportPath = path.join(tmp, "unsafe-transport.json");
      await writeJson(unsafeTransportPath, {
        ...transportFixture(),
        rowValuesStored: true,
      });

      await expect(runR976ExternalGeneralizationEvaluator({
        ...paths,
        transportBenchmarkPath: unsafeTransportPath,
      })).rejects.toThrow("transportBenchmark failed aggregate-egress validation");

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r976-external-generalization-evaluator.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R976_ACTIVATION_MATRIX_PATH: paths.activationMatrixPath,
          MURPH_AGE_R976_SOURCE_BENCHMARK_PATH: paths.sourceLocalBenchmarkPath,
          MURPH_AGE_R976_TRANSPORT_BENCHMARK_PATH: paths.transportBenchmarkPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r976-external-generalization-evaluator.latest.json",
        conclusion: "external_generalization_slots_ready",
        metricBearingCandidateFamilyCountBand: "1-4",
        nextAction: "review_aggregate_external_generalization_slots",
        packetId: "r976-external-generalization-evaluator",
        productDisplayAuthorized: false,
        schemaVersion: R976_EXTERNAL_GENERALIZATION_EVALUATOR_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("featureKeys");
      expect(stdout).not.toContain("\"coefficients\":");
      expect(stdout).not.toContain("\"predictions\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { sourceReferenceTestEvents?: number } = {},
): Promise<{
  activationMatrixPath: string;
  outputDir: string;
  sourceLocalBenchmarkPath: string;
  transportBenchmarkPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const paths = {
    activationMatrixPath: path.join(fixtureDir, "r615.json"),
    outputDir,
    sourceLocalBenchmarkPath: path.join(fixtureDir, "source.json"),
    transportBenchmarkPath: path.join(fixtureDir, "transport.json"),
  };

  await writeJson(paths.activationMatrixPath, {
    artifactBoundary: safeBoundary(),
    packetId: "r615-cross-source-activation-matrix",
    schemaVersion: "murph-age-r615-cross-source-activation-matrix.v1",
    status: "research-local-aggregate-only",
  });
  await writeJson(paths.sourceLocalBenchmarkPath, sourceFixture(options));
  await writeJson(paths.transportBenchmarkPath, transportFixture());

  return paths;
}

function sourceFixture(options: { sourceReferenceTestEvents?: number } = {}): Record<string, unknown> {
  return {
    benchmarkId: "creles-mortality-status-local-0",
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    models: {
      age_sex_reference: {
        candidateRole: "reference",
        featureKeys: ["age", "sex"],
        predictionsStored: false,
        splitMetrics: {
          calibration: metric({ auc: 0.725, brier: 0.124, events: 40, logLoss: 0.411, meanPrediction: 0.121, n: 700, observedRate: 0.12 }),
          test: metric({
            auc: 0.731,
            brier: 0.121,
            events: options.sourceReferenceTestEvents ?? 220,
            logLoss: 0.402,
            meanPrediction: 0.119,
            n: 2200,
            observedRate: 0.118,
          }),
        },
      },
    },
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: "murph-age-creles-local-benchmark.v1",
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };
}

function transportFixture(): Record<string, unknown> {
  return {
    benchmarkCard: {
      sourceFeatureMappingPolicy: {
        allowedFeatureFamilies: ["demographics", "body"],
      },
      transportStressMatrix: {
        featureOverlap: "fixture-only variable-list marker that must not be emitted by R976",
      },
    },
    benchmarkId: "midus2-lab5-to-creles-wave3-transport-local-0",
    calibrationParametersStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    endpointComparison: {
      productPromotionAuthorized: false,
    },
    localPathsStored: false,
    modelParametersStored: false,
    modelScoringPerformed: true,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: "murph-age-midus2-creles-transport-benchmark.v1",
    sourceBodiesStored: false,
    sourceModel: {
      coefficientsStored: false,
      featureKeys: ["age", "sex", "fixture-variable-list-marker"],
      localArtifactPathStored: false,
      modelParametersStored: false,
    },
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
    targetDataShape: {
      completeCaseRows: 1800,
      events: 190,
      excludedFollowupRows: 80,
      knownStatusRows: 2000,
      missingFeatureExcludedRows: 200,
      splitCounts: {
        calibration: { events: 45, n: 760 },
        test: { events: 145, n: 1040 },
      },
    },
    transportModels: {
      creles_age_sex_reference: transportModel({
        auc: 0.74,
        brier: 0.12,
        calibrationPolicy: "creles-calibration-age-sex-reference",
        candidateRole: "target_reference",
        logLoss: 0.4,
      }),
      midus2_lab5_source_creles_recalibrated: transportModel({
        auc: 0.752,
        brier: 0.116,
        calibrationPolicy: "creles-calibration-intercept-slope",
        candidateRole: "target_calibrated_source_model",
        logLoss: 0.39,
      }),
      midus2_lab5_source_raw: transportModel({
        auc: 0.735,
        brier: 0.124,
        calibrationPolicy: "none",
        candidateRole: "source_model",
        logLoss: 0.415,
      }),
    },
  };
}

function transportModel(input: {
  auc: number;
  brier: number;
  calibrationPolicy: string;
  candidateRole: string;
  logLoss: number;
}): Record<string, unknown> {
  return {
    calibrationParametersStored: false,
    calibrationPolicy: input.calibrationPolicy,
    candidateRole: input.candidateRole,
    coefficientsStored: false,
    featureKeys: ["fixture-variable-list-marker"],
    predictionsStored: false,
    splitMetrics: {
      calibration: metric({
        auc: input.auc - 0.01,
        brier: input.brier + 0.002,
        events: 45,
        logLoss: input.logLoss + 0.01,
        meanPrediction: 0.118,
        n: 760,
        observedRate: 0.119,
      }),
      test: metric({
        auc: input.auc,
        brier: input.brier,
        events: 145,
        logLoss: input.logLoss,
        meanPrediction: 0.12,
        n: 1040,
        observedRate: 0.121,
      }),
    },
  };
}

function metric(input: {
  auc: number;
  brier: number;
  events: number;
  logLoss: number;
  meanPrediction: number;
  n: number;
  observedRate: number;
}): Record<string, number> {
  return { ...input };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
