import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  MHAS_SOURCE_FEASIBILITY_SCHEMA_VERSION,
  runMhasSourceFeasibility,
} from "./mhas-source-feasibility.ts";

describe("MHAS source feasibility", () => {
  it("summarizes harmonized and end-of-life metadata without row-level egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-mhas-feasibility-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runMhasSourceFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("mhas-source-feasibility.latest.json");
      expect(output.schemaVersion).toBe(MHAS_SOURCE_FEASIBILITY_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-metadata-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelScoringPerformed: false,
        participantIdentifiersStored: false,
        participantIdentifiersWritten: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformed: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
        variableLabelsStored: false,
      });
      expect(output.coverage.requiredDatasetsPresent).toBe(true);
      expect(output.coverage.datasets.map((dataset) => dataset.dataset)).toEqual(["mhas_eol", "mhas_harmonized"]);
      expect(output.coverage.datasets.find((dataset) => dataset.dataset === "mhas_harmonized")).toMatchObject({
        columnCountBand: "1000+",
        fileName: "H_MHAS_d.dta",
        rowCountBand: "1000+",
      });
      expect(output.coverage.broadFeatureFamilies.activity_or_function).toEqual({
        datasetsWithCoverage: ["mhas_eol", "mhas_harmonized"],
        status: "available",
      });
      expect(output.coverage.broadFeatureFamilies.mortality_or_eol.status).toBe("available");
      expect(output.joinReadiness).toEqual({
        blockerReasons: [],
        eolFilePresent: true,
        harmonizedFilePresent: true,
        mortalityOrEolHeaderCoverage: "available",
        status: "metadata_join_probe_ready",
      });
      expect(output.transportLoopEligibility).toMatchObject({
        eligible: true,
        nextGate: "declare_mortality_join_contract_before_scoring",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("redacted-source-root");
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("coefficients\":");
      expect(persisted).not.toContain("rowRecords");
      expect(persisted).not.toContain("sourceText");
      expect(persisted).not.toContain("27159");
      expect(persisted).not.toContain("225274725");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless metadata-only CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-mhas-feasibility-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/mhas-source-feasibility.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOAD_INVENTORY_PATH: paths.downloadInventoryPath,
          MURPH_AGE_MHAS_HEADER_PREFLIGHT_PATH: paths.headerPreflightPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({
        artifact: "mhas-source-feasibility.latest.json",
        eligibleForTransportLoop: true,
        joinReadiness: "metadata_join_probe_ready",
        modelScoringPerformed: false,
        packetId: "mhas-harmonized-eol-source-feasibility",
        productPromotionAuthorized: false,
        schemaVersion: MHAS_SOURCE_FEASIBILITY_SCHEMA_VERSION,
        status: "research-local-metadata-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("predictions");
      expect(stdout).not.toContain("coefficients");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks eligibility when the end-of-life lane is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-mhas-feasibility-missing-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { omitEolLane: true });
      const { output } = await runMhasSourceFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.joinReadiness.status).toBe("not_ready");
      expect(output.joinReadiness.blockerReasons).toEqual(["missing_eol_inventory_file"]);
      expect(output.transportLoopEligibility).toMatchObject({
        eligible: false,
        nextGate: "collect_required_metadata_first",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("requires mortality/EOL header coverage on the end-of-life dataset", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-mhas-feasibility-eol-coverage-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { eolMortalityMatchCount: 0 });
      const { output } = await runMhasSourceFeasibility({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.coverage.broadFeatureFamilies.mortality_or_eol.status).toBe("available");
      expect(output.joinReadiness).toMatchObject({
        mortalityOrEolHeaderCoverage: "absent",
        status: "not_ready",
      });
      expect(output.joinReadiness.blockerReasons).toEqual(["missing_mortality_or_eol_header_signal"]);
      expect(output.transportLoopEligibility.eligible).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { eolMortalityMatchCount?: number; omitEolLane?: boolean } = {},
): Promise<{ downloadInventoryPath: string; headerPreflightPath: string }> {
  await mkdir(tmp, { recursive: true });
  const headerPreflightPath = path.join(tmp, "mhas-header-preflight.latest.json");
  const downloadInventoryPath = path.join(tmp, "download-inventory.latest.json");
  await Promise.all([
    writeJson(headerPreflightPath, headerPreflightArtifact(options)),
    writeJson(downloadInventoryPath, downloadInventoryArtifact(options)),
  ]);
  return { downloadInventoryPath, headerPreflightPath };
}

function headerPreflightArtifact(options: { eolMortalityMatchCount?: number } = {}) {
  const eolMortalityMatchCount = options.eolMortalityMatchCount ?? 2;
  return {
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
      {
        categorySignals: {
          activity_or_function: { matchCount: 336, sampleVariableNames: ["redacted-test-header"] },
          age_or_demographics: { matchCount: 141, sampleVariableNames: ["redacted-test-header"] },
          anthropometric_or_vitals: { matchCount: 142, sampleVariableNames: ["redacted-test-header"] },
          biomarker_or_lab: { matchCount: 12, sampleVariableNames: ["redacted-test-header"] },
          cognition: { matchCount: 20, sampleVariableNames: ["redacted-test-header"] },
          mortality_or_eol: { matchCount: 49, sampleVariableNames: ["redacted-test-header"] },
          self_rated_or_disease_history: { matchCount: 66, sampleVariableNames: ["redacted-test-header"] },
          sleep_or_recovery: { matchCount: 40, sampleVariableNames: ["redacted-test-header"] },
        },
        columnCount: 6542,
        dataset: "mhas_harmonized",
        fileName: "C:\\redacted-source-root\\H_MHAS_d.dta",
        rowCount: 27159,
      },
      {
        categorySignals: {
          activity_or_function: { matchCount: 1, sampleVariableNames: ["redacted-test-header"] },
          age_or_demographics: { matchCount: 7, sampleVariableNames: ["redacted-test-header"] },
          anthropometric_or_vitals: { matchCount: 3, sampleVariableNames: ["redacted-test-header"] },
          biomarker_or_lab: { matchCount: 0, sampleVariableNames: [] },
          cognition: { matchCount: 0, sampleVariableNames: [] },
          mortality_or_eol: { matchCount: eolMortalityMatchCount, sampleVariableNames: eolMortalityMatchCount > 0 ? ["redacted-test-header"] : [] },
          self_rated_or_disease_history: { matchCount: 6, sampleVariableNames: ["redacted-test-header"] },
          sleep_or_recovery: { matchCount: 0, sampleVariableNames: [] },
        },
        columnCount: 264,
        dataset: "mhas_eol",
        fileName: "C:\\redacted-source-root\\GH_MHAS_EOL_c.dta",
        rowCount: 7418,
      },
    ],
    preflightConclusion: "metadata-only",
    schemaVersion: "murph-age-source-header-preflight.v1",
    source: "Gateway Harmonized MHAS local download",
  };
}

function downloadInventoryArtifact(options: { omitEolLane?: boolean }) {
  const lanes = [
    {
      activationStatus: "metadata-only-not-activated",
      files: ["C:\\redacted-source-root\\H_MHAS_d.dta"],
      lane: "mhas-harmonized",
      presentFileCount: 1,
      roles: ["harmonized-panel"],
    },
  ];
  const files = [
    {
      file: "C:\\redacted-source-root\\H_MHAS_d.dta",
      lane: "mhas-harmonized",
      present: true,
      role: "harmonized-panel",
      sha256: "redacted-test-digest",
      sizeBytes: 225274725,
    },
  ];
  if (!options.omitEolLane) {
      lanes.push({
        activationStatus: "metadata-only-not-activated",
      files: ["C:\\redacted-source-root\\GH_MHAS_EOL_c.dta"],
      lane: "mhas-end-of-life",
      presentFileCount: 1,
      roles: ["mortality-eol"],
    });
    files.push({
      file: "C:\\redacted-source-root\\GH_MHAS_EOL_c.dta",
      lane: "mhas-end-of-life",
      present: true,
      role: "mortality-eol",
      sha256: "redacted-test-digest",
      sizeBytes: 3219400,
    });
  }
  return {
    activationNeededBeforeParsingRows: true,
    createdAt: "2026-05-12T00:00:00.000Z",
    files,
    lanes,
    modelScoringPerformed: false,
    participantIdentifiersStored: false,
    recommendedNearTermOrder: ["mhas"],
    rowParsing: "not-performed",
    rowValuesStored: false,
    schemaVersion: "murph-age-source-download-inventory.v1",
    sourceBodiesStored: false,
    storedPathPolicy: "base-file-names-only",
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
