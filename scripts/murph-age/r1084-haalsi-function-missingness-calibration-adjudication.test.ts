import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1084_HAALSI_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION,
  runR1084HaalsiFunctionMissingnessCalibrationAdjudication,
} from "./r1084-haalsi-function-missingness-calibration-adjudication.ts";

describe("R1084 HAALSI function missingness/calibration adjudication", () => {
  it("supports function content with a missingness caveat when it beats the missingness control", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1084-support-"));
    try {
      const paths = await writeFixture(tmp, haalsiFixture({}));
      const { output, outputPath } = await runR1084HaalsiFunctionMissingnessCalibrationAdjudication({
        createdAt: "2026-05-15T15:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1084-haalsi-function-missingness-calibration-adjudication.latest.json");
      expect(output.schemaVersion).toBe(R1084_HAALSI_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "haalsi_function_adjudication_supportive_with_missingness_caveat",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1084: false,
      });
      expect(output.adjudication).toMatchObject({
        calibrationNonWorse: true,
        functionBeatsMissingnessControl: true,
        functionContentBeatsReference: true,
        missingnessControlBeatsReference: true,
        verdict: "function_content_supported_with_missingness_caveat",
      });
      expect(output.nextLocalAction).toBe("keep_function_lead_seek_fresh_function_source_or_true_wearable");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"predictions\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds the function sidecar when missingness beats function", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1084-hold-"));
    try {
      const paths = await writeFixture(tmp, haalsiFixture({
        functionTest: {
          auc: 0.746,
          brier: 0.151,
          calibrationIntercept: 0.03,
          calibrationSlope: 1.2,
          expectedOverObserved: 1.08,
          logLoss: 0.469,
        },
        functionVerdict: "does_not_beat_age_sex",
      }));
      const { output } = await runR1084HaalsiFunctionMissingnessCalibrationAdjudication({
        ...paths,
      });

      expect(output.summary.conclusion).toBe("haalsi_function_adjudication_hold");
      expect(output.adjudication.verdict).toBe("function_content_fails_missingness_or_calibration");
      expect(output.nextLocalAction).toBe("hold_function_content_and_redirect_candidate_generation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks cleanly when the aggregate is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1084-missing-"));
    try {
      const outputDir = path.join(tmp, "out");
      await mkdir(outputDir);
      const { output } = await runR1084HaalsiFunctionMissingnessCalibrationAdjudication({
        outputDir,
        r1044Path: path.join(tmp, "missing.json"),
      });

      expect(output.summary.conclusion).toBe("haalsi_function_adjudication_blocked_missing_aggregate");
      expect(output.adjudication.verdict).toBe("missing_required_haalsi_aggregate");
      expect(output.nextLocalAction).toBe("await_haalsi_aggregate");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1084-unsafe-"));
    try {
      const paths = await writeFixture(tmp, {
        ...haalsiFixture({}),
        predictionsStored: true,
      });

      await expect(runR1084HaalsiFunctionMissingnessCalibrationAdjudication(paths)).rejects.toThrow(
        "R1084 input failed aggregate boundary validation",
      );
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1084-cli-"));
    try {
      const paths = await writeFixture(tmp, haalsiFixture({}));
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1084-haalsi-function-missingness-calibration-adjudication.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1044_HAALSI_PATH: paths.r1044Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "haalsi_function_adjudication_supportive_with_missingness_caveat",
        nextLocalAction: "keep_function_lead_seek_fresh_function_source_or_true_wearable",
        packetId: "r1084-haalsi-function-missingness-calibration-adjudication",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1084: false,
        schemaVersion: R1084_HAALSI_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        verdict: "function_content_supported_with_missingness_caveat",
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixture(
  tmp: string,
  value: Record<string, unknown>,
): Promise<{ outputDir: string; r1044Path: string }> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const r1044Path = path.join(fixtureDir, "r1044.json");
  await writeFile(r1044Path, `${JSON.stringify(value, null, 2)}\n`);
  return { outputDir, r1044Path };
}

function haalsiFixture(options: {
  functionTest?: Record<string, number>;
  functionVerdict?: string;
}): Record<string, unknown> {
  const reference = metrics({
    auc: 0.748,
    brier: 0.1504,
    calibrationIntercept: 0.025,
    calibrationSlope: 1.078,
    expectedOverObserved: 1.033,
    logLoss: 0.4668,
  });
  const functionModel = metrics(options.functionTest ?? {
    auc: 0.75,
    brier: 0.15,
    calibrationIntercept: 0.022,
    calibrationSlope: 1.062,
    expectedOverObserved: 1.025,
    logLoss: 0.4659,
  });
  const missingness = metrics({
    auc: 0.7475,
    brier: 0.1502,
    calibrationIntercept: 0.017,
    calibrationSlope: 1.063,
    expectedOverObserved: 1.029,
    logLoss: 0.4666,
  });
  return {
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    models: {
      A0_age_sex: {
        ...reference,
        deltasVsAgeSexReference: { brierDelta: 0, logLossDelta: 0 },
        verdict: "reference",
      },
      F1_walk_difficulty_shadow: {
        ...functionModel,
        deltasVsAgeSexReference: delta(functionModel, reference),
        verdict: options.functionVerdict ?? "beats_age_sex",
      },
      F2_glucose_walk_difficulty_shadow: {
        ...metrics({ auc: 0.757, brier: 0.1488, calibrationIntercept: 0, calibrationSlope: 1.038, expectedOverObserved: 1.024, logLoss: 0.4619 }),
        deltasVsAgeSexReference: { brierDelta: -0.0016, logLossDelta: -0.0049 },
        verdict: "beats_age_sex",
      },
      I1_glucose_body_pulse_walk_shadow: {
        ...metrics({ auc: 0.758, brier: 0.1483, calibrationIntercept: -0.025, calibrationSlope: 1.015, expectedOverObserved: 1.026, logLoss: 0.4615 }),
        deltasVsAgeSexReference: { brierDelta: -0.0021, logLossDelta: -0.0053 },
        verdict: "beats_age_sex",
      },
      NC6_missingness_quality_only: {
        ...missingness,
        deltasVsAgeSexReference: delta(missingness, reference),
        verdict: "beats_age_sex",
      },
    },
    packetId: "r1044-haalsi-external-biomarker-loop",
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };
}

function metrics(input: Record<string, number>): Record<string, unknown> {
  return {
    splitMetrics: {
      test: input,
    },
  };
}

function delta(candidate: Record<string, unknown>, reference: Record<string, unknown>): Record<string, number> {
  const candidateTest = (candidate.splitMetrics as Record<string, Record<string, number>>).test;
  const referenceTest = (reference.splitMetrics as Record<string, Record<string, number>>).test;
  return {
    brierDelta: Number((candidateTest.brier - referenceTest.brier).toFixed(8)),
    logLossDelta: Number((candidateTest.logLoss - referenceTest.logLoss).toFixed(8)),
  };
}
