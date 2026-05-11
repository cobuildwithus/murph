import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  parseMurphAgeLocalModelCardArtifact,
  validateMurphAgeLocalModelCardArtifactPolicy,
} from "@murphai/health-metrics";
import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  FROZEN_R399_FEATURE_KEYS,
  FROZEN_R399_MODEL_ID,
  R399_LOCAL_MODEL_CARD_EXPORT_SCHEMA_VERSION,
  R399_LOCAL_MODEL_CARD_FILENAME,
  R399_RESEARCH_CARD_ID,
  runR399LocalModelCardExport,
  type FrozenR399FeatureKey,
} from "./r399-local-model-card.ts";

describe("R399 local model-card exporter", () => {
  it("writes a policy-valid ignored local R399 model-card artifact from local params", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-card-"));
    try {
      const paramsPath = path.join(tmp, "r399-params.json");
      const outputDir = path.join(tmp, "model-cards");
      await writeSyntheticR399Params(paramsPath);

      const { artifactPath, summary } = await runR399LocalModelCardExport({
        createdAt: "2026-05-12T00:00:00.000Z",
        modelCardOutputDir: outputDir,
        paramsPath,
      });

      expect(path.basename(artifactPath)).toBe(R399_LOCAL_MODEL_CARD_FILENAME);
      expect(summary).toEqual({
        artifact: R399_LOCAL_MODEL_CARD_FILENAME,
        cardId: R399_RESEARCH_CARD_ID,
        coefficientsStored: false,
        featureCount: FROZEN_R399_FEATURE_KEYS.length,
        localPathsStored: false,
        modelId: FROZEN_R399_MODEL_ID,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        rowValuesStored: false,
        schemaVersion: R399_LOCAL_MODEL_CARD_EXPORT_SCHEMA_VERSION,
        sourceBodiesStored: false,
        splitMembershipStored: false,
        status: "research-local-model-card-ready",
      });
      expect(findForbiddenAggregateEgress(summary)).toEqual([]);

      const persisted = JSON.parse(await readFile(artifactPath, "utf8"));
      expect(persisted.schemaVersion).toBe(MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION);
      expect(persisted.cardId).toBe(R399_RESEARCH_CARD_ID);
      expect(persisted.model.modelId).toBe(FROZEN_R399_MODEL_ID);
      expect(persisted.model.features).toHaveLength(FROZEN_R399_FEATURE_KEYS.length);
      expect(persisted.model.features.some((feature: { key?: string; kind?: string }) =>
        feature.key === "age-squared" && feature.kind === "chronological-age-squared"
      )).toBe(true);
      expect(persisted.model.features.some((feature: { key?: string; kind?: string }) =>
        feature.key === "age-x-female" && feature.kind === "age-sex-interaction"
      )).toBe(true);
      expect(persisted.model.features.every((feature: { transform?: { kind?: string } }) =>
        feature.transform?.kind === "z-score"
      )).toBe(true);
      expect(isMonotonicRiskCurve(persisted.model.referenceRiskCurve)).toBe(true);

      const parsed = parseMurphAgeLocalModelCardArtifact(persisted);
      expect(parsed.warnings).toEqual([]);
      expect(parsed.value ? validateMurphAgeLocalModelCardArtifactPolicy(parsed.value) : null).toEqual([]);

      const encodedSummary = JSON.stringify(summary);
      expect(encodedSummary).not.toContain(tmp);
      expect(encodedSummary).not.toContain("intercept");
      expect(encodedSummary).not.toContain("referenceRiskCurve");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints only a pathless aggregate CLI receipt", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-card-cli-"));
    try {
      const paramsPath = path.join(tmp, "r399-params.json");
      const outputDir = path.join(tmp, "model-cards");
      await writeSyntheticR399Params(paramsPath);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r399-local-model-card.ts"),
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_MODEL_CARD_OUTPUT_DIR: outputDir,
          MURPH_AGE_R399_PARAMS_PATH: paramsPath,
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toMatchObject({
        artifact: R399_LOCAL_MODEL_CARD_FILENAME,
        cardId: R399_RESEARCH_CARD_ID,
        featureCount: FROZEN_R399_FEATURE_KEYS.length,
        modelId: FROZEN_R399_MODEL_ID,
        schemaVersion: R399_LOCAL_MODEL_CARD_EXPORT_SCHEMA_VERSION,
        status: "research-local-model-card-ready",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("intercept");
      expect(stdout).not.toContain("referenceRiskCurve");
      expect(await exists(path.join(outputDir, R399_LOCAL_MODEL_CARD_FILENAME))).toBe(true);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects output outside ignored local runtime roots", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-card-"));
    try {
      const paramsPath = path.join(tmp, "r399-params.json");
      await writeSyntheticR399Params(paramsPath);

      await expect(runR399LocalModelCardExport({
        modelCardOutputDir: path.join(process.cwd(), "output-packages", "bad-model-cards"),
        paramsPath,
      })).rejects.toThrow("R399 local model-card output must target an ignored local runtime model-card directory.");

      await expect(runR399LocalModelCardExport({
        modelCardOutputDir: path.join(process.cwd(), "output-packages", ".runtime", "operations", "murph-age", "model-cards"),
        paramsPath,
      })).rejects.toThrow("R399 local model-card output must target an ignored local runtime model-card directory.");

      const symlinkPath = path.join(tmp, "repo-link");
      await symlink(process.cwd(), symlinkPath, "dir");
      await expect(runR399LocalModelCardExport({
        modelCardOutputDir: path.join(symlinkPath, ".runtime", "operations", "murph-age", "model-cards"),
        paramsPath,
      })).rejects.toThrow("R399 local model-card output must target an ignored local runtime model-card directory.");

      const tempGitRoot = path.join(tmp, "temp-git-root");
      await mkdir(path.join(tempGitRoot, ".git"), { recursive: true });
      await expect(runR399LocalModelCardExport({
        modelCardOutputDir: path.join(tempGitRoot, ".runtime", "operations", "murph-age", "model-cards"),
        paramsPath,
      })).rejects.toThrow("R399 local model-card output must target an ignored local runtime model-card directory.");

      const allowedDir = path.join(tmp, "safe-model-cards");
      const unsafeTarget = path.join(process.cwd(), "output-packages", "unsafe-r399-card.json");
      await mkdir(allowedDir, { recursive: true });
      await symlink(unsafeTarget, path.join(allowedDir, R399_LOCAL_MODEL_CARD_FILENAME));
      await expect(runR399LocalModelCardExport({
        modelCardOutputDir: allowedDir,
        paramsPath,
      })).rejects.toThrow("Failed to write R399 local model-card artifact.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects row-bearing or non-frozen local parameter artifacts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-card-"));
    try {
      const rowParamsPath = path.join(tmp, "r399-row-params.json");
      await writeSyntheticR399Params(rowParamsPath, { rowValuesInArtifact: true });
      await expect(runR399LocalModelCardExport({
        modelCardOutputDir: path.join(tmp, "model-cards"),
        paramsPath: rowParamsPath,
      })).rejects.toThrow("R399 local parameter artifact must attest that row values and predictions are absent.");

      const mutatedParamsPath = path.join(tmp, "r399-mutated-params.json");
      await writeSyntheticR399Params(mutatedParamsPath, { dropLastFeature: true });
      await expect(runR399LocalModelCardExport({
        modelCardOutputDir: path.join(tmp, "model-cards"),
        paramsPath: mutatedParamsPath,
      })).rejects.toThrow("Frozen R399 feature set does not match the expected allowlist.");

      const unknownFeatureParamsPath = path.join(tmp, "r399-unknown-feature-params.json");
      await writeSyntheticR399Params(unknownFeatureParamsPath, { replaceFirstFeatureWithUnknown: true });
      await expect(runR399LocalModelCardExport({
        modelCardOutputDir: path.join(tmp, "model-cards"),
        paramsPath: unknownFeatureParamsPath,
      })).rejects.toThrow("Frozen R399 feature set does not match the expected allowlist.");

      const unsupportedCalibrationPath = path.join(tmp, "r399-unsupported-calibration.json");
      await writeSyntheticR399Params(unsupportedCalibrationPath, { calibrationMode: "unsupported_mode" });
      await expect(runR399LocalModelCardExport({
        modelCardOutputDir: path.join(tmp, "model-cards"),
        paramsPath: unsupportedCalibrationPath,
      })).rejects.toThrow("Frozen R399 posthoc calibration mode must be intercept_slope.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects every local parameter privacy attestation failure", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-card-"));
    try {
      const cases = [
        {
          error: "R399 local parameter artifact must attest that it stays under ignored runtime only.",
          file: "runtime-attestation.json",
          options: { storedUnderIgnoredRuntimeOnly: false },
        },
        {
          error: "R399 local parameter artifact must attest that row values and predictions are absent.",
          file: "predictions-attestation.json",
          options: { predictionsInArtifact: true },
        },
        {
          error: "R399 local parameter artifact must attest that model params are not in output packages.",
          file: "output-package-attestation.json",
          options: { modelParamsInOutputPackage: true },
        },
      ] as const;

      for (const testCase of cases) {
        const paramsPath = path.join(tmp, testCase.file);
        await writeSyntheticR399Params(paramsPath, testCase.options);
        await expect(runR399LocalModelCardExport({
          modelCardOutputDir: path.join(tmp, "model-cards"),
          paramsPath,
        })).rejects.toThrow(testCase.error);
      }
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints pathless CLI errors", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r399-card-cli-error-"));
    try {
      const paramsPath = path.join(tmp, "r399-params.json");
      await writeSyntheticR399Params(paramsPath, { rowValuesInArtifact: true });
      const result = spawnSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r399-local-model-card.ts"),
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_MODEL_CARD_OUTPUT_DIR: path.join(tmp, "model-cards"),
          MURPH_AGE_R399_PARAMS_PATH: paramsPath,
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("R399 local parameter artifact must attest");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stderr).not.toContain(paramsPath);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeSyntheticR399Params(
  filePath: string,
  options: {
    calibrationMode?: string;
    dropLastFeature?: boolean;
    modelParamsInOutputPackage?: boolean;
    predictionsInArtifact?: boolean;
    replaceFirstFeatureWithUnknown?: boolean;
    rowValuesInArtifact?: boolean;
    storedUnderIgnoredRuntimeOnly?: boolean;
  } = {},
): Promise<void> {
  const features = options.dropLastFeature
    ? FROZEN_R399_FEATURE_KEYS.slice(0, FROZEN_R399_FEATURE_KEYS.length - 1)
    : options.replaceFirstFeatureWithUnknown
      ? ["synthetic_unknown_feature", ...FROZEN_R399_FEATURE_KEYS.slice(1)]
      : [...FROZEN_R399_FEATURE_KEYS];
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({
    model_params_in_output_package: options.modelParamsInOutputPackage === true,
    models: {
      [FROZEN_R399_MODEL_ID]: {
        coefficients: features.map((feature) => syntheticR399Weight(feature)),
        features,
        imputation_medians: SYNTHETIC_R399_MEDIANS,
        intercept: -4.1,
        model_id: FROZEN_R399_MODEL_ID,
        posthoc_calibration: { intercept: 0.03, mode: options.calibrationMode ?? "intercept_slope", slope: 0.97 },
        role: "compact_ultralow_l2_candidate",
        standardization_means: SYNTHETIC_R399_MEANS,
        standardization_stds: SYNTHETIC_R399_STDS,
      },
    },
    predictions_in_this_artifact: options.predictionsInArtifact === true,
    row_values_in_this_artifact: options.rowValuesInArtifact === true,
    schema_version: "murph.age.local.nhis-compact-ultralow-l2-models.r399.v0",
    stored_under_ignored_runtime_only: options.storedUnderIgnoredRuntimeOnly !== false,
  }, null, 2)}\n`);
}

function isMonotonicRiskCurve(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) return false;
  let previousRisk = 0;
  for (const point of value) {
    if (!point || typeof point !== "object" || Array.isArray(point)) return false;
    const record = point as { ageYears?: unknown; riskProbability?: unknown };
    if (typeof record.ageYears !== "number" || typeof record.riskProbability !== "number") return false;
    if (!Number.isFinite(record.ageYears) || !Number.isFinite(record.riskProbability)) return false;
    if (record.riskProbability < previousRisk) return false;
    previousRisk = record.riskProbability;
  }
  return true;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

function syntheticR399Weight(feature: string): number {
  return feature in SYNTHETIC_R399_WEIGHTS
    ? SYNTHETIC_R399_WEIGHTS[feature as FrozenR399FeatureKey]
    : 0.01;
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
