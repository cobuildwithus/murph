import { DurableObject, env } from "cloudflare:workers";
import type { HostedWorkspaceInvocationResult } from "@murphai/hosted-execution/runtime-control";
import type {
  RunnerContainerEnsureProcessingInput,
  RunnerContainerEnsureProcessingResult,
} from "../../src/runner-container.js";
import type { HostedExecutionWorkspaceInvocationJobInput } from "../../src/runner-job-transport.js";
import {
  consumeInvalidRunnerOutputBundleFault,
  recordRunnerInvocation,
} from "./runner-e2e-control.ts";

interface RunnerContainerInvokePayload {
  job: HostedExecutionWorkspaceInvocationJobInput;
  userId: string;
}

export class RunnerContainerTestDouble extends DurableObject {
  async ensureProcessing(
    input: RunnerContainerEnsureProcessingInput,
  ): Promise<RunnerContainerEnsureProcessingResult> {
    if (!input.invoke) {
      return {
        kind: "wake-unconfirmed",
        reason: "missing-wake-method",
      };
    }

    if (input.invoke.job.request.attemptId === "attempt_rpc_failure_result") {
      return {
        failure: {
          errorCodeDetail: "type_error",
          runtimeFailurePhaseCode: "runtime_phase:workspace.read",
          status: 500,
        },
        kind: "failed",
      };
    }

    const runnerHttpStatus =
      /^attempt_rpc_runner_http_(401|404|500|504)$/u
        .exec(input.invoke.job.request.attemptId)?.[1];
    if (runnerHttpStatus) {
      throw new Error(
        `Hosted runner container returned HTTP ${runnerHttpStatus}.`,
      );
    }

    return {
      action: "started",
      kind: "accepted",
      result: await this.invoke(input.invoke),
    };
  }

  async invoke(payload: RunnerContainerInvokePayload): Promise<HostedWorkspaceInvocationResult> {
    await recordRunnerInvocation({
      bucket: (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      eventId: payload.job.request.attemptId,
      userId: payload.userId,
    });

    if (await consumeInvalidRunnerOutputBundleFault({
      bucket: (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      userId: payload.userId,
    })) {
      throw new Error("Armed invalid runner output fault is not supported by workspace-invocation tests.");
    }

    return {
      nextWakeAt: null,
      redactedStatus: {
        attemptId: payload.job.request.attemptId,
      },
      status: "idle",
    };
  }

  async destroyInstance(): Promise<void> {}
}
