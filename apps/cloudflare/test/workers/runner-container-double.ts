import type {
  HostedExecutionBundleRef,
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";
import { DurableObject } from "cloudflare:workers";

import { handleRunnerOutboundRequest } from "../../src/runner-outbound.js";

interface RunnerContainerInvokePayload {
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
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/destroy") {
      return new Response(null, { status: 204 });
    }

    if (url.pathname !== "/internal/invoke" || request.method !== "POST") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const payload = await request.json<RunnerContainerInvokePayload>();
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
          },
          method: "POST",
        },
      ),
      this.env as never,
      payload.userId,
    );

    if (!commitResponse.ok) {
      return commitResponse;
    }

    return Response.json(runnerResult);
  }
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
