import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R399_LAYERING_READINESS_SCHEMA_VERSION,
  runR399LayeringReadiness,
} from "./r399-layering-readiness.ts";

const R399_FEATURES = [
  "age_years",
  "sex_female",
  "body_mass_index",
  "self_rated_health",
  "hypertension_history_proxy_yes",
  "diabetes_history_proxy_yes",
  "smoking_status_proxy",
  "physical_activity_proxy",
  "body_mass_index_missing",
  "self_rated_health_missing",
  "hypertension_history_proxy_missing",
  "diabetes_history_proxy_missing",
  "smoking_status_proxy_missing",
  "physical_activity_proxy_missing",
  "age_years_squared",
  "age_x_sex_female",
] as const;

describe("R399 layering readiness runner", () => {
  it("summarizes the frozen anchor and blocks product layering when transport is not confirmed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      const { output, outputPath } = await runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r399-layering-readiness.latest.json");
      expect(output.schemaVersion).toBe(R399_LAYERING_READINESS_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.anchor).toMatchObject({
        coefficientCountStored: false,
        committedCalculatorCardPresent: false,
        featureFamilies: [
          "chronological-age",
          "sex",
          "body",
          "self-rated-health",
          "disease-history-proxy",
          "smoking-proxy",
          "activity-proxy",
          "missingness-indicators",
          "age-nonlinearity",
        ],
        featureCount: R399_FEATURES.length,
        modelId: "r399_compact_age_nonlinear_l2_0p000",
        modelParametersStored: false,
        present: true,
        privateRuntimeParamsRequired: true,
      });
      expect(output.gates.r399AnchorPresent.status).toBe("passed");
      expect(output.gates.calculatorScorePathReady.status).toBe("blocked");
      expect(output.gates.biomarkerTransportConfirmed.status).toBe("blocked");
      expect(output.gates.wearableIncrementValidated.status).toBe("blocked");
      expect(output.productPromotionAuthorized).toBe(false);
      expect(output.evidence.biomarkerIncrement.map((entry) => entry.sourceId)).toEqual([
        "midus2-lab5-internal",
        "creles-lab5-local",
        "midus2-lab5-to-creles-transport",
      ]);
      expect(output.evidence.biomarkerIncrement[0]?.verdict).toBe("promising_internal_only");
      expect(output.evidence.biomarkerIncrement[2]?.verdict).toBe("not_promotable");
      expect(output.evidence.biomarkerIncrement[2]?.comparison).toEqual({
        aucDelta: -0.002677,
        brierDelta: 0.000441,
        logLossDelta: 0.001687,
        modelId: "midus2_lab5_source_creles_recalibrated",
        referenceModelId: "creles_age_sex_reference",
      });
      expect(output.coefficientsStored).toBe(false);
      expect(output.modelParametersStored).toBe(false);
      expect(output.predictionsStored).toBe(false);
      expect(output.rowValuesStored).toBe(false);
      expect(output.sourceBodiesStored).toBe(false);
      expect(output.localPathsStored).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8"));
      expect("artifactHash" in persisted.anchor).toBe(false);
      expect(JSON.stringify(persisted)).not.toContain(paths.r399ParamsPath);
      expect(JSON.stringify(persisted)).not.toContain("hypertension_history_proxy_yes");
      expect(JSON.stringify(persisted)).not.toContain("coefficients\":");
      expect(JSON.stringify(persisted)).not.toContain("predictions\":");
      expect(JSON.stringify(persisted)).not.toContain("rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("passes the biomarker transport gate only when transport beats the target reference on conservative aggregate metrics", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: true });
      const { output } = await runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.gates.biomarkerTransportConfirmed.status).toBe("passed");
      expect(output.evidence.biomarkerIncrement[2]?.verdict).toBe("transport_confirmed");
      expect(output.gates.productPromotionReady.status).toBe("blocked");
      expect(output.productPromotionAuthorized).toBe(false);
      expect(output.blockedReasons.some((reason) => reason.includes("Wearable"))).toBe(true);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("handles a missing R399 artifact without leaking local paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      const { output } = await runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
        r399ParamsPath: path.join(tmp, "missing-r399.json"),
      });

      expect(output.anchor.present).toBe(false);
      expect(output.anchor.featureFamilies).toEqual([]);
      expect(output.gates.r399AnchorPresent.status).toBe("blocked");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not egress raw row, prediction, coefficient, or source-body fields from local inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      await addForbiddenInputDetails(paths);

      const { output, outputPath } = await runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      const persisted = await readFile(outputPath, "utf8");
      expect(output.anchor.featureFamilies).toEqual([
        "chronological-age",
        "sex",
        "body",
        "self-rated-health",
        "disease-history-proxy",
        "smoking-proxy",
        "activity-proxy",
        "missingness-indicators",
        "age-nonlinearity",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("sourceText");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("hypertension_history_proxy_yes");
      expect(persisted).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects duplicate or incomplete R399 feature allowlists", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      const r399 = JSON.parse(await readFile(paths.r399ParamsPath, "utf8"));
      r399.models.r399_compact_age_nonlinear_l2_0p000.features = [
        ...R399_FEATURES.slice(0, R399_FEATURES.length - 1),
        R399_FEATURES[0],
      ];
      await writeJson(paths.r399ParamsPath, r399);

      await expect(runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("Frozen R399 feature set does not match the expected allowlist.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless aggregate CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r399-layering-readiness.ts"),
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CRELES_OUTPUT_PATH: paths.crelesOutputPath,
          MURPH_AGE_MIDUS2_OUTPUT_PATH: paths.midus2OutputPath,
          MURPH_AGE_R399_PARAMS_PATH: paths.r399ParamsPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
          MURPH_AGE_TRANSPORT_OUTPUT_PATH: paths.transportOutputPath,
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({
        anchorPresent: true,
        biomarkerTransportConfirmed: false,
        productPromotionAuthorized: false,
        r399CardPresent: false,
        schemaVersion: R399_LAYERING_READINESS_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        wearableIncrementValidated: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints pathless CLI errors when the output directory cannot be written", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      const blockedOutputDir = path.join(tmp, "not-a-directory");
      await writeFile(blockedOutputDir, "already a file\n");
      const result = spawnSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r399-layering-readiness.ts"),
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CRELES_OUTPUT_PATH: paths.crelesOutputPath,
          MURPH_AGE_MIDUS2_OUTPUT_PATH: paths.midus2OutputPath,
          MURPH_AGE_R399_PARAMS_PATH: paths.r399ParamsPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: blockedOutputDir,
          MURPH_AGE_TRANSPORT_OUTPUT_PATH: paths.transportOutputPath,
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Failed to write R399 layering readiness artifact.");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stderr).not.toContain(blockedOutputDir);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { transportConfirmed: boolean },
): Promise<{
  crelesOutputPath: string;
  midus2OutputPath: string;
  r399ParamsPath: string;
  transportOutputPath: string;
}> {
  await mkdir(tmp, { recursive: true });
  const r399ParamsPath = path.join(tmp, "r399.json");
  const midus2OutputPath = path.join(tmp, "midus2.json");
  const crelesOutputPath = path.join(tmp, "creles.json");
  const transportOutputPath = path.join(tmp, "transport.json");
  await Promise.all([
    writeJson(r399ParamsPath, {
      model_params_in_output_package: false,
      models: {
        r399_compact_age_nonlinear_l2_0p000: {
          coefficients: R399_FEATURES.map(() => 0.1),
          features: R399_FEATURES,
          intercept: -1,
          model_id: "r399_compact_age_nonlinear_l2_0p000",
          posthoc_calibration: { intercept: 0, mode: "intercept_slope", slope: 1 },
          role: "compact_ultralow_l2_candidate",
        },
      },
      predictions_in_this_artifact: false,
      row_values_in_this_artifact: false,
      schema_version: "murph.age.local.nhis-compact-ultralow-l2-models.r399.v0",
      stored_under_ignored_runtime_only: true,
    }),
    writeJson(midus2OutputPath, {
      models: {
        age_sex_reference: {
          splitMetrics: {
            test: metrics({ auc: 0.830756, brier: 0.062, logLoss: 0.218 }),
          },
        },
        lab5_lipid_body_no_crp: {
          splitMetrics: {
            test: metrics({ auc: 0.834765, brier: 0.061, logLoss: 0.216 }),
          },
        },
      },
    }),
    writeJson(crelesOutputPath, {
      models: {
        age_sex_reference: {
          splitMetrics: {
            test: metrics({ auc: 0.757075, brier: 0.1364, logLoss: 0.4341 }),
          },
        },
        lab5_lipid_body_no_crp: {
          splitMetrics: {
            test: metrics({ auc: 0.743568, brier: 0.1401, logLoss: 0.4452 }),
          },
        },
      },
    }),
    writeJson(transportOutputPath, {
      transportModels: {
        creles_age_sex_reference: {
          splitMetrics: {
            test: metrics({ auc: 0.753318, brier: 0.136428, logLoss: 0.434091 }),
          },
        },
        midus2_lab5_source_creles_recalibrated: {
          splitMetrics: {
            test: options.transportConfirmed
              ? metrics({ auc: 0.768318, brier: 0.132, logLoss: 0.42 })
              : metrics({ auc: 0.750641, brier: 0.136869, logLoss: 0.435778 }),
          },
        },
      },
    }),
  ]);
  return { crelesOutputPath, midus2OutputPath, r399ParamsPath, transportOutputPath };
}

async function addForbiddenInputDetails(paths: {
  crelesOutputPath: string;
  midus2OutputPath: string;
  r399ParamsPath: string;
  transportOutputPath: string;
}): Promise<void> {
  const r399 = JSON.parse(await readFile(paths.r399ParamsPath, "utf8"));
  r399.sourceText = "local codebook text that must not egress";

  const midus2 = JSON.parse(await readFile(paths.midus2OutputPath, "utf8"));
  midus2.rawRows = [{ M2ID: "private-row-id", value: 1 }];

  const creles = JSON.parse(await readFile(paths.crelesOutputPath, "utf8"));
  creles.models.lab5_lipid_body_no_crp.predictionById = { MRID: 0.42 };

  const transport = JSON.parse(await readFile(paths.transportOutputPath, "utf8"));
  transport.transportModels.midus2_lab5_source_creles_recalibrated.coefficients = [0.1, 0.2];

  await Promise.all([
    writeJson(paths.r399ParamsPath, r399),
    writeJson(paths.midus2OutputPath, midus2),
    writeJson(paths.crelesOutputPath, creles),
    writeJson(paths.transportOutputPath, transport),
  ]);
}

function metrics(input: { auc: number; brier: number; logLoss: number }) {
  return {
    auc: input.auc,
    brier: input.brier,
    events: 20,
    logLoss: input.logLoss,
    meanPrediction: 0.2,
    n: 100,
    observedRate: 0.2,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
