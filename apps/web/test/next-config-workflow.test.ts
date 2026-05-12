import assert from "node:assert/strict";
import path from "node:path";

import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { test, vi } from "vitest";

const workflowMock = vi.hoisted(() => ({
  withWorkflow: vi.fn((config: unknown, options: unknown) => ({
    config,
    options,
    wrapped: true,
  })),
}));

vi.mock("workflow/next", () => ({
  withWorkflow: workflowMock.withWorkflow,
}));

test("next.config passes lazy discovery options into Workflow", async () => {
  vi.resetModules();
  workflowMock.withWorkflow.mockClear();

  const configModule = await import("../next.config");

  assert.equal(workflowMock.withWorkflow.mock.calls.length, 1);
  assert.deepEqual(workflowMock.withWorkflow.mock.calls[0]?.[1], {
    workflows: {
      lazyDiscovery: true,
    },
  });
  assert.deepEqual(configModule.default, {
    config: workflowMock.withWorkflow.mock.calls[0]?.[0],
    options: {
      workflows: {
        lazyDiscovery: true,
      },
    },
    wrapped: true,
  });
});

test("next.config config callback re-roots Workflow local-world data for dev", async () => {
  vi.resetModules();
  workflowMock.withWorkflow.mockClear();
  const previousTargetWorld = process.env.WORKFLOW_TARGET_WORLD;
  const previousDataDir = process.env.WORKFLOW_LOCAL_DATA_DIR;
  const previousDeploymentId = process.env.VERCEL_DEPLOYMENT_ID;

  try {
    process.env.WORKFLOW_TARGET_WORLD = "local";
    process.env.WORKFLOW_LOCAL_DATA_DIR = ".next/workflow-data";
    delete process.env.VERCEL_DEPLOYMENT_ID;

    await import("../next.config");
    const configCallback = workflowMock.withWorkflow.mock.calls[0]?.[0];

    assert.equal(typeof configCallback, "function");
    await (configCallback as (phase: string) => Promise<unknown>)(PHASE_DEVELOPMENT_SERVER);

    assert.equal(
      process.env.WORKFLOW_LOCAL_DATA_DIR,
      path.join(".next-dev", "workflow-data"),
    );
  } finally {
    restoreEnvValue("WORKFLOW_TARGET_WORLD", previousTargetWorld);
    restoreEnvValue("WORKFLOW_LOCAL_DATA_DIR", previousDataDir);
    restoreEnvValue("VERCEL_DEPLOYMENT_ID", previousDeploymentId);
  }
});

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
