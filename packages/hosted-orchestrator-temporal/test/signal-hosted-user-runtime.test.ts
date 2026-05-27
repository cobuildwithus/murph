import { describe, expect, it } from "vitest";

import {
  parseHostedRuntimeSignal,
} from "@murphai/hosted-execution/parsers";

import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
  type HostedRuntimeSignal,
} from "../src/index.js";
import {
  hostedUserRuntimeWorkflowId,
  signalHostedUserRuntimeWorkflow,
  type HostedUserRuntimeSignalClient,
  type HostedUserRuntimeSignalWithStartOptions,
} from "../src/client/signal-hosted-user-runtime.js";

const defaultWorkflowOptions = {
  ensureRuntimeProcessingStartToCloseTimeoutMs: 15_000,
  readRuntimeDemandStartToCloseTimeoutMs: 10_000,
};

describe("hostedUserRuntimeWorkflowId", () => {
  it("builds a stable per-user workflow id", () => {
    expect(hostedUserRuntimeWorkflowId(" user_test ")).toBe(
      "hosted-user-runtime:user_test",
    );
  });

  it("rejects an empty user id", () => {
    expect(() => hostedUserRuntimeWorkflowId(" ")).toThrow(
      "Hosted runtime workflow userId is required.",
    );
  });
});

describe("signalHostedUserRuntimeWorkflow", () => {
  it("signals with the workflow, task queue, and signal constants", async () => {
    const calls: Array<{
      options: HostedUserRuntimeSignalWithStartOptions;
      workflowType: typeof HOSTED_USER_RUNTIME_WORKFLOW_TYPE;
    }> = [];

    const client: HostedUserRuntimeSignalClient = {
      workflow: {
        async signalWithStart(workflowType, options) {
          calls.push({ options, workflowType });
        },
      },
    };

    const signal: HostedRuntimeSignal = {
      kind: "mailbox_appended",
      lane: "conversation",
      laneSeq: "42",
      mailboxItemId: "mailbox_item_test",
      source: "unknown",
    };

    const result = await signalHostedUserRuntimeWorkflow({
      client,
      signal,
      userId: "user_test",
    });

    expect(result.workflowId).toBe("hosted-user-runtime:user_test");
    expect(calls).toEqual([
      {
        options: {
          args: [{
            options: defaultWorkflowOptions,
            userId: "user_test",
          }],
          signal: HOSTED_USER_RUNTIME_SIGNAL_NAME,
          signalArgs: [signal],
          taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
          workflowId: "hosted-user-runtime:user_test",
        },
        workflowType: HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      },
    ]);
    expect(JSON.stringify(calls[0].options.args)).not.toContain(
      "mailbox_item_test",
    );
  });

  it("keeps mailbox signals pointer-only", () => {
    expect(() => parseHostedRuntimeSignal({
      body: "not allowed",
      kind: "mailbox_appended",
      lane: "conversation",
      laneSeq: "42",
      mailboxItemId: "mailbox_item_test",
      payload: { text: "not allowed" },
      prompt: "not allowed",
      source: "test",
      transcript: "not allowed",
      vault: "not allowed",
    })).toThrow("Hosted runtime mailbox signal must not include body.");
  });
});
