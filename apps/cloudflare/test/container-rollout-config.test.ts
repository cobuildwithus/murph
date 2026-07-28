import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildHostedWranglerDeployConfig,
  readHostedDeployAutomationEnvironment,
} from "../scripts/deploy-automation.js";
import { parseJsoncObject } from "./helpers/jsonc.js";

const EXPECTED_CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD = 300;
const EXPECTED_CONTAINER_ROLLOUT_STEP_PERCENTAGE = [10, 25, 50, 100];
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

describe("Cloudflare container rollout config", () => {
  it("renders conservative rollout defaults for hosted runner containers", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });
    const renderedConfig = buildHostedWranglerDeployConfig(environment) as {
      containers: Array<{
        rollout_active_grace_period?: number;
        rollout_step_percentage?: number[];
      }>;
    };

    expect(renderedConfig.containers[0]).toMatchObject({
      rollout_active_grace_period: EXPECTED_CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD,
      rollout_step_percentage: EXPECTED_CONTAINER_ROLLOUT_STEP_PERCENTAGE,
    });
  });

  it("renders a single deploy-smoke rollout step for the one-instance smoke container", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });
    const renderedConfig = buildHostedWranglerDeployConfig(environment) as {
      containers: Array<{
        class_name: string;
        max_instances: number;
        rollout_step_percentage?: number[];
      }>;
    };

    expect(renderedConfig.containers[1]).toMatchObject({
      class_name: "DeploySmokeRunnerContainer",
      max_instances: 1,
      rollout_step_percentage: [100],
    });
    expect(renderedConfig.containers[1]?.rollout_step_percentage).toHaveLength(
      renderedConfig.containers[1]?.max_instances ?? 0,
    );
  });

  it("keeps the checked-in wrangler scaffold aligned with the rendered rollout defaults", async () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });
    const renderedConfig = buildHostedWranglerDeployConfig(environment) as {
      containers: Array<{
        rollout_active_grace_period?: number;
        rollout_step_percentage?: number[];
      }>;
    };
    const checkedInConfig = parseJsoncObject(
      await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    ) as {
      containers: Array<{
        rollout_active_grace_period?: number;
        rollout_step_percentage?: number[];
      }>;
    };

    expect(checkedInConfig.containers[0]).toMatchObject({
      rollout_active_grace_period: renderedConfig.containers[0]?.rollout_active_grace_period,
      rollout_step_percentage: renderedConfig.containers[0]?.rollout_step_percentage,
    });
    expect(checkedInConfig.containers[1]).toMatchObject({
      rollout_active_grace_period: renderedConfig.containers[1]?.rollout_active_grace_period,
      rollout_step_percentage: renderedConfig.containers[1]?.rollout_step_percentage,
    });
  });
});
