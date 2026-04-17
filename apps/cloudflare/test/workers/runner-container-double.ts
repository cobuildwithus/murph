import type {
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobRequest,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import { DurableObject, env } from "cloudflare:workers";

import {
  buildSyntheticCommittedRunnerResult,
  buildSyntheticCompletedRunnerResult,
  pauseRunnerCommitIfArmed,
  recordRunnerInvocation,
} from "./runner-e2e-control.ts";

interface RunnerContainerInvokePayload {
  internalWorkerProxyToken?: string | null;
  job: HostedAssistantRuntimeJobInput & { request: HostedAssistantRuntimeJobRequest };
  userId: string;
}

export class RunnerContainerTestDouble extends DurableObject {
  async invoke(payload: RunnerContainerInvokePayload): Promise<HostedAssistantRuntimeJobResult> {
    if (payload.internalWorkerProxyToken === "") {
      throw new Error("Expected a non-empty internal worker proxy token.");
    }

    await recordRunnerInvocation({
      bucket: (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      eventId: payload.job.request.dispatch.eventId,
      userId: payload.userId,
    });

    await pauseRunnerCommitIfArmed({
      bucket: (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      request: payload.job.request,
    });

    return payload.job.request.resume?.committedResult
      ? buildSyntheticCompletedRunnerResult(payload.job.request)
      : buildSyntheticCommittedRunnerResult(payload.job.request);
  }

  async destroyInstance(): Promise<void> {}
}
