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
  it.each([
    { total: undefined, legacy: undefined, expectedMain: 1000, expectedLegacy: 0 },
    { total: "748", legacy: "100", expectedMain: 648, expectedLegacy: 100 },
    { total: "648", legacy: "0", expectedMain: 648, expectedLegacy: 0 },
    { total: "748", legacy: "0", expectedMain: 748, expectedLegacy: 0 },
    { total: "1", legacy: "0", expectedMain: 1, expectedLegacy: 0 },
    { total: "3", legacy: "1", expectedMain: 2, expectedLegacy: 1 },
    { total: "5", legacy: "2", expectedMain: 3, expectedLegacy: 2 },
    { total: "7", legacy: "3", expectedMain: 4, expectedLegacy: 3 },
  ])("conserves one member budget and legacy identity: %j", ({
    total, legacy, expectedMain, expectedLegacy,
  }) => {
    const source = {
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      CF_CONTAINER_MAX_INSTANCES: total,
      CF_LEGACY_STANDBY_CONTAINER_MAX_INSTANCES: legacy,
      HOSTED_EXECUTION_STANDBY_TARGET: String(Math.min(2, expectedMain)),
    };
    const config = buildHostedWranglerDeployConfig(readHostedDeployAutomationEnvironment(source));
    const containers = config.containers as Array<{
      class_name: string;
      max_instances: number;
      rollout_step_percentage?: number[];
    }>;
    expect(containers.map(({ class_name, max_instances }) => ({ class_name, max_instances }))).toEqual([
      { class_name: "RunnerContainer", max_instances: expectedMain },
      { class_name: "DeploySmokeRunnerContainer", max_instances: 1 },
      { class_name: "StandbyRunnerContainer", max_instances: expectedLegacy },
    ]);
    expect(containers.reduce((sum, container) => sum + container.max_instances, 0))
      .toBe(Number(total ?? "1000") + 1);
    expect(containers[0]).not.toHaveProperty("constraints");
    expect(config.vars).toMatchObject({
      HOSTED_EXECUTION_STANDBY_MODE: "off",
      HOSTED_EXECUTION_STANDBY_TARGET: String(Math.min(2, expectedMain)),
    });
    expect(config.vars).not.toHaveProperty("CF_CONTAINER_MAX_INSTANCES");
    expect(config.vars).not.toHaveProperty("CF_LEGACY_STANDBY_CONTAINER_MAX_INSTANCES");
    for (const container of containers) {
      if (container.max_instances === 0) {
        expect(container).not.toHaveProperty("rollout_step_percentage");
      } else {
        const steps = container.rollout_step_percentage!;
        expect(steps).toEqual([10, 25, 50, 100].slice(-Math.min(container.max_instances, 4)));
        expect(steps.length).toBeLessThanOrEqual(container.max_instances);
      }
    }
    expect(config.containers).toEqual(expect.arrayContaining([
      expect.objectContaining({ class_name: "StandbyRunnerContainer", constraints: { regions: ["ENAM"] } }),
    ]));
  });

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
    expect(checkedInConfig.containers[2]).toMatchObject({
      rollout_active_grace_period: renderedConfig.containers[2]?.rollout_active_grace_period,
    });
    expect(renderedConfig.containers[2]).not.toHaveProperty("rollout_step_percentage");
    expect(checkedInConfig.containers[2]).not.toHaveProperty("rollout_step_percentage");
  });
});
