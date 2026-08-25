import { describe, expect, it } from "vitest";

import {
  assertProductLabelRuntimeEnv,
  listProductLabelRuntimeEnvErrors,
  PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE,
  PRODUCT_LABEL_RUNTIME_SCHEMA_REQUIRED_MESSAGE,
  PRODUCT_LABEL_RUNTIME_SCHEMA_VERIFY_FAILED_MESSAGE,
} from "../scripts/check-product-label-runtime-env";

describe("product label runtime env preflight", () => {
  it("fails production builds without the shared labels database URL", async () => {
    await expect(
      assertProductLabelRuntimeEnv({
        VERCEL_ENV: "production",
        MURPH_SUPPLEMENT_DB_URL: "postgres://legacy.example.test/supplements",
      }),
    ).rejects.toThrow(PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE);
  });

  it("does not require product label env for local builds", async () => {
    await expect(
      listProductLabelRuntimeEnvErrors(
        {
          MURPH_SUPPLEMENT_DB_URL: "postgres://legacy.example.test/supplements",
        },
        {
          async readRequiredSchemaProblems() {
            throw new Error("local builds should not query labels schema");
          },
        },
      ),
    ).resolves.toEqual([]);
  });

  it("accepts the shared labels database URL and complete schema in production", async () => {
    await expect(
      listProductLabelRuntimeEnvErrors(
        {
          VERCEL_ENV: "production",
          MURPH_LABELS_DB_URL: "postgres://labels.example.test/labels",
          MURPH_SUPPLEMENT_DB_URL: "postgres://legacy.example.test/supplements",
        },
        {
          async readRequiredSchemaProblems(connectionString) {
            expect(connectionString).toBe("postgres://labels.example.test/labels");
            return [];
          },
        },
      ),
    ).resolves.toEqual([]);
  });

  it("normalizes system SSL markers before schema preflight", async () => {
    await expect(
      listProductLabelRuntimeEnvErrors(
        {
          VERCEL_ENV: "production",
          MURPH_LABELS_DB_URL:
            "postgres://labels.example.test/labels?sslrootcert=system&sslcert=system&sslkey=system&connect_timeout=10",
        },
        {
          async readRequiredSchemaProblems(connectionString) {
            expect(connectionString).toBe(
              "postgres://labels.example.test/labels?connect_timeout=10",
            );
            return [];
          },
        },
      ),
    ).resolves.toEqual([]);
  });

  it("fails production builds when contaminant schema columns are missing", async () => {
    await expect(
      assertProductLabelRuntimeEnv(
        {
          VERCEL_ENV: "production",
          MURPH_LABELS_DB_URL: "postgres://labels.example.test/labels",
        },
        {
          async readRequiredSchemaProblems() {
            return [
              {
                kind: "column",
                name: "foods.serving_grams",
                reason: "missing",
              },
              {
                kind: "column",
                name: "contaminant_thresholds.threshold_name",
                reason: "missing",
              },
              {
                kind: "column",
                name: "contaminant_thresholds.threshold_value",
                reason: "missing",
              },
              {
                kind: "column",
                name: "product_tests.source_key",
                reason: "missing",
              },
            ];
          },
        },
      ),
    ).rejects.toThrow(
      `${PRODUCT_LABEL_RUNTIME_SCHEMA_REQUIRED_MESSAGE} Missing or invalid objects: foods.serving_grams (missing), contaminant_thresholds.threshold_name (missing), contaminant_thresholds.threshold_value (missing), product_tests.source_key (missing).`,
    );
  });

  it("fails production builds for missing, interrupted, or wrong food-search indexes", async () => {
    await expect(
      assertProductLabelRuntimeEnv(
        {
          VERCEL_ENV: "production",
          MURPH_LABELS_DB_URL: "postgres://labels.example.test/labels",
        },
        {
          async readRequiredSchemaProblems() {
            return [
              {
                kind: "index",
                name: "foods_name_rank_idx",
                reason: "missing",
              },
              {
                kind: "index",
                name: "foods_name_exact_rank_idx",
                reason: "not_live",
              },
              {
                kind: "index",
                name: "foods_canonical_rank_idx",
                reason: "wrong_definition",
              },
            ];
          },
        },
      ),
    ).rejects.toThrow(
      "foods_name_rank_idx (missing), foods_name_exact_rank_idx (not_live), foods_canonical_rank_idx (wrong_definition)",
    );
  });

  it("fails production builds when schema verification cannot run", async () => {
    await expect(
      assertProductLabelRuntimeEnv(
        {
          VERCEL_ENV: "production",
          MURPH_LABELS_DB_URL: "postgres://labels.example.test/labels",
        },
        {
          async readRequiredSchemaProblems() {
            throw new Error("network unavailable");
          },
        },
      ),
    ).rejects.toThrow(PRODUCT_LABEL_RUNTIME_SCHEMA_VERIFY_FAILED_MESSAGE);
  });

  it("supports an explicit release-check override outside Vercel production", async () => {
    await expect(
      assertProductLabelRuntimeEnv({
        MURPH_REQUIRE_PRODUCT_LABELS_DB: "1",
        MURPH_SUPPLEMENT_DB_URL: "postgres://legacy.example.test/supplements",
      }),
    ).rejects.toThrow(PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE);
  });
});
