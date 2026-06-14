import path from "node:path";
import { fileURLToPath } from "node:url";

import { Worker } from "@temporalio/worker";
import { describe, it } from "vitest";

import {
  createPreReconcileMailboxReplayHistoryFixture,
} from "./fixtures/replay/hosted-user-runtime-pre-reconcile-mailbox-history.js";

const workflowsPath = fileURLToPath(
  new URL("../src/workflows/index.ts", import.meta.url),
);
const hostedExecutionSourceDir = fileURLToPath(
  new URL("../../hosted-execution/src", import.meta.url),
);

describe("hostedUserRuntimeWorkflow replay compatibility", () => {
  it("replays pre-patch mailbox histories that scheduled runtime processing directly", async () => {
    const fixture = createPreReconcileMailboxReplayHistoryFixture();

    await Worker.runReplayHistory(
      {
        bundlerOptions: {
          webpackConfigHook: (config) => ({
            ...config,
            resolve: {
              ...(config.resolve ?? {}),
              alias: {
                ...readWebpackAlias(config.resolve?.alias),
                "@murphai/hosted-execution/orchestration-control":
                  path.join(hostedExecutionSourceDir, "orchestration-control.ts"),
                "@murphai/hosted-execution/runtime-control":
                  path.join(hostedExecutionSourceDir, "runtime-control.ts"),
              },
            },
          }),
        },
        workflowsPath,
      },
      fixture.history,
      fixture.workflowId,
    );
  });
});

function readWebpackAlias(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || Array.isArray(value)) {
    return {};
  }

  if (typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
}
