import type { HostedAssistantRuntimeJobInput } from "@murphai/assistant-runtime";
import type {
  HostedExecutionBundleRef,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
} from "@murphai/runtime-state";
import { DurableObject } from "cloudflare:workers";

import { handleRunnerOutboundRequest } from "../../src/runner-outbound.js";

interface RunnerContainerInvokePayload {
  job: HostedAssistantRuntimeJobInput & {
    request: HostedExecutionRunnerRequest & {
      commit?: {
        bundleRefs: {
          agentState: HostedExecutionBundleRef | null;
          vault: HostedExecutionBundleRef | null;
        };
      } | null;
    };
  };
  userId: string;
}

export class RunnerContainerTestDouble extends DurableObject {
  async invoke(payload: RunnerContainerInvokePayload): Promise<HostedExecutionRunnerResult> {
    const internalWorkerProxyToken = payload.job.runtime?.internalWorkerProxyToken ?? "proxy-token";
    const runnerResult = buildRunnerResult(payload.job.request);
    const commitResponse = await handleRunnerOutboundRequest(
      new Request(
        `http://commit.worker/events/${encodeURIComponent(payload.job.request.dispatch.eventId)}/commit`,
        {
          body: JSON.stringify({
            bundles: runnerResult.bundles,
            currentBundleRefs: payload.job.request.commit?.bundleRefs ?? {
              agentState: null,
              vault: null,
            },
            result: runnerResult.result,
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-hosted-execution-runner-proxy-token": internalWorkerProxyToken,
          },
          method: "POST",
        },
      ),
      this.env as never,
      payload.userId,
      internalWorkerProxyToken,
    );

    if (!commitResponse.ok) {
      throw new Error(`Runner commit failed with HTTP ${commitResponse.status}.`);
    }

    return runnerResult;
  }

  async destroyInstance(): Promise<void> {}
}

function buildRunnerResult(
  request: HostedExecutionRunnerRequest,
): HostedExecutionRunnerResult {
  const agentState = request.bundles.agentState ?? btoa(`agent-state:${request.dispatch.eventId}`);
  const vault = request.bundles.vault ?? btoa(`vault:${request.dispatch.eventId}`);

  return {
    bundles: {
      agentState,
      vault,
    },
    result: {
      eventsHandled: 1,
      ...(request.dispatch.event.kind === "member.activated"
        ? {
            nextWakeAt: new Date(Date.now() + 60_000).toISOString(),
          }
        : {}),
      summary: `runtime:${request.dispatch.eventId}`,
    },
  };
}
