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
          async readMissingRequiredSchemaColumns() {
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
          async readMissingRequiredSchemaColumns(connectionString) {
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
          async readMissingRequiredSchemaColumns(connectionString) {
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
          async readMissingRequiredSchemaColumns() {
            return [
              {
                tableName: "contaminant_thresholds",
                columnName: "comparison_scope",
              },
              {
                tableName: "contaminant_thresholds",
                columnName: "threshold_name",
              },
              {
                tableName: "product_contaminant_threshold_applications",
                columnName: "threshold_id",
              },
              {
                tableName: "product_tests",
                columnName: "source_key",
              },
            ];
          },
        },
      ),
    ).rejects.toThrow(
      `${PRODUCT_LABEL_RUNTIME_SCHEMA_REQUIRED_MESSAGE} Missing columns: contaminant_thresholds.comparison_scope, contaminant_thresholds.threshold_name, product_contaminant_threshold_applications.threshold_id, product_tests.source_key.`,
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
          async readMissingRequiredSchemaColumns() {
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
