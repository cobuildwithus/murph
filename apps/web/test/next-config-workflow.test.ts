import assert from "node:assert/strict";

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
