import { describe, expect, it } from "vitest";

import {
  assertProductLabelRuntimeEnv,
  listProductLabelRuntimeEnvErrors,
  PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE,
} from "../scripts/check-product-label-runtime-env";

describe("product label runtime env preflight", () => {
  it("fails production builds without the shared labels database URL", () => {
    expect(() =>
      assertProductLabelRuntimeEnv({
        VERCEL_ENV: "production",
        MURPH_SUPPLEMENT_DB_URL: "postgres://legacy.example.test/supplements",
      }),
    ).toThrow(PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE);
  });

  it("does not require product label env for local builds", () => {
    expect(
      listProductLabelRuntimeEnvErrors({
        MURPH_SUPPLEMENT_DB_URL: "postgres://legacy.example.test/supplements",
      }),
    ).toEqual([]);
  });

  it("accepts the shared labels database URL in production", () => {
    expect(
      listProductLabelRuntimeEnvErrors({
        VERCEL_ENV: "production",
        MURPH_LABELS_DB_URL: "postgres://labels.example.test/labels",
        MURPH_SUPPLEMENT_DB_URL: "postgres://legacy.example.test/supplements",
      }),
    ).toEqual([]);
  });

  it("supports an explicit release-check override outside Vercel production", () => {
    expect(() =>
      assertProductLabelRuntimeEnv({
        MURPH_REQUIRE_PRODUCT_LABELS_DB: "1",
      }),
    ).toThrow(PRODUCT_LABEL_RUNTIME_ENV_REQUIRED_MESSAGE);
  });
});
