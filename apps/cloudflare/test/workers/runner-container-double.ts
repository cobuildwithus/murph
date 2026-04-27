import { DurableObject, env } from "cloudflare:workers";
import type { HostedWorkspaceRunResult } from "@murphai/hosted-execution";
import type { HostedExecutionWorkspaceRunJobInput } from "../../src/runner-job-transport.js";
import {
  consumeInvalidRunnerOutputBundleFault,
  recordRunnerInvocation,
} from "./runner-e2e-control.ts";

interface RunnerContainerInvokePayload {
  internalWorkerProxyToken?: string | null;
  job: HostedExecutionWorkspaceRunJobInput;
  userId: string;
}

export class RunnerContainerTestDouble extends DurableObject {
  async invoke(payload: RunnerContainerInvokePayload): Promise<HostedWorkspaceRunResult> {
    if (payload.internalWorkerProxyToken === "") {
      throw new Error("Expected a non-empty internal worker proxy token.");
    }

    await recordRunnerInvocation({
      bucket: (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      eventId: payload.job.request.attemptId,
      userId: payload.userId,
    });

    if (await consumeInvalidRunnerOutputBundleFault({
      bucket: (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      userId: payload.userId,
    })) {
      throw new Error("Armed invalid runner output fault is not supported by workspace-run tests.");
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
