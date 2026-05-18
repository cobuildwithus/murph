import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runSageSourceFeasibility,
  SAGE_SOURCE_FEASIBILITY_SCHEMA_VERSION,
} from "./sage-source-feasibility.ts";

describe("SAGE source feasibility", () => {
  it("summarizes SAGE source fit without unlocking scoring", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-sage-feasibility-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir);
      const { output, outputPath } = await runSageSourceFeasibility({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "model-runs"),
        sourceIntakeDir,
      });

      expect(path.basename(outputPath)).toBe("sage-source-feasibility.latest.json");
      expect(output.schemaVersion).toBe(SAGE_SOURCE_FEASIBILITY_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-metadata-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        modelScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformed: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
        variableNameSamplesStored: false,
      });
      expect(output.fileCoverage).toEqual({
        presentFileCountBand: "1-9",
        sageLaneCountBand: "1-9",
        status: "present",
      });
      expect(output.headerCoverage).toEqual({
        datasetCountBand: "1-9",
        datasetsWithHeadersBand: "1-9",
        status: "present",
        totalHeaderCountBand: "1000+",
      });
      expect(output.endpointJoinReadiness).toMatchObject({
        individualFeatureCoveragePresent: true,
        joinContractLocked: false,
        rowActivationRequiredBeforeExecution: true,
        status: "blocked_join_contract_and_activation_labels",
      });
      expect(output.laneAssessment).toEqual({
        classification: "source_fit_context_lane",
        nextAction: "draft_sage_terms_endpoint_join_feasibility_card",
        rationaleLabels: [
          "endpoint_header_signal_present",
          "individual_feature_header_signal_present",
          "join_contract_not_locked",
          "terms_activation_required",
        ],
        scoreBearingNow: false,
      });
      expect(output.featureFamilyCoverage.activityFunction.status).toBe("partial");
      expect(output.featureFamilyCoverage.biomarkerLab.status).toBe("partial");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("q0406");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("coefficients\":");
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("sourceText");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps SAGE metadata-only when endpoint overlap is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-sage-feasibility-endpoint-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir, { mortalityOrFollowup: 0 });
      const { output } = await runSageSourceFeasibility({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "model-runs"),
        sourceIntakeDir,
      });

      expect(output.endpointJoinReadiness.status).toBe("blocked_missing_endpoint_or_feature_coverage");
      expect(output.laneAssessment).toMatchObject({
        classification: "source_fit_context_lane",
        scoreBearingNow: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless metadata-only CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-sage-feasibility-cli-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/sage-source-feasibility.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "model-runs"),
          MURPH_AGE_SOURCE_INTAKE_DIR: sourceIntakeDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "sage-source-feasibility.latest.json",
        endpointJoinReadiness: "blocked_join_contract_and_activation_labels",
        fileCoverage: "present",
        headerCoverage: "present",
        laneClassification: "source_fit_context_lane",
        packetId: "sage-source-feasibility",
        productPromotionAuthorized: false,
        schemaVersion: SAGE_SOURCE_FEASIBILITY_SCHEMA_VERSION,
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

  it("fails closed when source-intake boundary metadata is unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-sage-feasibility-boundary-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir);
      const unsafeHeader = headerPreflightFixture({});
      const unsafeBoundary = unsafeHeader.boundary;
      if (!unsafeBoundary || typeof unsafeBoundary !== "object" || Array.isArray(unsafeBoundary)) {
        throw new Error("SAGE fixture boundary must be an object.");
      }
      await writeJson(path.join(sourceIntakeDir, "sage-south-africa-header-preflight.latest.json"), {
        ...unsafeHeader,
        boundary: {
          ...unsafeBoundary,
          codebookTextStored: true,
        },
      });

      await expect(runSageSourceFeasibility({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "model-runs"),
        sourceIntakeDir,
      })).rejects.toThrow("unsafe boundary flag codebookTextStored");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  sourceIntakeDir: string,
  options: { mortalityOrFollowup?: number } = {},
): Promise<void> {
  await mkdir(sourceIntakeDir, { recursive: true });
  await Promise.all([
    writeJson(path.join(sourceIntakeDir, "download-inventory.latest.json"), downloadInventoryFixture()),
    writeJson(path.join(sourceIntakeDir, "sage-south-africa-header-preflight.latest.json"), headerPreflightFixture(options)),
  ]);
}

function downloadInventoryFixture(): Record<string, unknown> {
  return {
    activationNeededBeforeParsingRows: true,
    lanes: [
      {
        activationStatus: "metadata-only-not-activated",
        files: ["/sage-sensitive-root/SouthAfricaINDData.dta"],
        lane: "sage-south-africa",
        presentFileCount: 4,
        roles: ["individual", "household", "household-members"],
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

function headerPreflightFixture(options: { mortalityOrFollowup?: number }): Record<string, unknown> {
  const mortalityOrFollowup = options.mortalityOrFollowup ?? 6;
  return {
    boundary: {
      codebookProseStored: false,
      codebookTextStored: false,
      localPathsStored: false,
      participantIdentifiersStored: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      variableLabelsStored: false,
    },
    datasets: [
      datasetFixture("household", 4020, 586, {
        age_or_demographics: 113,
        mortality_or_followup: mortalityOrFollowup,
      }),
      datasetFixture("individual", 4227, 1685, {
        activity_or_function: 124,
        anthropometric_or_vitals: 30,
        biomarker_or_lab: 3,
        sleep_or_recovery: 22,
      }),
    ],
    schemaVersion: "murph-age-source-header-preflight.v1",
    status: "research-local-metadata-only",
  };
}

function datasetFixture(
  dataset: string,
  rowCount: number,
  columnCount: number,
  counts: Record<string, number>,
): Record<string, unknown> {
  return {
    categorySignals: Object.fromEntries(Object.entries(counts).map(([key, matchCount]) => [
      key,
      {
        matchCount,
        sampleVariableNames: matchCount > 0 ? ["q0406"] : [],
      },
    ])),
    columnCount,
    dataset,
    rowCount,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
