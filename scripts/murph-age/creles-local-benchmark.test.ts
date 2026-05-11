import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  CRELES_LOCAL_BENCHMARK_SCHEMA_VERSION,
  runCrelesLocalBenchmark,
} from "./creles-local-benchmark.ts";

describe("CRELES local benchmark runner", () => {
  it("writes aggregate-only mortality-status metrics without leaking rows, ids, predictions, or coefficients", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-creles-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "runtime");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticCrelesDownloads(downloadsDir);

      const { output, outputPath } = await runCrelesLocalBenchmark({
        createdAt: "2026-05-12T00:00:00.000Z",
        downloadsDir,
        outputDir,
      });

      expect(output.schemaVersion).toBe(CRELES_LOCAL_BENCHMARK_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.benchmarkId).toBe("creles-wave1-biomarker-wave3-mortality-status-local-0");
      expect(output.benchmarkCard).toMatchObject({
        allowedMetrics: ["auc", "brier", "logLoss", "meanPrediction", "observedRate"],
        baseline: "CRELES Wave 1 household/biomarker baseline",
        benchmarkCardId: "creles-wave1-wave3-mortality-status-card-0",
        censoringRule: "Participants lost before Wave 3 are excluded; exact death and censoring dates are not used.",
        denominator: "Wave 1 biomarker participants with interpretable Wave 3 known-alive or death-by-wave status",
        evidenceClassLabel: "public non-NHANES transport diagnostic",
        exposureLabel: "diagnostic-only",
        minimumCellThreshold: 10,
        schemaVersion: "murph-age-benchmark-card.v1",
        surveyWeightPolicy: "Unweighted first transport diagnostic; weighted CRELES analysis requires a separate predeclared runner.",
      });
      expect(output.benchmarkCard.featureMappingPolicy).toEqual({
        allowedFeatureFamilies: ["demographics", "body", "glycemia", "lipids", "blood-pressure"],
        blockedFeatureFamilies: ["crp", "hs-crp", "inflammation-assay-family"],
      });
      expect(output.benchmarkCard.abstentionCriteria.length).toBeGreaterThan(0);
      expect(output.benchmarkCard.allowedArtifactBoundary).toEqual([
        "aggregate counts",
        "aggregate split metrics",
        "aggregate feature-observed counts",
        "benchmark-card metadata",
        "validation statuses",
      ]);
      expect(output.endpoint).toBe("death by CRELES wave 3 among participants with known wave-3 status");
      expect(output.endpointLimitations).toEqual([
        "Wave-status endpoint only; exact death or censoring dates are not used.",
        "Lost-to-follow-up statuses are excluded from the executable benchmark denominator.",
      ]);
      expect(output.candidateBatch).toEqual({
        batchId: "creles-wave3-no-crp-candidate-batch",
        candidateCount: 5,
        exposureLabel: "diagnostic-only",
        hypothesisSources: [
          "literature or mechanistic rationale",
          "transport stress test",
        ],
        promotionAuthorized: false,
        testSelectionAuthorized: false,
      });
      expect(output.dataShape.eligibleRows).toBe(324);
      expect(output.dataShape.excludedFollowupRows).toBe(36);
      expect(output.dataShape.events).toBeGreaterThan(0);
      expect(output.dataShape.splitCounts.train.n).toBeGreaterThan(0);
      expect(output.dataShape.splitCounts.calibration.n).toBeGreaterThan(0);
      expect(output.dataShape.splitCounts.test.n).toBeGreaterThan(0);
      for (const counts of Object.values(output.dataShape.splitCounts)) {
        expect(counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
        expect(counts.n - counts.events).toBeGreaterThanOrEqual(output.benchmarkCard.minimumCellThreshold);
      }
      expect(output.rowValuesStored).toBe(false);
      expect(output.participantIdentifiersStored).toBe(false);
      expect(output.participantIdentifiersWritten).toBe(false);
      expect(output.splitMembershipStored).toBe(false);
      expect(output.predictionsStored).toBe(false);
      expect(output.coefficientsStored).toBe(false);
      expect(output.sourceBodiesStored).toBe(false);
      expect(output.codebookTextStored).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain("C0001");
      expect(serialized).not.toContain("IDSUJETO");
      expect(serialized).not.toContain("CASEID");
      expect(serialized).not.toContain("TRACK_W3");
      expect(serialized).not.toContain("PCR");
      expect(serialized).not.toContain("hscrp");
      expect(serialized).not.toContain("c-reactive");
      expect(serialized).not.toContain("coefficients\":");
      expect(serialized).not.toContain("predictions\":");

      const reference = output.models.age_sex_reference;
      expect(reference?.candidateRole).toBe("reference");
      expect(reference?.featureKeys).toEqual(["age", "male"]);

      const lab5 = output.models.lab5_lipid_body_no_crp;
      expect(lab5?.candidateRole).toBe("proposal");
      expect(lab5?.featureKeys).toEqual([
        "age",
        "male",
        "bmi",
        "hba1c",
        "log-triglycerides",
        "hdl-c",
      ]);
      expect(lab5?.coefficientsStored).toBe(false);
      expect(lab5?.predictionsStored).toBe(false);

      const extended = output.models.extended_clinical_no_crp;
      expect(extended?.featureKeys).toContain("systolic-blood-pressure");
      expect(extended?.featureKeys).toContain("diastolic-blood-pressure");
      expect(extended?.featureKeys).not.toContain("log-crp");
      expect(Object.keys(output.models)).toHaveLength(output.candidateBatch.candidateCount);
      expect(Number.isFinite(extended?.splitMetrics.test.logLoss)).toBe(true);
      expect(Number.isFinite(extended?.splitMetrics.test.brier)).toBe(true);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints only aggregate CLI summary fields without local output paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-creles-cli-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "absolute-output-dir");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticCrelesDownloads(downloadsDir);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/creles-local-benchmark.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: downloadsDir,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed.status).toBe("research-local-aggregate-only");
      expect(parsed.artifact).toBe("creles-local-benchmark.latest.json");
      expect(parsed.dataShape.eligibleRows).toBe(324);
      expect(stdout).not.toContain(outputDir);
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("C0001");
      expect(stdout).not.toContain("coefficient");
      expect(stdout).not.toContain("prediction");
      expect(findForbiddenAggregateEgress(parsed)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeSyntheticCrelesDownloads(downloadsDir: string): Promise<void> {
  const recodedRows = [["IDSUJETO", "AGE", "SEX"]];
  const biomarkerRows = [[
    "IDSUJETO",
    "IMC",
    "GLUCOSA",
    "COLESTTOT",
    "HDL",
    "TGS",
    "LDL",
    "HBAC1",
    "DIASTOLICA",
    "SISTOLICA",
    "PCRAJU",
  ]];
  const followupRows = [["IDSUJETO", "TRACK_W3"]];

  for (let index = 1; index <= 360; index += 1) {
    const id = `C${String(index).padStart(4, "0")}`;
    const age = 60 + (index % 36);
    const male = index % 2 === 0 ? 1 : 2;
    const lost = index % 10 === 0;
    const event = !lost && (index % 3 === 0 || age >= 91);
    recodedRows.push([id, String(age), String(male)]);
    biomarkerRows.push([
      id,
      String(22 + (index % 16) + (event ? 2 : 0)),
      String(80 + (index % 42) + (event ? 10 : 0)),
      String(160 + (index % 80) + (event ? 15 : 0)),
      String(38 + (index % 30) - (event ? 3 : 0)),
      String(70 + (index % 120) + (event ? 25 : 0)),
      String(80 + (index % 70) + (event ? 12 : 0)),
      String(5.0 + (index % 9) * 0.12 + (event ? 0.3 : 0)),
      String(64 + (index % 28) + (event ? 4 : 0)),
      String(118 + (index % 54) + (event ? 10 : 0)),
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
