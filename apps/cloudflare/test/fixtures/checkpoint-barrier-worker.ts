import { DurableObject } from "cloudflare:workers";
import {
  armIdleSnapshotStartBarrier,
  readShutdownCheckpointPublicationBarrierState,
  releaseShutdownCheckpointPublicationBarrier,
  wrapShutdownCheckpointPublicationBarrierForTest,
} from "../../src/hosted-local-test/runner-container.ts";
import { HOSTED_RUNNER_BOUND_USER_ID_HEADER } from "../../src/runner-outbound/headers.ts";

interface BarrierEnvironment {
  BARRIER: DurableObjectNamespace<CheckpointBarrier>;
}

export class CheckpointBarrier extends DurableObject<BarrierEnvironment> {
  async fetch(request: Request): Promise<Response> {
    return await handleBarrierRequest(request);
  }
}

async function handleBarrierRequest(request: Request): Promise<Response> {
  const action = new URL(request.url).pathname;
  const userId = "member_checkpoint_context";
  if (action === "/arm") {
    armIdleSnapshotStartBarrier(userId);
    return new Response("armed");
  }
  if (action === "/release") {
    return new Response(String(releaseShutdownCheckpointPublicationBarrier(userId)));
  }
  if (action === "/status") {
    return new Response(readShutdownCheckpointPublicationBarrierState(userId));
  }
  const handler = wrapShutdownCheckpointPublicationBarrierForTest(
    async () => new Response("checkpoint resumed"),
  );
  return await handler(new Request("https://snapshot.test/workspace-snapshots/start", {
    headers: { [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: userId },
    method: "POST",
  }), {
    BUNDLES: {
      get: rejectUnexpectedStateAccess,
      put: rejectUnexpectedStateAccess,
      delete: rejectUnexpectedStateAccess,
    },
    USER_RUNNER: { getByName: rejectUnexpectedStateAccess },
  }, {});
}

export default {
  async fetch(request: Request, env: BarrierEnvironment): Promise<Response> {
    const target = new URL(request.url).searchParams.get("target") ?? "control";
    return target === "worker"
      ? await handleBarrierRequest(request)
      : await env.BARRIER.getByName(target).fetch(request);
  },
};

function rejectUnexpectedStateAccess(): never {
  throw new Error("Barrier proof must not access external state.");
}
