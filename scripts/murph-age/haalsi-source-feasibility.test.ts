import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  HAALSI_SOURCE_FEASIBILITY_SCHEMA_VERSION,
  runHaalsiSourceFeasibility,
} from "./haalsi-source-feasibility.ts";

describe("HAALSI source feasibility", () => {
  it("summarizes file, header, feature, and endpoint readiness without row-level output", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-haalsi-feasibility-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir);
      const { output, outputPath } = await runHaalsiSourceFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "model-runs"),
        sourceIntakeDir,
      });

      expect(path.basename(outputPath)).toBe("haalsi-source-feasibility.latest.json");
      expect(output.schemaVersion).toBe(HAALSI_SOURCE_FEASIBILITY_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-metadata-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        modelScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        rowParsingPerformed: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitIdentifiersStored: false,
        variableNameSamplesStored: false,
      });
      expect(output.fileCoverage).toEqual({
        haalsiLaneCountBand: "1-9",
        presentFileCountBand: "1-9",
        status: "present",
      });
      expect(output.headerCoverage).toEqual({
        datasetCountBand: "1-9",
        datasetsWithHeadersBand: "1-9",
        status: "present",
        totalHeaderCountBand: "1000+",
      });
      expect(output.featureFamilyCoverage.lab.status).toBe("present");
      expect(output.featureFamilyCoverage.vitals.status).toBe("present");
      expect(output.featureFamilyCoverage.anthropometric.status).toBe("present");
      expect(output.endpointReadiness).toMatchObject({
        readyForFutureOutcomeDesign: true,
        rowActivationRequiredBeforeExecution: true,
        status: "metadata_ready_activation_required_before_rows",
      });
      expect(output.laneAssessment).toMatchObject({
        classification: "feature_transport_lane",
        executableFutureOutcomeLane: false,
        featureTransportLane: true,
        noScoreActivationLane: false,
        nextAction: "fill_source_rights_and_activation_labels_before_row_execution",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("haalsi-sensitive-root");
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("HHID");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("coefficients\":");
      expect(persisted).not.toContain("modelParams");
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("sourceText");
      expect(persisted).not.toContain("5059");
      expect(persisted).not.toContain("21474836");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless metadata-only CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-haalsi-feasibility-cli-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir, { activationNeededBeforeParsingRows: false });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/haalsi-source-feasibility.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "model-runs"),
          MURPH_AGE_SOURCE_INTAKE_DIR: sourceIntakeDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "haalsi-source-feasibility.latest.json",
        endpointReadiness: "metadata_ready_for_future_outcome_design",
        fileCoverage: "present",
        headerCoverage: "present",
        laneClassification: "executable_future_outcome_lane",
        packetId: "haalsi-source-feasibility",
        productPromotionAuthorized: false,
        schemaVersion: HAALSI_SOURCE_FEASIBILITY_SCHEMA_VERSION,
        status: "research-local-metadata-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("sampleVariableNames");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps HAALSI in a no-score activation lane when source-intake metadata is incomplete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-haalsi-feasibility-missing-"));
    try {
      const { output } = await runHaalsiSourceFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        downloadInventoryPath: path.join(tmp, "missing-inventory.json"),
        headerPreflightPath: path.join(tmp, "missing-headers.json"),
        outputDir: path.join(tmp, "model-runs"),
      });

      expect(output.fileCoverage.status).toBe("absent");
      expect(output.headerCoverage.status).toBe("absent");
      expect(output.endpointReadiness.status).toBe("blocked_missing_file_or_header_coverage");
      expect(output.laneAssessment).toMatchObject({
        classification: "no-score_activation_lane",
        nextAction: "complete_haalsi_source_intake_metadata",
      });
      expect(output.boundary.rowParsingPerformed).toBe(false);
      expect(output.boundary.modelScoringPerformed).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not mark the lane executable without mortality or follow-up endpoint metadata", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-haalsi-feasibility-endpoint-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir, { mortalityOrFollowup: 0 });
      const { output } = await runHaalsiSourceFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "model-runs"),
        sourceIntakeDir,
      });

      expect(output.endpointReadiness).toMatchObject({
        readyForFutureOutcomeDesign: false,
        status: "blocked_missing_mortality_or_followup_header_coverage",
      });
      expect(output.laneAssessment.classification).toBe("feature_transport_lane");
      expect(output.laneAssessment.executableFutureOutcomeLane).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when header preflight boundary metadata is missing or unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-haalsi-feasibility-boundary-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir);
      await writeJson(path.join(sourceIntakeDir, "haalsi-header-preflight.latest.json"), {
        ...headerPreflightFixture({}),
        boundary: {
          ...headerPreflightFixture({}).boundary,
          codebookProseStored: true,
        },
      });

      await expect(runHaalsiSourceFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "model-runs"),
        sourceIntakeDir,
      })).rejects.toThrow("unsafe boundary flag codebookProseStored");

      await writeJson(path.join(sourceIntakeDir, "haalsi-header-preflight.latest.json"), {
        ...headerPreflightFixture({}),
        boundary: undefined,
      });

      await expect(runHaalsiSourceFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "model-runs"),
        sourceIntakeDir,
      })).rejects.toThrow("HAALSI header boundary must be an object");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  sourceIntakeDir: string,
  options: { activationNeededBeforeParsingRows?: boolean; mortalityOrFollowup?: number } = {},
): Promise<void> {
  await mkdir(sourceIntakeDir, { recursive: true });
  await Promise.all([
    writeJson(path.join(sourceIntakeDir, "download-inventory.latest.json"), downloadInventoryFixture(options)),
    writeJson(path.join(sourceIntakeDir, "haalsi-header-preflight.latest.json"), headerPreflightFixture(options)),
  ]);
}

function downloadInventoryFixture(options: { activationNeededBeforeParsingRows?: boolean }) {
  return {
    activationNeededBeforeParsingRows: options.activationNeededBeforeParsingRows ?? true,
    lanes: [
      {
        activationStatus: "metadata-only-not-activated",
        files: ["/haalsi-sensitive-root/haalsi-public-release.dta"],
        lane: "haalsi-public",
        presentFileCount: 1,
        roles: ["aging-cohort"],
      },
    ],
    modelScoringPerformed: false,
    participantIdentifiersStored: false,
    rowParsing: "metadata-only",
    rowValuesStored: false,
    schemaVersion: "murph-age-source-download-inventory.v1",
    sourceBodiesStored: false,
    storedPathPolicy: "base-file-names-only",
  };
}

function headerPreflightFixture(options: { mortalityOrFollowup?: number }) {
  const mortalityOrFollowup = options.mortalityOrFollowup ?? 3;
  return {
    boundary: {
      abstractsStored: false,
      codebookProseStored: false,
      codebookTextStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
      variableLabelsStored: false,
    },
    datasets: [
      {
        categorySignals: {
          anthropometric_or_vitals: signal(22, ["HEIGHT", "WEIGHT", "SYSTOLIC"]),
          biomarker_or_lab: signal(12, ["GLUCOSE", "CRP"]),
          mortality_or_followup: signal(mortalityOrFollowup, mortalityOrFollowup > 0 ? ["VITAL_STATUS"] : []),
          self_rated_or_disease_history: signal(8, ["DIABETES"]),
        },
        columnCount: 1260,
        dataset: "haalsi-main",
        fileName: "/haalsi-sensitive-root/haalsi-public-release.dta",
        rowCount: 5059,
      },
    ],
    preflightConclusion: "metadata-only-source-candidate",
    schemaVersion: "murph-age-source-header-preflight.v1",
    source: "HAALSI local fixture",
  };
}

function signal(matchCount: number, sampleVariableNames: string[]) {
  return { matchCount, sampleVariableNames };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
