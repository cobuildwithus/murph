import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildHostedWranglerDeployConfig,
  readHostedDeployAutomationEnvironment,
} from "../scripts/deploy-automation.js";

const EXPECTED_CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD = 0;
const EXPECTED_CONTAINER_ROLLOUT_STEP_PERCENTAGE = [100];

function parseJsoncObject(rawConfig: string): Record<string, unknown> {
  return JSON.parse(
    rawConfig
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
      .replace(/,\s*([}\]])/gu, "$1"),
  ) as Record<string, unknown>;
}

describe("Cloudflare container rollout config", () => {
  it("renders all-at-once rollout defaults for hosted runner containers", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
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

  it("keeps the checked-in wrangler scaffold aligned with the rendered rollout defaults", async () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
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
  });
});
