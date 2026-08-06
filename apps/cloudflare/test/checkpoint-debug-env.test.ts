import { describe, expect, it } from "vitest";

import {
  HOSTED_WORKER_OPTIONAL_VAR_NAMES,
  readHostedDeployAutomationEnvironment,
} from "../scripts/deploy-automation.js";

const CHECKPOINT_DEBUG_VAR_NAMES = [
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS",
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE",
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG",
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT",
  "MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW",
] as const;

const REQUIRED_HOSTED_CRYPTO_WORKER_VARS = {
  CF_PUBLIC_BASE_URL: "https://murph-hosted.cobuildwithus.workers.dev",
  HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
  HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
    "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:v1",
  HOSTED_CRYPTO_ENV: "production",
  HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2-account-test",
  HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles",
} as const;

describe("hosted checkpoint debug deploy env", () => {
  it("passes optional checkpoint debug vars into worker vars", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE: "/tmp/checkpoint-debug.json",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT: "20000",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW: "1",
    });

    expect(HOSTED_WORKER_OPTIONAL_VAR_NAMES).toEqual(
      expect.arrayContaining([...CHECKPOINT_DEBUG_VAR_NAMES]),
    );
    expect(environment.workerVars).toMatchObject({
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_FILE: "/tmp/checkpoint-debug.json",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG: "1",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_LIMIT: "20000",
      MURPH_HOSTED_CHECKPOINT_DEBUG_PATHS_LOG_RAW: "1",
    });
  });
});
