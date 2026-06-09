import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  HOSTED_DEVICE_SYNC_RECONCILER_WORKFLOW_TYPE,
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
} from "../src/index.js";
import {
  hostedDeviceSyncReconcilerWorkflow,
} from "../src/workflows/hosted-device-sync-reconciler.js";
import {
  hostedUserRuntimeWorkflow,
  runtimeSignal,
  runtimeWorkflowStatus,
} from "../src/workflows/hosted-user-runtime.js";

describe("hosted runtime workflow contracts", () => {
  it("exports stable Temporal names without a live server", () => {
    expect(HOSTED_USER_RUNTIME_WORKFLOW_TYPE).toBe(
      "hostedUserRuntimeWorkflow",
    );
    expect(HOSTED_USER_RUNTIME_TASK_QUEUE).toBe("murph-hosted-runtime");
    expect(HOSTED_USER_RUNTIME_SIGNAL_NAME).toBe("runtimeSignal");
    expect(HOSTED_USER_RUNTIME_STATUS_QUERY_NAME).toBe(
      "runtimeWorkflowStatus",
    );
    expect(HOSTED_DEVICE_SYNC_RECONCILER_WORKFLOW_TYPE).toBe(
      "hostedDeviceSyncReconcilerWorkflow",
    );
  });

  it("exposes the workflow, signal, and query definitions", () => {
    expect(hostedUserRuntimeWorkflow).toEqual(expect.any(Function));
    expect(HOSTED_USER_RUNTIME_WORKFLOW_TYPE).toBe(
      hostedUserRuntimeWorkflow.name,
    );
    expect(hostedDeviceSyncReconcilerWorkflow).toEqual(expect.any(Function));
    expect(HOSTED_DEVICE_SYNC_RECONCILER_WORKFLOW_TYPE).toBe(
      hostedDeviceSyncReconcilerWorkflow.name,
    );
    expect(runtimeSignal).toBeDefined();
    expect(runtimeWorkflowStatus).toBeDefined();
  });

  it("registers signal and query handlers before awaited workflow work", async () => {
    const source = await readFile(
      new URL("../src/workflows/hosted-user-runtime.ts", import.meta.url),
      "utf8",
    );

    const signalHandlerIndex = source.indexOf(
      "setHandler(runtimeSignal, machine.applySignal);",
    );
    const queryHandlerIndex = source.indexOf(
      "setHandler(runtimeWorkflowStatus, machine.readStatus);",
    );
    const runIndex = source.indexOf("await machine.run();");

    expect(signalHandlerIndex).toBeGreaterThanOrEqual(0);
    expect(queryHandlerIndex).toBeGreaterThanOrEqual(0);
    expect(runIndex).toBeGreaterThanOrEqual(0);
    expect(signalHandlerIndex).toBeLessThan(runIndex);
    expect(queryHandlerIndex).toBeLessThan(runIndex);
  });

  it("uses signal-aware conditions for active wake rechecks", async () => {
    const source = await readFile(
      new URL("../src/workflows/hosted-user-runtime.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("execution.kind === \"runtime_processing_accepted\"");
    expect(source).toContain("waitUntilTimestampOrSignal(");
    expect(source).not.toContain("condition(() => false");
  });
});
