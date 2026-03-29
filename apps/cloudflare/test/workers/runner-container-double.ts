import type {
  HostedExecutionBundleRef,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
} from "@murph/runtime-state";
import { DurableObject } from "cloudflare:workers";

import { handleRunnerOutboundRequest } from "../../src/runner-outbound.js";

interface RunnerContainerInvokePayload {
  internalWorkerProxyToken: string;
  userId: string;
  request: HostedExecutionRunnerRequest & {
    commit: {
      bundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
  };
}

export class RunnerContainerTestDouble extends DurableObject {
  async invoke(payload: RunnerContainerInvokePayload): Promise<HostedExecutionRunnerResult> {
    const runnerResult = buildRunnerResult(payload.request);
    const commitResponse = await handleRunnerOutboundRequest(
      new Request(
        `http://commit.worker/events/${encodeURIComponent(payload.request.dispatch.eventId)}/commit`,
        {
          body: JSON.stringify({
            bundles: runnerResult.bundles,
            currentBundleRefs: payload.request.commit.bundleRefs,
            result: runnerResult.result,
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-hosted-execution-runner-proxy-token": payload.internalWorkerProxyToken,
          },
          method: "POST",
        },
      ),
      this.env as never,
      payload.userId,
      payload.internalWorkerProxyToken,
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
