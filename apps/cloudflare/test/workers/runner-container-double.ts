import type {
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobRequest,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import { DurableObject, env } from "cloudflare:workers";
import { createRuntimeTimerSyntheticWake } from "@murphai/hosted-execution";

import {
  assertHostedAssistantRuntimeJobResultAsync,
} from "../../src/hosted-runtime-result-validation.js";
import {
  buildInvalidHostedBundleArchivePayload,
  buildSyntheticCommittedRunnerResult,
  buildSyntheticCompletedRunnerResult,
  consumeInvalidRunnerOutputBundleFault,
  pauseRunnerCommitIfArmed,
  readRunnerRuntimeTimerWake,
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

    const wake = await resolvePrimaryWake(
      (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      payload.job.request,
    );
    await recordRunnerInvocation({
      bucket: (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      eventId: wake.eventId,
      userId: payload.userId,
    });

    await pauseRunnerCommitIfArmed({
      bucket: (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      request: payload.job.request,
    });

    if (await consumeInvalidRunnerOutputBundleFault({
      bucket: (env as { BUNDLES: import("../../src/bundle-store.js").R2BucketLike }).BUNDLES,
      userId: payload.userId,
    })) {
      const result = buildSyntheticCommittedRunnerResult(payload.job.request, {
        bundle: buildInvalidHostedBundleArchivePayload(),
      });
      return await validateRunnerDoubleResult(result);
    }

    const result = payload.job.request.runDrain.resumeFinalize
      ? buildSyntheticCompletedRunnerResult(payload.job.request)
      : buildSyntheticCommittedRunnerResult(payload.job.request);
    return await validateRunnerDoubleResult(result);
  }

  async destroyInstance(): Promise<void> {}
}

async function validateRunnerDoubleResult(
  result: HostedAssistantRuntimeJobResult,
): Promise<HostedAssistantRuntimeJobResult> {
  await assertHostedAssistantRuntimeJobResultAsync(result, {
    bundleArchiveOperation: "runner-output",
  });
  return result;
}

async function resolvePrimaryWake(
  bucket: import("../../src/bundle-store.js").R2BucketLike,
  request: HostedAssistantRuntimeJobRequest,
) {
  const [firstEvent] = request.runDrain.events;
  if (firstEvent?.wake) {
    return firstEvent.wake;
  }

  if (request.runDrain.triggerKind === "runtime_timer") {
    return await readRunnerRuntimeTimerWake(bucket, request.runDrain.userId)
      ?? createRuntimeTimerSyntheticWake(request.runDrain);
  }

  return createRuntimeTimerSyntheticWake(request.runDrain);
}
