import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION,
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  validateMurphAgeIncrementEvaluationCard,
} from "@murphai/health-metrics";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R399_MIDUS2_BIOMARKER_INCREMENT_SCHEMA_VERSION,
  runR399Midus2BiomarkerIncrement,
} from "./r399-midus2-biomarker-increment.ts";
import { R399_RESEARCH_CARD_ID } from "./r399-local-model-card.ts";

describe("R399 MIDUS 2 biomarker increment runner", () => {
  it("layers compact biomarkers over the R399 anchor without leaking rows or model internals", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-midus2-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "runtime");
      const r399ModelCardPath = path.join(tmp, "model-cards", "r399.json");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidus2Downloads(downloadsDir);
      await writeSyntheticR399ModelCard(r399ModelCardPath);

      const { output, outputPath } = await runR399Midus2BiomarkerIncrement({
        createdAt: "2026-05-12T00:00:00.000Z",
        downloadsDir,
        outputDir,
        r399ModelCardPath,
      });

      expect(output.schemaVersion).toBe(R399_MIDUS2_BIOMARKER_INCREMENT_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.benchmarkId).toBe("r399-midus2-biomarker-increment-local-0");
      expect(output.anchor.cardId).toBe(R399_RESEARCH_CARD_ID);
      expect(output.anchor.localArtifactPathStored).toBe(false);
      expect(output.anchor.modelParametersStored).toBe(false);
      expect(output.anchor.coefficientsStored).toBe(false);
      expect(output.anchor.predictionsStored).toBe(false);
      expect(output.candidateBatch).toEqual({
        batchId: "r399-midus2-first-biomarker-increment-batch",
        candidateCount: 5,
        exposureLabel: "diagnostic-only",
        hypothesisSources: [
          "literature or mechanistic rationale",
          "external-source feasibility need",
          "train/calibration diagnostic",
          "robustness stress test",
        ],
        promotionAuthorized: false,
        testSelectionAuthorized: false,
      });
      expect(output.dataShape.eligibleRows).toBe(180);
      expect(output.dataShape.events).toBeGreaterThan(0);
      expect(output.dataShape.splitCounts.train.n).toBeGreaterThan(0);
      expect(output.dataShape.splitCounts.calibration.n).toBeGreaterThan(0);
      expect(output.dataShape.splitCounts.test.n).toBeGreaterThan(0);
      expect(output.dataShape.r399ProxyFeatureObservedCounts["self-rated-health"]).toBe(180);
      expect(output.incrementEvaluationCard.schemaVersion).toBe(MURPH_AGE_INCREMENT_EVALUATION_CARD_SCHEMA_VERSION);
      expect(output.incrementEvaluationCard.anchorCardId).toBe(R399_RESEARCH_CARD_ID);
      expect(output.incrementEvaluationCard.candidateBatchId).toBe("r399-midus2-first-biomarker-increment-batch");
      expect(output.incrementEvaluationCard.candidateId).toBe("r399-plus-lab3-bmi-increment");
      expect(output.incrementEvaluationCard.layer).toBe("biomarker-increment");
      expect(output.incrementEvaluationCard.sourceRouteId).toBe("midus-biomarker-mortality");
      expect(output.incrementEvaluationCard.productAuthorized).toBe(false);
      expect(output.incrementEvaluationCard.scoreBearing).toBe(false);
      expect(output.incrementEvaluationCard.scoreContributionAuthorized).toBe(false);
      expect(output.incrementEvaluationCard.flatteningAuthorized).toBe(false);
      expect(output.incrementEvaluationCard.evaluation.comparator).toBe("anchor-vs-anchor-plus-increment");
      expect(output.incrementEvaluationCard.evaluation.sameDenominator).toBe(true);
      expect(output.incrementEvaluationCard.evaluation.aggregateSample?.evaluatedRowCount).toBe(
        output.dataShape.splitCounts.test.n,
      );
      expect(output.incrementEvaluationCard.evaluation.aggregateSample?.eventCount).toBe(
        output.dataShape.splitCounts.test.events,
      );
      expect(output.incrementEvaluationCard.evaluation.anchorMetrics).toEqual(
        output.models.r399_anchor_recalibrated?.splitMetrics.test,
      );
      expect(output.incrementEvaluationCard.evaluation.candidateMetrics).toEqual(
        output.models.r399_plus_lab3_bmi_increment?.splitMetrics.test,
      );
      expect(validateMurphAgeIncrementEvaluationCard(output.incrementEvaluationCard)).toEqual({
        status: "valid",
        warnings: [],
      });
      expect(output.rowValuesStored).toBe(false);
      expect(output.participantIdentifiersStored).toBe(false);
      expect(output.participantIdentifiersWritten).toBe(false);
      expect(output.splitMembershipStored).toBe(false);
      expect(output.predictionsStored).toBe(false);
      expect(output.coefficientsStored).toBe(false);
      expect(output.sourceBodiesStored).toBe(false);
      expect(output.codebookTextStored).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const r399Recalibrated = output.models.r399_anchor_recalibrated;
      expect(r399Recalibrated?.anchorCardId).toBe(R399_RESEARCH_CARD_ID);
      expect(r399Recalibrated?.candidateRole).toBe("base_anchor");
      expect(r399Recalibrated?.featureKeys).toEqual(["r399-logit"]);
      expect(r399Recalibrated?.coefficientsStored).toBe(false);
      expect(r399Recalibrated?.predictionsStored).toBe(false);

      expect(output.models.r399_plus_lab3_increment?.featureKeys).toEqual([
        "r399-logit",
        "hba1c",
        "log-triglycerides",
        "hdl-c",
      ]);
      expect(output.models.r399_plus_lab3_bmi_increment?.featureKeys).toEqual([
        "r399-logit",
        "bmi",
        "hba1c",
        "log-triglycerides",
        "hdl-c",
      ]);
      expect(output.models.lab3_age_sex_reference?.anchorCardId).toBeNull();
      expect(output.models.lab3_age_sex_reference?.featureKeys).toEqual([
        "age",
        "female",
        "bmi",
        "hba1c",
        "log-triglycerides",
        "hdl-c",
      ]);
      expect(Object.keys(output.models)).toHaveLength(output.candidateBatch.candidateCount);

      for (const model of Object.values(output.models)) {
        expect(model.coefficientsStored).toBe(false);
        expect(model.predictionsStored).toBe(false);
        expect(Number.isFinite(model.splitMetrics.train.logLoss)).toBe(true);
        expect(Number.isFinite(model.splitMetrics.calibration.brier)).toBe(true);
        expect(Number.isFinite(model.splitMetrics.test.meanPrediction)).toBe(true);
      }

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain("M0001");
      expect(serialized).not.toContain("selectedPointIds");
      expect(serialized).not.toContain("rawRows");
      expect(serialized).not.toContain("sourceText\":");
      expect(serialized).not.toContain("coefficients\":");
      expect(serialized).not.toContain("predictions\":");
      expect(serialized).not.toContain(tmp);

      const persisted = JSON.parse(await readFile(outputPath, "utf8"));
      expect(persisted).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints only aggregate CLI summary fields without local output paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-midus2-cli-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "absolute-output-dir");
      const r399ModelCardPath = path.join(tmp, "model-cards", "r399.json");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidus2Downloads(downloadsDir);
      await writeSyntheticR399ModelCard(r399ModelCardPath);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r399-midus2-biomarker-increment.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: downloadsDir,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: outputDir,
          MURPH_AGE_R399_MODEL_CARD_PATH: r399ModelCardPath,
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed.status).toBe("research-local-aggregate-only");
      expect(parsed.schemaVersion).toBe(R399_MIDUS2_BIOMARKER_INCREMENT_SCHEMA_VERSION);
      expect(parsed.artifact).toBe("r399-midus2-biomarker-increment.latest.json");
      expect(parsed.anchor.cardId).toBe(R399_RESEARCH_CARD_ID);
      expect(parsed.modelIds).toEqual([
        "age_sex_reference",
        "r399_anchor_recalibrated",
        "r399_plus_lab3_increment",
        "r399_plus_lab3_bmi_increment",
        "lab3_age_sex_reference",
      ]);
      expect(stdout).not.toContain(outputDir);
      expect(stdout).not.toContain(r399ModelCardPath);
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("M0001");
      expect(stdout).not.toContain("coefficient");
      expect(findForbiddenAggregateEgress(parsed)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects non-R399 local model cards before scoring rows", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-midus2-wrong-card-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "runtime");
      const r399ModelCardPath = path.join(tmp, "model-cards", "wrong-card.json");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticR399ModelCard(r399ModelCardPath, { cardId: "lab5_bp_bmi_transport_research" });

      await expect(runR399Midus2BiomarkerIncrement({
        downloadsDir,
        outputDir,
        r399ModelCardPath,
      })).rejects.toThrow(`Expected R399 local model-card artifact ${R399_RESEARCH_CARD_ID}.`);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects MIDUS downloads with missing required TSV columns", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-midus2-missing-column-"));
    try {
      const downloadsDir = path.join(tmp, "downloads");
      const outputDir = path.join(tmp, "runtime");
      const r399ModelCardPath = path.join(tmp, "model-cards", "r399.json");
      await mkdir(downloadsDir, { recursive: true });
      await writeSyntheticMidus2Downloads(downloadsDir, { omitSurveyColumn: "B1PA1" });
      await writeSyntheticR399ModelCard(r399ModelCardPath);

      await expect(runR399Midus2BiomarkerIncrement({
        downloadsDir,
        outputDir,
        r399ModelCardPath,
      })).rejects.toThrow("Missing expected TSV columns: B1PA1");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeSyntheticMidus2Downloads(
  downloadsDir: string,
  options: { omitSurveyColumn?: string } = {},
): Promise<void> {
  const surveyHeader = [
    "M2ID",
    "B1PIDATE_YR",
    "B1PA1",
    "B1PA24",
    "B1PA38A",
    "B1PA39",
    "B1SA11X",
    "B1SA30A",
    "B1SA30B",
    "B1SA30C",
    "B1SA30D",
    "B1SA30E",
    "B1SA30F",
    "B1SA31A",
    "B1SA31B",
    "B1SA31C",
    "B1SA31D",
    "B1SA31E",
    "B1SA31F",
  ];
  const surveyRows = [surveyHeader];
  const biomarkerRows = [[
    "M2ID",
    "B4ZAGE",
    "B1PRSEX",
    "B4PBMI",
    "B4BHA1C",
    "B4BTRIGL",
    "B4BHDL",
  ]];
  const mortalityRows = [["M2ID", "DOD_Y"]];

  for (let index = 1; index <= 180; index += 1) {
    const id = `M${String(index).padStart(4, "0")}`;
    const age = 42 + (index % 42);
    const event = index % 6 === 0 || age > 78;
    const worseSurveyRisk = event ? 1 : 0;
    surveyRows.push([
      id,
      index % 2 === 0 ? "2004" : "2005",
      String(Math.min(5, 1 + (index % 3) + worseSurveyRisk)),
      event || index % 5 === 0 ? "1" : "2",
      event || index % 4 === 0 ? "1" : "2",
      event && index % 3 === 0 ? "1" : "2",
      event && index % 2 === 0 ? "1" : "2",
      ...Array.from({ length: 6 }, (_, offset) => String(event ? 5 + (offset % 2) : 1 + ((index + offset) % 3))),
      ...Array.from({ length: 6 }, (_, offset) => String(event ? 4 + (offset % 3) : 1 + ((index + offset) % 4))),
    ]);
    biomarkerRows.push([
      id,
      String(age),
      String(index % 2 === 0 ? 1 : 2),
      String(23 + (index % 18) + (event ? 2 : 0)),
      String(5.1 + (index % 8) * 0.18 + (event ? 0.35 : 0)),
      String(70 + (index % 100) + (event ? 25 : 0)),
      String(40 + (index % 35) - (event ? 4 : 0)),
    ]);
    if (event) {
      mortalityRows.push([id, String(2008 + (index % 7))]);
    }
  }

  const normalizedSurveyRows = surveyRows.map((row) =>
    options.omitSurveyColumn
      ? row.filter((_, index) => index !== [
        "M2ID",
        "B1PIDATE_YR",
        "B1PA1",
        "B1PA24",
        "B1PA38A",
        "B1PA39",
        "B1SA11X",
        "B1SA30A",
        "B1SA30B",
        "B1SA30C",
        "B1SA30D",
        "B1SA30E",
        "B1SA30F",
        "B1SA31A",
        "B1SA31B",
        "B1SA31C",
        "B1SA31D",
        "B1SA31E",
        "B1SA31F",
      ].indexOf(options.omitSurveyColumn ?? ""))
      : row
  );

  await writeZip(downloadsDir, "ICPSR_04652-V8.zip", {
    "ICPSR_04652/DS0001/04652-0001-Data.tsv": toTsv(normalizedSurveyRows),
  });
  await writeZip(downloadsDir, "ICPSR_29282-V11.zip", {
    "ICPSR_29282/DS0001/29282-0001-Data.tsv": toTsv(biomarkerRows),
  });
  await writeZip(downloadsDir, "ICPSR_37237-V6.zip", {
    "ICPSR_37237/DS0001/37237-0001-Data.tsv": toTsv(mortalityRows),
  });
}

async function writeSyntheticR399ModelCard(
  filePath: string,
  options: { cardId?: string } = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({
    cardId: options.cardId ?? R399_RESEARCH_CARD_ID,
    model: {
      endpoint: "10-year all-cause mortality",
      features: [
        {
          coefficient: 0.035,
          key: "age",
          kind: "chronological-age",
          label: "Age",
          moduleId: "demographics",
        },
        {
          coefficient: -0.18,
          key: "female",
          kind: "sex",
          label: "Female",
          moduleId: "demographics",
          sex: "female",
        },
        {
          coefficient: 0.025,
          expectedUnit: "kg/m^2",
          key: "bmi",
          kind: "metric",
          label: "BMI",
          metricKey: "bmi",
          moduleId: "body",
          required: false,
        },
        {
          coefficient: 0.16,
          key: "self-rated-health",
          kind: "metric",
          label: "Self-rated health",
          metricKey: "self-rated-health",
          moduleId: "function",
          required: false,
        },
        {
          coefficient: 0.2,
          key: "hypertension-history",
          kind: "metric",
          label: "Hypertension history",
          metricKey: "hypertension-history-proxy-yes",
          moduleId: "cardiovascular",
          required: false,
        },
        {
          coefficient: 0.28,
          key: "diabetes-history",
          kind: "metric",
          label: "Diabetes history",
          metricKey: "diabetes-history-proxy-yes",
          moduleId: "metabolic",
          required: false,
        },
        {
          coefficient: 0.15,
          key: "smoking-status",
          kind: "metric",
          label: "Smoking status",
          metricKey: "smoking-status-proxy",
          moduleId: "behavior",
          required: false,
        },
        {
          coefficient: -0.01,
          key: "physical-activity-proxy",
          kind: "metric",
          label: "Physical activity",
          metricKey: "physical-activity-proxy",
          moduleId: "activity",
          required: false,
        },
      ],
      horizonYears: 10,
      intercept: -4.1,
      modelId: "fixture-r399-nhis-proxy-anchor",
      modelVersion: "fixture",
      referencePopulation: "Synthetic R399 fixture",
      referenceRiskCurve: [
        { ageYears: 20, riskProbability: 0.01 },
        { ageYears: 40, riskProbability: 0.04 },
        { ageYears: 60, riskProbability: 0.16 },
        { ageYears: 80, riskProbability: 0.35 },
        { ageYears: 90, riskProbability: 0.5 },
      ],
      uncertainty: {
        baseYears: 4,
        perLowConfidenceMetricYears: 1,
        perMissingOptionalFeatureYears: 2,
      },
    },
    schemaVersion: MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  }, null, 2)}\n`);
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
