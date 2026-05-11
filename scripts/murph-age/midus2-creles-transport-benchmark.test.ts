import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  MIDUS2_CRELES_TRANSPORT_BENCHMARK_SCHEMA_VERSION,
  runMidus2CrelesTransportBenchmark,
} from "./midus2-creles-transport-benchmark.ts";

const FORBIDDEN_OUTPUT_SENTINELS = [
  "M0001",
  "C0001",
  "M2ID",
  "IDSUJETO",
  "TRACK_W3",
  "DOD_Y",
  "PCR",
  "hscrp",
  "c-reactive",
  "coefficients\":",
  "predictions\":",
] as const;

describe("MIDUS 2 to CRELES transport benchmark runner", () => {
  it("scores the MIDUS source model on CRELES and writes aggregate-only transport metrics", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-midus-creles-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const modelCardOutputDir = path.join(tmp, "model-cards");
      const outputDir = path.join(tmp, "runtime");
      const midusOutputDir = path.join(tmp, "midus-runtime");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidus2Downloads(downloadsDir);
      await writeSyntheticCrelesDownloads(downloadsDir);

      const { output, outputPath } = await runMidus2CrelesTransportBenchmark({
        createdAt: "2026-05-12T00:00:00.000Z",
        downloadsDir,
        midusOutputDir,
        modelCardOutputDir,
        outputDir,
      });

      expect(output.schemaVersion).toBe(MIDUS2_CRELES_TRANSPORT_BENCHMARK_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.benchmarkId).toBe("midus2-lab5-to-creles-wave3-transport-local-0");
      expect(output.benchmarkCard).toMatchObject({
        allowedMetrics: ["auc", "brier", "logLoss", "meanPrediction", "observedRate"],
        benchmarkCardId: "midus2-lab5-creles-transport-card-0",
        evidenceClassLabel: "cross-cohort transport diagnostic",
        exposureLabel: "diagnostic-only",
        minimumCellThreshold: 10,
        schemaVersion: "murph-age-benchmark-card.v1",
        sourceEndpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
        targetEndpoint: "death by CRELES wave 3 among participants with known wave-3 status",
      });
      expect(output.benchmarkCard.sourceFeatureMappingPolicy).toEqual({
        allowedFeatureFamilies: ["demographics", "body", "glycemia", "lipids"],
        blockedFeatureFamilies: ["crp", "hs-crp", "inflammation-assay-family"],
      });
      expect(output.endpointComparison).toEqual({
        mismatchPolicy: "transport-stress-only",
        productPromotionAuthorized: false,
        sourceEndpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
        targetEndpoint: "death by CRELES wave 3 among participants with known wave-3 status",
      });

      expect(output.targetDataShape.knownStatusRows).toBe(324);
      expect(output.targetDataShape.completeCaseRows).toBe(324);
      expect(output.targetDataShape.missingFeatureExcludedRows).toBe(0);
      expect(output.targetDataShape.excludedFollowupRows).toBe(36);
      expect(output.targetDataShape.events).toBeGreaterThan(0);
      for (const counts of Object.values(output.targetDataShape.splitCounts)) {
        expect(counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
        expect(counts.n - counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
      }

      expect(output.sourceModel).toMatchObject({
        cardId: "lab5_bp_bmi_transport_research",
        coefficientsStored: false,
        endpoint: "10-year all-cause mortality",
        featureKeys: ["age", "male", "bmi", "hba1c", "triglycerides", "hdl-c"],
        horizonYears: 10,
        localArtifactPathStored: false,
        modelId: "midus2-lab5-lipid-body-no-crp-local-research",
        modelParametersStored: false,
        modelVersion: "midus2-first-no-crp-candidate-batch",
      });
      expect(output.sourceModel.referencePopulation).toContain("MIDUS 2");

      expect(output.rowValuesStored).toBe(false);
      expect(output.participantIdentifiersStored).toBe(false);
      expect(output.participantIdentifiersWritten).toBe(false);
      expect(output.splitMembershipStored).toBe(false);
      expect(output.predictionsStored).toBe(false);
      expect(output.coefficientsStored).toBe(false);
      expect(output.calibrationParametersStored).toBe(false);
      expect(output.sourceBodiesStored).toBe(false);
      expect(output.codebookTextStored).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      expect(Object.keys(output.transportModels)).toEqual([
        "midus2_lab5_source_raw",
        "midus2_lab5_source_creles_recalibrated",
        "creles_age_sex_reference",
      ]);
      expect(output.transportModels.midus2_lab5_source_raw).toMatchObject({
        calibrationParametersStored: false,
        calibrationPolicy: "none",
        candidateRole: "source_model",
        coefficientsStored: false,
        featureKeys: ["age", "male", "bmi", "hba1c", "triglycerides", "hdl-c"],
        predictionsStored: false,
      });
      expect(output.transportModels.midus2_lab5_source_creles_recalibrated).toMatchObject({
        calibrationParametersStored: false,
        calibrationPolicy: "creles-calibration-intercept-slope",
        candidateRole: "target_calibrated_source_model",
        coefficientsStored: false,
        featureKeys: ["age", "male", "bmi", "hba1c", "triglycerides", "hdl-c"],
        predictionsStored: false,
      });
      expect(output.transportModels.creles_age_sex_reference).toMatchObject({
        calibrationParametersStored: false,
        calibrationPolicy: "creles-calibration-age-sex-reference",
        candidateRole: "target_reference",
        coefficientsStored: false,
        featureKeys: ["age", "male"],
        predictionsStored: false,
      });
      for (const model of Object.values(output.transportModels)) {
        expect(Number.isFinite(model.splitMetrics.test.brier)).toBe(true);
        expect(Number.isFinite(model.splitMetrics.test.logLoss)).toBe(true);
        expect(model.splitMetrics.test.n).toBe(output.targetDataShape.splitCounts.test.n);
        expect(model.splitMetrics.calibration.n).toBe(output.targetDataShape.splitCounts.calibration.n);
      }

      expectNoForbiddenSentinels(JSON.stringify(output));

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints only aggregate CLI summary fields without local paths or row-level details", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-midus-creles-cli-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const modelCardOutputDir = path.join(tmp, "model-cards");
      const outputDir = path.join(tmp, "absolute-output-dir");
      const midusOutputDir = path.join(tmp, "absolute-midus-output-dir");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidus2Downloads(downloadsDir);
      await writeSyntheticCrelesDownloads(downloadsDir);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/midus2-creles-transport-benchmark.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: downloadsDir,
          MURPH_AGE_MIDUS_RESEARCH_OUTPUT_DIR: midusOutputDir,
          MURPH_AGE_MODEL_CARD_OUTPUT_DIR: modelCardOutputDir,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed.status).toBe("research-local-aggregate-only");
      expect(parsed.artifact).toBe("midus2-creles-transport-benchmark.latest.json");
      expect(parsed.targetDataShape.completeCaseRows).toBe(324);
      expect(parsed.transportModels.midus2_lab5_source_raw.test.n).toBe(parsed.targetDataShape.splitCounts.test.n);
      expect(stdout).not.toContain(outputDir);
      expect(stdout).not.toContain(modelCardOutputDir);
      expect(stdout).not.toContain(midusOutputDir);
      expect(stdout).not.toContain(tmp);
      expectNoForbiddenSentinels(stdout);
      expect(stdout).not.toContain("coefficient");
      expect(stdout).not.toContain("prediction");
      expect(findForbiddenAggregateEgress(parsed)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects low nonzero emitted counts before writing aggregate output", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-midus-creles-small-cell-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const modelCardOutputDir = path.join(tmp, "model-cards");
      const outputDir = path.join(tmp, "runtime");
      const midusOutputDir = path.join(tmp, "midus-runtime");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidus2Downloads(downloadsDir);
      await writeSyntheticCrelesDownloads(downloadsDir, { missingFeatureRows: 5 });

      await expect(runMidus2CrelesTransportBenchmark({
        createdAt: "2026-05-12T00:00:00.000Z",
        downloadsDir,
        midusOutputDir,
        modelCardOutputDir,
        outputDir,
      })).rejects.toThrow("small emitted count");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a sanitized CLI failure without paths, rows, ids, or stack traces", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-midus-creles-cli-failure-"));
    try {
      const downloadsDir = path.join(tmp, "missing-downloads");
      const outputDir = path.join(tmp, "absolute-output-dir");
      const modelCardOutputDir = path.join(tmp, "model-cards");
      const midusOutputDir = path.join(tmp, "absolute-midus-output-dir");
      await mkdir(downloadsDir, { recursive: true });

      const result = spawnSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/midus2-creles-transport-benchmark.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: downloadsDir,
          MURPH_AGE_MIDUS_RESEARCH_OUTPUT_DIR: midusOutputDir,
          MURPH_AGE_MODEL_CARD_OUTPUT_DIR: modelCardOutputDir,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("MIDUS-to-CRELES transport benchmark failed");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stderr).not.toContain(downloadsDir);
      expect(result.stderr).not.toContain(outputDir);
      expect(result.stderr).not.toContain(modelCardOutputDir);
      expect(result.stderr).not.toContain(midusOutputDir);
      expect(result.stderr).not.toContain("Error:");
      expect(result.stderr).not.toContain("at ");
      expectNoForbiddenSentinels(result.stderr);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeSyntheticMidus2Downloads(downloadsDir: string): Promise<void> {
  const surveyRows = [["M2ID", "B1PIDATE_YR"]];
  const biomarkerRows = [[
    "M2ID",
    "B4ZAGE",
    "B1PRSEX",
    "B4PBMI",
    "B4BHA1C",
    "B4BCHOL",
    "B4BTRIGL",
    "B4BHDL",
    "B4BLDL",
  ]];
  const mortalityRows = [["M2ID", "DOD_Y"]];

  for (let index = 1; index <= 180; index += 1) {
    const id = `M${String(index).padStart(4, "0")}`;
    const age = 42 + (index % 42);
    const male = index % 2 === 0 ? 1 : 2;
    const event = index % 6 === 0 || age > 78;
    surveyRows.push([id, index % 2 === 0 ? "2004" : "2005"]);
    biomarkerRows.push([
      id,
      String(age),
      String(male),
      String(23 + (index % 18) + (event ? 2 : 0)),
      String(5.1 + (index % 8) * 0.18 + (event ? 0.35 : 0)),
      String(160 + (index % 70) + (event ? 15 : 0)),
      String(70 + (index % 100) + (event ? 25 : 0)),
      String(40 + (index % 35) - (event ? 4 : 0)),
      String(80 + (index % 65) + (event ? 10 : 0)),
    ]);
    if (event) {
      mortalityRows.push([id, String(2008 + (index % 7))]);
    }
  }

  await writeZip(downloadsDir, "ICPSR_04652-V8.zip", {
    "ICPSR_04652/DS0001/04652-0001-Data.tsv": toTsv(surveyRows),
  });
  await writeZip(downloadsDir, "ICPSR_29282-V11.zip", {
    "ICPSR_29282/DS0001/29282-0001-Data.tsv": toTsv(biomarkerRows),
  });
  await writeZip(downloadsDir, "ICPSR_37237-V6.zip", {
    "ICPSR_37237/DS0001/37237-0001-Data.tsv": toTsv(mortalityRows),
  });
}

async function writeSyntheticCrelesDownloads(
  downloadsDir: string,
  options: { missingFeatureRows?: number } = {},
): Promise<void> {
  const recodedRows = [["IDSUJETO", "AGE", "SEX"]];
  const biomarkerRows = [[
    "IDSUJETO",
    "IMC",
    "HDL",
    "TGS",
    "HBAC1",
    "PCRAJU",
  ]];
  const followupRows = [["IDSUJETO", "TRACK_W3"]];

  for (let index = 1; index <= 360; index += 1) {
    const id = `C${String(index).padStart(4, "0")}`;
    const age = 60 + (index % 36);
    const male = index % 2 === 0 ? 1 : 2;
    const lost = index % 10 === 0;
    const event = !lost && (index % 3 === 0 || age >= 91);
    const missingFeature = index <= (options.missingFeatureRows ?? 0);
    recodedRows.push([id, String(age), String(male)]);
    biomarkerRows.push([
      id,
      String(22 + (index % 16) + (event ? 2 : 0)),
      missingFeature ? "" : String(38 + (index % 30) - (event ? 3 : 0)),
      String(70 + (index % 120) + (event ? 25 : 0)),
      String(5.0 + (index % 9) * 0.12 + (event ? 0.3 : 0)),
      String(2.0 + (index % 8) * 0.2),
    ]);
    followupRows.push([id, lost ? "3" : event ? "2" : "1"]);
  }

  await writeZip(downloadsDir, "ICPSR_26681-V3.zip", {
    "ICPSR_26681/DS0010/26681-0010-Data.tsv": toTsv(recodedRows),
    "ICPSR_26681/DS0002/26681-0002-Data.tsv": toTsv(biomarkerRows),
  });
  await writeZip(downloadsDir, "ICPSR_35250-V2.zip", {
    "ICPSR_35250/DS0013/35250-0013-Data.tsv": toTsv(followupRows),
  });
}

async function writeZip(downloadsDir: string, zipName: string, entries: Record<string, string>): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), "murph-age-zip-"));
  try {
    for (const [entry, contents] of Object.entries(entries)) {
      const entryPath = path.join(staging, entry);
      await mkdir(path.dirname(entryPath), { recursive: true });
      await writeFile(entryPath, contents);
    }
    execFileSync("zip", ["-q", "-r", path.join(downloadsDir, zipName), "."], { cwd: staging });
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

function toTsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.join("\t")).join("\n")}\n`;
}

function expectNoForbiddenSentinels(output: string): void {
  for (const sentinel of FORBIDDEN_OUTPUT_SENTINELS) {
    expect(output).not.toContain(sentinel);
  }
}
