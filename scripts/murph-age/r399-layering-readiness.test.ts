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
import {
  FROZEN_R399_FEATURE_KEYS,
  R399_LOCAL_MODEL_CARD_FILENAME,
  runR399LocalModelCardExport,
  type FrozenR399FeatureKey,
} from "./r399-local-model-card.ts";

const R399_FEATURES = FROZEN_R399_FEATURE_KEYS;

describe("R399 layering readiness runner", () => {
  it("summarizes the frozen anchor and blocks product layering when transport is not confirmed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      const { output, outputPath } = await runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r399ModelCardPath: path.join(tmp, "missing-model-card.json"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r399-layering-readiness.latest.json");
      expect(output.schemaVersion).toBe(R399_LAYERING_READINESS_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.anchor).toMatchObject({
        coefficientCountStored: false,
        committedCalculatorCardPresent: true,
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
        localModelCardPresent: false,
        modelId: "r399_compact_age_nonlinear_l2_0p000",
        modelParametersStored: false,
        present: true,
        privateRuntimeParamsRequired: true,
      });
      expect(output.gates.r399AnchorPresent.status).toBe("passed");
      expect(output.gates.calculatorScorePathReady.status).toBe("blocked");
      expect(output.gates.calculatorScorePathReady.reason).toContain("ignored local R399 model-card artifact");
      expect(output.gates.biomarkerTransportConfirmed.status).toBe("blocked");
      expect(output.gates.wearableIncrementValidated.status).toBe("blocked");
      expect(output.productPromotionAuthorized).toBe(false);
      expect(output.evidence.biomarkerIncrement.map((entry) => entry.sourceId)).toEqual([
        "midus2-lab5-internal",
        "midus-refresher-r399-lab3-internal",
        "creles-lab5-local",
        "midus2-lab5-to-creles-transport",
      ]);
      expect(output.evidence.biomarkerIncrement[0]?.verdict).toBe("promising_internal_only");
      expect(output.evidence.biomarkerIncrement[1]?.verdict).toBe("promising_internal_only");
      expect(output.evidence.biomarkerIncrement[3]?.verdict).toBe("not_promotable");
      expect(output.evidence.biomarkerIncrement[3]?.comparison).toEqual({
        aucDelta: -0.002677,
        brierDelta: 0.000441,
        logLossDelta: 0.001687,
        modelId: "midus2_lab5_source_creles_recalibrated",
        referenceModelId: "creles_age_sex_reference",
      });
      expect(output.nextLoop.candidateBatch).toMatchObject({
        batchId: "r600-frozen-anchor-residual-increment-batch",
        selectionPolicy: "predeclared-small-batch",
        status: "frozen-research-only",
      });
      expect(output.nextLoop.candidateBatch.candidates).toEqual([
        { id: "r399-anchor-research-comparator", role: "reference", scoreBearing: true },
        { id: "r399-plus-compact-bloodwork-residual", role: "proposal", scoreBearing: true },
        { id: "r399-plus-compact-bloodwork-body-residual", role: "proposal", scoreBearing: true },
        { id: "wearable-shadow-qc-only", role: "shadow", scoreBearing: false },
        { id: "age-like-display-abstain", role: "abstain_display", scoreBearing: false },
      ]);
      expect(output.nextLoop.sourceRoles).toContainEqual({
        id: "midus-refresher",
        optimizationAllowed: false,
        role: "internal_replication",
      });
      expect(output.nextLoop.reviewGate.nextGate).toBe("aggregate-results");
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

  it("passes the calculator score-path gate when the ignored local R399 model card is present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      const modelCardOutputDir = path.join(tmp, "model-cards");
      const { artifactPath } = await runR399LocalModelCardExport({
        createdAt: "2026-05-12T00:00:00.000Z",
        modelCardOutputDir,
        paramsPath: paths.r399ParamsPath,
      });
      expect(path.basename(artifactPath)).toBe(R399_LOCAL_MODEL_CARD_FILENAME);

      const { output, outputPath } = await runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r399ModelCardPath: artifactPath,
        ...paths,
      });

      expect(output.anchor.localModelCardPresent).toBe(true);
      expect(output.gates.calculatorScorePathReady.status).toBe("passed");
      expect(output.gates.productPromotionReady.status).toBe("blocked");
      expect(output.productPromotionAuthorized).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(artifactPath);
      expect(persisted).not.toContain(modelCardOutputDir);
      expect(persisted).not.toContain("coefficients\":");
      expect(persisted).not.toContain("referenceRiskCurve");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects a stale local R399 model-card artifact that does not match the frozen params", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      const { artifactPath } = await runR399LocalModelCardExport({
        createdAt: "2026-05-12T00:00:00.000Z",
        modelCardOutputDir: path.join(tmp, "model-cards"),
        paramsPath: paths.r399ParamsPath,
      });
      const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
      artifact.model.features[0].coefficient = artifact.model.features[0].coefficient + 0.01;
      await writeJson(artifactPath, artifact);

      await expect(runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r399ModelCardPath: artifactPath,
        ...paths,
      })).rejects.toThrow("R399 local model-card artifact does not match the frozen R399 parameter artifact.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects schema-invalid, policy-invalid, and anchor-invalid local R399 model cards", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-layering-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { transportConfirmed: false });
      const modelCardOutputDir = path.join(tmp, "model-cards");
      const { artifactPath } = await runR399LocalModelCardExport({
        createdAt: "2026-05-12T00:00:00.000Z",
        modelCardOutputDir,
        paramsPath: paths.r399ParamsPath,
      });

      const schemaInvalidPath = path.join(modelCardOutputDir, "schema-invalid.json");
      await writeJson(schemaInvalidPath, { schemaVersion: "bad" });
      await expect(runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out-schema"),
        r399ModelCardPath: schemaInvalidPath,
        ...paths,
      })).rejects.toThrow("R399 local model-card artifact does not match the expected schema.");

      const policyInvalidPath = path.join(modelCardOutputDir, "policy-invalid.json");
      const policyInvalid = JSON.parse(await readFile(artifactPath, "utf8"));
      policyInvalid.cardId = "lab5_bp_bmi_transport_research";
      await writeJson(policyInvalidPath, policyInvalid);
      await expect(runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out-policy"),
        r399ModelCardPath: policyInvalidPath,
        ...paths,
      })).rejects.toThrow("R399 local model-card artifact does not match the committed R399 policy.");

      const anchorInvalidPath = path.join(modelCardOutputDir, "anchor-invalid.json");
      const anchorInvalid = JSON.parse(await readFile(artifactPath, "utf8"));
      anchorInvalid.model.modelId = "not-r399";
      await writeJson(anchorInvalidPath, anchorInvalid);
      await expect(runR399LayeringReadiness({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out-anchor"),
        r399ModelCardPath: anchorInvalidPath,
        ...paths,
      })).rejects.toThrow("R399 local model-card artifact does not match the frozen R399 anchor.");
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
        r399ModelCardPath: path.join(tmp, "missing-model-card.json"),
        ...paths,
      });

      expect(output.gates.biomarkerTransportConfirmed.status).toBe("passed");
      expect(output.evidence.biomarkerIncrement[3]?.verdict).toBe("transport_confirmed");
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
        r399ModelCardPath: path.join(tmp, "missing-model-card.json"),
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
        r399ModelCardPath: path.join(tmp, "missing-model-card.json"),
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
        r399ModelCardPath: path.join(tmp, "missing-model-card.json"),
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
          MURPH_AGE_MIDUS_REFRESHER_OUTPUT_PATH: paths.midusRefresherOutputPath,
          MURPH_AGE_R399_MODEL_CARD_PATH: path.join(tmp, "missing-model-card.json"),
          MURPH_AGE_R399_PARAMS_PATH: paths.r399ParamsPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
          MURPH_AGE_TRANSPORT_OUTPUT_PATH: paths.transportOutputPath,
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({
        anchorPresent: true,
        biomarkerTransportConfirmed: false,
        calculatorScorePathReady: false,
        localModelCardPresent: false,
        productPromotionAuthorized: false,
        r399CardPresent: true,
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
          MURPH_AGE_R399_MODEL_CARD_PATH: path.join(tmp, "missing-model-card.json"),
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
  midusRefresherOutputPath: string;
  r399ParamsPath: string;
  transportOutputPath: string;
}> {
  await mkdir(tmp, { recursive: true });
  const r399ParamsPath = path.join(tmp, "r399.json");
  const midus2OutputPath = path.join(tmp, "midus2.json");
  const midusRefresherOutputPath = path.join(tmp, "midus-refresher.json");
  const crelesOutputPath = path.join(tmp, "creles.json");
  const transportOutputPath = path.join(tmp, "transport.json");
  await Promise.all([
    writeJson(r399ParamsPath, {
      model_params_in_output_package: false,
      models: {
        r399_compact_age_nonlinear_l2_0p000: {
          coefficients: R399_FEATURES.map((feature) => SYNTHETIC_R399_WEIGHTS[feature]),
          features: R399_FEATURES,
          imputation_medians: SYNTHETIC_R399_MEDIANS,
          intercept: -1,
          model_id: "r399_compact_age_nonlinear_l2_0p000",
          posthoc_calibration: { intercept: 0, mode: "intercept_slope", slope: 1 },
          role: "compact_ultralow_l2_candidate",
          standardization_means: SYNTHETIC_R399_MEANS,
          standardization_stds: SYNTHETIC_R399_STDS,
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
    writeJson(midusRefresherOutputPath, {
      models: {
        r399_anchor_recalibrated: {
          splitMetrics: {
            test: metrics({ auc: 0.66447, brier: 0.032621, logLoss: 0.145832 }),
          },
        },
        r399_plus_lab3_bmi_increment: {
          splitMetrics: {
            test: metrics({ auc: 0.75219, brier: 0.032183, logLoss: 0.141327 }),
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
  return { crelesOutputPath, midus2OutputPath, midusRefresherOutputPath, r399ParamsPath, transportOutputPath };
}

async function addForbiddenInputDetails(paths: {
  crelesOutputPath: string;
  midus2OutputPath: string;
  midusRefresherOutputPath: string;
  r399ParamsPath: string;
  transportOutputPath: string;
}): Promise<void> {
  const r399 = JSON.parse(await readFile(paths.r399ParamsPath, "utf8"));
  r399.sourceText = "local codebook text that must not egress";

  const midus2 = JSON.parse(await readFile(paths.midus2OutputPath, "utf8"));
  midus2.rawRows = [{ M2ID: "private-row-id", value: 1 }];

  const midusRefresher = JSON.parse(await readFile(paths.midusRefresherOutputPath, "utf8"));
  midusRefresher.rawRows = [{ MRID: "private-row-id", value: 1 }];

  const creles = JSON.parse(await readFile(paths.crelesOutputPath, "utf8"));
  creles.models.lab5_lipid_body_no_crp.predictionById = { MRID: 0.42 };

  const transport = JSON.parse(await readFile(paths.transportOutputPath, "utf8"));
  transport.transportModels.midus2_lab5_source_creles_recalibrated.coefficients = [0.1, 0.2];

  await Promise.all([
    writeJson(paths.r399ParamsPath, r399),
    writeJson(paths.midus2OutputPath, midus2),
    writeJson(paths.midusRefresherOutputPath, midusRefresher),
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

// Synthetic, hand-authored fixture values. These are not copied from the private R399 artifact.
const SYNTHETIC_R399_MEANS = {
  age_x_sex_female: 30,
  age_years: 55,
  age_years_squared: 3250,
  body_mass_index: 27,
  body_mass_index_missing: 0.04,
  diabetes_history_proxy_missing: 0.03,
  diabetes_history_proxy_yes: 0.12,
  hypertension_history_proxy_missing: 0.03,
  hypertension_history_proxy_yes: 0.28,
  physical_activity_proxy: 2,
  physical_activity_proxy_missing: 0.06,
  self_rated_health: 3,
  self_rated_health_missing: 0.05,
  sex_female: 0.52,
  smoking_status_proxy: 1,
  smoking_status_proxy_missing: 0.04,
} satisfies Record<FrozenR399FeatureKey, number>;

const SYNTHETIC_R399_STDS = {
  age_x_sex_female: 28,
  age_years: 14,
  age_years_squared: 1600,
  body_mass_index: 5,
  body_mass_index_missing: 0.2,
  diabetes_history_proxy_missing: 0.17,
  diabetes_history_proxy_yes: 0.32,
  hypertension_history_proxy_missing: 0.17,
  hypertension_history_proxy_yes: 0.45,
  physical_activity_proxy: 1,
  physical_activity_proxy_missing: 0.24,
  self_rated_health: 1,
  self_rated_health_missing: 0.22,
  sex_female: 0.5,
  smoking_status_proxy: 0.8,
  smoking_status_proxy_missing: 0.2,
} satisfies Record<FrozenR399FeatureKey, number>;

const SYNTHETIC_R399_MEDIANS = {
  age_x_sex_female: 0,
  age_years: 55,
  age_years_squared: 3025,
  body_mass_index: 27,
  body_mass_index_missing: 0,
  diabetes_history_proxy_missing: 0,
  diabetes_history_proxy_yes: 0,
  hypertension_history_proxy_missing: 0,
  hypertension_history_proxy_yes: 0,
  physical_activity_proxy: 2,
  physical_activity_proxy_missing: 0,
  self_rated_health: 3,
  self_rated_health_missing: 0,
  sex_female: 1,
  smoking_status_proxy: 1,
  smoking_status_proxy_missing: 0,
} satisfies Record<FrozenR399FeatureKey, number>;

const SYNTHETIC_R399_WEIGHTS = {
  age_x_sex_female: -0.03,
  age_years: 0.9,
  age_years_squared: 0.08,
  body_mass_index: 0.04,
  body_mass_index_missing: 0.01,
  diabetes_history_proxy_missing: 0.01,
  diabetes_history_proxy_yes: 0.16,
  hypertension_history_proxy_missing: 0.01,
  hypertension_history_proxy_yes: 0.12,
  physical_activity_proxy: -0.08,
  physical_activity_proxy_missing: 0.01,
  self_rated_health: 0.14,
  self_rated_health_missing: 0.01,
  sex_female: -0.11,
  smoking_status_proxy: 0.13,
  smoking_status_proxy_missing: 0.01,
} satisfies Record<FrozenR399FeatureKey, number>;
