import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  calculateAuc,
  findForbiddenAggregateEgress,
  MIDUS2_LOCAL_BENCHMARK_SCHEMA_VERSION,
  runMidus2LocalBenchmark,
} from "./midus2-local-benchmark.ts";

describe("MIDUS 2 local benchmark runner", () => {
  it("writes aggregate-only model metrics without leaking rows, ids, predictions, or coefficients", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-midus2-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "runtime");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidus2Downloads(downloadsDir);

      const { output, outputPath } = await runMidus2LocalBenchmark({
        createdAt: "2026-05-12T00:00:00.000Z",
        downloadsDir,
        outputDir,
      });

      expect(output.schemaVersion).toBe(MIDUS2_LOCAL_BENCHMARK_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.candidateBatch).toEqual({
        batchId: "midus2-first-no-crp-candidate-batch",
        candidateCount: 5,
        exposureLabel: "diagnostic-only",
        hypothesisSources: [
          "literature or mechanistic rationale",
          "robustness stress test",
          "train/calibration diagnostic",
        ],
        promotionAuthorized: false,
        testSelectionAuthorized: false,
      });
      expect(output.dataShape.eligibleRows).toBe(180);
      expect(output.dataShape.events).toBeGreaterThan(0);
      expect(output.dataShape.splitCounts.train.n).toBeGreaterThan(0);
      expect(output.dataShape.splitCounts.calibration.n).toBeGreaterThan(0);
      expect(output.dataShape.splitCounts.test.n).toBeGreaterThan(0);
      expect(output.rowValuesStored).toBe(false);
      expect(output.participantIdentifiersStored).toBe(false);
      expect(output.splitMembershipStored).toBe(false);
      expect(output.predictionsStored).toBe(false);
      expect(output.coefficientsStored).toBe(false);
      expect(output.sourceBodiesStored).toBe(false);
      expect(output.codebookTextStored).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain("M0001");
      expect(serialized).not.toContain("selectedPointIds");
      expect(serialized).not.toContain("rawRows");
      expect(serialized).not.toContain("sourceText");
      expect(serialized).not.toContain("coefficients\":");
      expect(serialized).not.toContain("predictions\":");

      const reference = output.models.age_sex_reference;
      expect(reference?.candidateRole).toBe("reference");
      expect(reference?.featureKeys).toEqual(["age", "male"]);
      expect(reference?.hypothesis).toContain("reference");
      expect(reference?.hypothesisSource).toBe("literature or mechanistic rationale");

      const glycemiaBody = output.models.glycemia_body_no_crp;
      expect(glycemiaBody?.candidateRole).toBe("proposal");
      expect(glycemiaBody?.featureKeys).toEqual(["age", "male", "bmi", "hba1c"]);
      expect(glycemiaBody?.coefficientsStored).toBe(false);
      expect(glycemiaBody?.predictionsStored).toBe(false);

      expect(output.models.lab5_lipid_body_no_crp?.featureKeys).toEqual([
        "age",
        "male",
        "bmi",
        "hba1c",
        "log-triglycerides",
        "hdl-c",
      ]);
      expect(output.models.extended_lipids_body_no_crp?.featureKeys).toEqual([
        "age",
        "male",
        "bmi",
        "total-cholesterol",
        "log-triglycerides",
        "hdl-c",
        "ldl-c",
      ]);

      const clinical = output.models.clinical_core_labs_no_albumin_no_crp;
      expect(Object.keys(output.models)).toHaveLength(output.candidateBatch.candidateCount);
      expect(clinical?.candidateRole).toBe("proposal");
      expect(clinical?.coefficientsStored).toBe(false);
      expect(clinical?.predictionsStored).toBe(false);
      expect(clinical?.featureKeys).not.toContain("albumin");
      expect(clinical?.featureKeys).not.toContain("log-crp");
      expect(JSON.stringify(output)).not.toContain("log-crp");
      expect(JSON.stringify(output)).not.toContain("B4BCRP");
      expect(JSON.stringify(output)).not.toContain("hscrp");
      expect(JSON.stringify(output)).not.toContain("c_reactive");
      expect(Number.isFinite(clinical?.splitMetrics.test.logLoss)).toBe(true);
      expect(Number.isFinite(clinical?.splitMetrics.test.brier)).toBe(true);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints only aggregate CLI summary fields without local output paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-midus2-cli-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "absolute-output-dir");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidus2Downloads(downloadsDir);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/midus2-local-benchmark.ts"),
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
      expect(parsed.candidateBatch).toEqual({
        batchId: "midus2-first-no-crp-candidate-batch",
        candidateCount: 5,
        exposureLabel: "diagnostic-only",
        hypothesisSources: [
          "literature or mechanistic rationale",
          "robustness stress test",
          "train/calibration diagnostic",
        ],
        promotionAuthorized: false,
        testSelectionAuthorized: false,
      });
      expect(parsed.artifact).toBe("midus2-local-benchmark.latest.json");
      expect(parsed.wrote).toBeUndefined();
      expect(stdout).not.toContain(outputDir);
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("M0001");
      expect(findForbiddenAggregateEgress(parsed)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects row-level and model-internal egress fields", () => {
    expect(findForbiddenAggregateEgress({ participantIds: ["M0001"] })).toEqual([
      "forbidden key participantIds",
    ]);
    expect(findForbiddenAggregateEgress({ rowValuesStored: true })).toEqual([
      "boundary flag rowValuesStored must be false",
    ]);
    expect(findForbiddenAggregateEgress({ candidateBatch: { promotionAuthorized: true } })).toEqual([
      "boundary flag candidateBatch.promotionAuthorized must be false",
    ]);
    expect(findForbiddenAggregateEgress({ candidateBatch: { testSelectionAuthorized: true } })).toEqual([
      "boundary flag candidateBatch.testSelectionAuthorized must be false",
    ]);
    expect(findForbiddenAggregateEgress({ nested: { coefficients: [1, 2, 3] } })).toEqual([
      "forbidden key nested.coefficients",
    ]);
  });

  it("uses half-credit for tied AUC predictions", () => {
    expect(calculateAuc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5])).toBe(0.5);
    expect(calculateAuc([0, 1, 0, 1], [0.1, 0.1, 0.8, 0.8])).toBe(0.5);
    expect(calculateAuc([0, 1, 0, 1], [0.1, 0.9, 0.2, 0.8])).toBe(1);
    expect(calculateAuc([0, 1, 0, 1], [0.9, 0.1, 0.8, 0.2])).toBe(0);
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
