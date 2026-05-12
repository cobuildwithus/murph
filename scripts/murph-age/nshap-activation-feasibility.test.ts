import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  NSHAP_ACTIVATION_FEASIBILITY_SCHEMA_VERSION,
  runNshapActivationFeasibility,
} from "./nshap-activation-feasibility.ts";

describe("NSHAP activation feasibility", () => {
  it("summarizes NSHAP file, header, feature, and endpoint readiness without row-level output", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-nshap-feasibility-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir);
      const { output, outputPath } = await runNshapActivationFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "model-runs"),
        sourceIntakeDir,
      });

      expect(path.basename(outputPath)).toBe("nshap-activation-feasibility.latest.json");
      expect(output.schemaVersion).toBe(NSHAP_ACTIVATION_FEASIBILITY_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-metadata-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        activationMetadataOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        modelScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        rowParsingPerformed: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
        variableNameSamplesStored: false,
      });
      expect(output.fileCoverage).toEqual({
        allExpectedArchivesPresent: true,
        archiveBasenames: ["ICPSR_20541-V10.zip", "ICPSR_34921-V5.zip", "ICPSR_36873-V9.zip"],
        expectedArchiveCount: 3,
        presentArchiveCount: 3,
        status: "present",
      });
      expect(output.headerCoverage).toEqual({
        datasetCount: 4,
        datasetCountBand: "1-9",
        datasetsWithHeaders: 4,
        status: "present",
        totalHeaderCountBand: "1000+",
      });
      expect(output.featureFamilies.biomarkerOrLab.present).toBe(true);
      expect(output.featureFamilies.anthropometricOrVitals.present).toBe(true);
      expect(output.featureFamilies.socialOrNetwork.present).toBe(true);
      expect(output.endpointReadiness.status).toBe("metadata_ready_activation_required_before_rows");
      expect(output.noScoreReadiness.conclusion).toBe("nshap_metadata_ready_for_activation_design");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("CASEID");
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("coefficients\":");
      expect(persisted).not.toContain("abstractText");
      expect(persisted).not.toContain("codebookProse");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-nshap-feasibility-cli-"));
    try {
      const sourceIntakeDir = path.join(tmp, "source-intake");
      await writeFixtureArtifacts(sourceIntakeDir);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/nshap-activation-feasibility.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "model-runs"),
          MURPH_AGE_SOURCE_INTAKE_DIR: sourceIntakeDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "nshap-activation-feasibility.latest.json",
        conclusion: "nshap_metadata_ready_for_activation_design",
        endpointReadiness: "metadata_ready_activation_required_before_rows",
        fileCoverage: "present",
        headerCoverage: "present",
        packetId: "nshap-activation-feasibility",
        productPromotionAuthorized: false,
        schemaVersion: NSHAP_ACTIVATION_FEASIBILITY_SCHEMA_VERSION,
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

  it("reports incomplete metadata without inventing row or score facts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-nshap-feasibility-missing-"));
    try {
      const { output } = await runNshapActivationFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        downloadInventoryPath: path.join(tmp, "missing-inventory.json"),
        headerPreflightPath: path.join(tmp, "missing-headers.json"),
        outputDir: path.join(tmp, "model-runs"),
      });

      expect(output.fileCoverage.status).toBe("absent");
      expect(output.headerCoverage.status).toBe("absent");
      expect(output.endpointReadiness.status).toBe("blocked_missing_files_or_headers");
      expect(output.noScoreReadiness.conclusion).toBe("nshap_metadata_incomplete");
      expect(output.boundary.rowParsingPerformed).toBe(false);
      expect(output.boundary.modelScoringPerformed).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(sourceIntakeDir: string): Promise<void> {
  await mkdir(sourceIntakeDir, { recursive: true });
  await Promise.all([
    writeJson(path.join(sourceIntakeDir, "download-inventory.latest.json"), {
      activationNeededBeforeParsingRows: true,
      lanes: [
        {
          activationStatus: "metadata-only-not-activated",
          files: ["ICPSR_20541-V10.zip"],
          lane: "nshap-round-1",
          presentFileCount: 1,
          roles: ["aging-cohort"],
        },
        {
          activationStatus: "metadata-only-not-activated",
          files: ["ICPSR_34921-V5.zip"],
          lane: "nshap-round-2",
          presentFileCount: 1,
          roles: ["aging-cohort"],
        },
        {
          activationStatus: "metadata-only-not-activated",
          files: ["ICPSR_36873-V9.zip"],
          lane: "nshap-round-3-covid",
          presentFileCount: 1,
          roles: ["aging-cohort"],
        },
      ],
      modelScoringPerformed: false,
      participantIdentifiersStored: false,
      rowParsing: "metadata-only",
      rowValuesStored: false,
      schemaVersion: "fixture",
      sourceBodiesStored: false,
      storedPathPolicy: "basename-only",
    }),
    writeJson(path.join(sourceIntakeDir, "nshap-header-preflight.latest.json"), {
      boundary: {
        codebookTextStored: false,
        localPathsStored: false,
        participantIdentifiersStored: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
        variableLabelsStored: false,
      },
      createdAt: "2026-05-12T00:00:00.000Z",
      datasets: [
        fixtureDataset({
          biomarker: 12,
          columns: 860,
          dataset: "nshap_round2:DS0001",
          fileName: "ICPSR_34921-V5.zip/DS0001/34921-0001-Data.tsv",
          followup: 0,
          socialSamples: ["SEXIMPRT", "THINKSEX"],
          vitals: 21,
        }),
        fixtureDataset({
          biomarker: 0,
          columns: 20,
          dataset: "nshap_round2:DS0005",
          fileName: "ICPSR_34921-V5.zip/DS0005/34921-0005-Data.tsv",
          followup: 0,
          socialSamples: ["NODE_GENDER", "NODE_AGE"],
          vitals: 0,
        }),
        fixtureDataset({
          biomarker: 0,
          columns: 19,
          dataset: "nshap_round2:DS0012",
          fileName: "ICPSR_34921-V5.zip/DS0012/34921-0012-Data.tsv",
          followup: 2,
          socialSamples: [],
          vitals: 0,
        }),
        fixtureDataset({
          biomarker: 10,
          columns: 725,
          dataset: "nshap_round3_covid:DS0001",
          fileName: "ICPSR_36873-V9.zip/DS0001/36873-0001-Data.tsv",
          followup: 1,
          socialSamples: ["ENGAGE_1"],
          vitals: 17,
        }),
      ],
      preflightConclusion: "metadata-only",
      schemaVersion: "fixture",
      source: "NSHAP",
    }),
  ]);
}

function fixtureDataset(input: {
  biomarker: number;
  columns: number;
  dataset: string;
  fileName: string;
  followup: number;
  socialSamples: string[];
  vitals: number;
}) {
  return {
    categorySignals: {
      activity_or_function: signal(1, []),
      anthropometric_or_vitals: signal(input.vitals, []),
      biomarker_or_lab: signal(input.biomarker, []),
      cognition: signal(0, []),
      mortality_or_followup: signal(input.followup, []),
      sleep_or_recovery: signal(2, []),
      social_or_network: signal(input.socialSamples.length, input.socialSamples),
      self_rated_or_disease_history: signal(3, []),
    },
    columnCount: input.columns,
    dataset: input.dataset,
    fileName: input.fileName,
    rowCount: 3000,
  };
}

function signal(matchCount: number, sampleVariableNames: string[]) {
  return { matchCount, sampleVariableNames };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
