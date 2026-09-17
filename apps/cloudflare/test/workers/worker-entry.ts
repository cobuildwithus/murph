import { env } from "cloudflare:workers";

import worker from "../../src/index.ts";
import { sendOperatorLinqAlert } from "../../src/operator-alert/linq.ts";
import {
  handleHostedRunnerOpenAiOutbound,
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../../src/runner-egress-intercept.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from "../../src/runner-outbound/headers.ts";
import type { R2BucketLike } from "../../src/bundle-store.js";
import {
  DatabaseHealthMonitor,
  type DatabaseHealthMonitorEnvironment,
  type DatabaseHealthMonitorResult,
} from "../../src/database-health/monitor.ts";
import type {
  DatabaseHealthAlertState,
  DatabaseHealthStoredSample,
} from "../../src/database-health/store.ts";

import {
  type DurableObjectStateLike,
} from "../../src/user-runner/types.ts";

import type { WorkerEnvironmentSource } from "../../src/worker-routes/shared.ts";

import {
  writeRunnerRuntimeWriteFenceHeaders,
} from "../../src/runner-outbound/write-fence.ts";
import {
  DatabaseHealthDurableObject,
} from "../../src/worker/database-health-durable-object.ts";
import {
  DeviceWebhookQueueHealthDurableObject,
} from "../../src/worker/device-webhook-queue-health-durable-object.ts";
import {
  OpenAiAuthorizationAlertDurableObject as ProductionOpenAiAuthorizationAlertDurableObject,
  type OpenAiAuthorizationAlertEnvironment,
} from "../../src/worker/openai-authorization-alert-durable-object.ts";
import {
  armInvalidRunnerOutputBundleFault,
  clearRunnerInvocationState,
  clearRunnerOutputBundleFault,
  readRunnerInvocationState,
} from "./runner-e2e-control.ts";

import {
  handleDatabaseHealthEgress,
  readDatabaseHealthNowMs,
} from "./database-health-fetch.ts";

export { DatabaseHealthDurableObject };
export { DeviceWebhookQueueHealthDurableObject };

export class VitestDatabaseHealthDurableObject
  extends DatabaseHealthDurableObject {
  private readonly testMonitor: DatabaseHealthMonitor;

  constructor(
    state: DurableObjectStateLike,
    environment: DatabaseHealthMonitorEnvironment,
  ) {
    super(state, environment);
    this.testMonitor = new DatabaseHealthMonitor(
      state.storage,
      environment,
      handleDatabaseHealthEgress,
      readDatabaseHealthNowMs,
    );
  }

  override async runScheduledCheck(input?: {
    scheduledAtMs?: number;
  }): Promise<DatabaseHealthMonitorResult> {
    return await this.testMonitor.runScheduledCheck(input?.scheduledAtMs);
  }

  override readRecentSamples(input?: {
    limit?: number;
  }): DatabaseHealthStoredSample[] {
    return this.testMonitor.readRecentSamples(input?.limit);
  }

  readAlertState(): DatabaseHealthAlertState {
    return this.testMonitor.readAlertState();
  }
}

export class VitestOpenAiAuthorizationAlertDurableObject
  extends ProductionOpenAiAuthorizationAlertDurableObject {
  constructor(
    state: DurableObjectStateLike,
    environment: OpenAiAuthorizationAlertEnvironment,
  ) {
    super(state, environment, {
      async send(input): Promise<void> {
        await sendOperatorLinqAlert({
          apiBaseUrl: environment.LINQ_API_BASE_URL?.trim()
            || "https://api.linqapp.com/api/partner/v3",
          apiToken: environment.LINQ_API_TOKEN ?? "",
          chatIds: [
            environment.HOSTED_DATABASE_ALERT_LINQ_CHAT_ID ?? "",
            environment.HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID ?? "",
          ],
          fetchImplementation: handleDatabaseHealthEgress,
          idempotencyKey: input.idempotencyKey,
          message: input.message,
        });
      },
    });
  }
}

function readWorkerEnvironmentSource(): WorkerEnvironmentSource {
  return env as WorkerEnvironmentSource;
}

export { RunnerContainerTestDouble } from "./runner-container-double.ts";

export default {
  async fetch(request: Request, _env: WorkerEnvironmentSource): Promise<Response> {
    const testResponse = await handleTestRoute(request);

    if (testResponse) {
      return testResponse;
    }

    return worker.fetch(request, _env);
  },
  scheduled(
    controller: ScheduledController,
    _env: WorkerEnvironmentSource,
    ctx: ExecutionContext,
  ): void {
    worker.scheduled(controller, _env, ctx);
  },
};

async function handleTestRoute(request: Request): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/__test/runner/invocations" && request.method === "GET") {
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    return Response.json(await readRunnerInvocationState(
      (env as { BUNDLES: R2BucketLike }).BUNDLES,
      userId,
    ));
  }

  if (url.pathname === "/__test/runner/invocations/clear" && request.method === "POST") {
    const body = await request.json() as { userId?: unknown };

    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    await clearRunnerInvocationState((env as { BUNDLES: R2BucketLike }).BUNDLES, body.userId);
    return Response.json({
      ok: true,
      userId: body.userId,
    });
  }

  if (url.pathname === "/__test/runner/output-bundle-fault" && request.method === "POST") {
    const body = await request.json() as { invocations?: unknown; userId?: unknown };

    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    const invocations = typeof body.invocations === "number" ? body.invocations : 1;
    await armInvalidRunnerOutputBundleFault({
      bucket: (env as { BUNDLES: R2BucketLike }).BUNDLES,
      invocations,
      userId: body.userId,
    });
    return Response.json({
      invocations,
      ok: true,
      userId: body.userId,
    });
  }

  if (url.pathname === "/__test/runner/output-bundle-fault/clear" && request.method === "POST") {
    const body = await request.json() as { userId?: unknown };

    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    await clearRunnerOutputBundleFault((env as { BUNDLES: R2BucketLike }).BUNDLES, body.userId);
    return Response.json({
      ok: true,
      userId: body.userId,
    });
  }

  if (
    url.pathname === "/__test/openai-authorization-alert"
    && request.method === "POST"
  ) {
    return await runOpenAiAuthorizationAlertTest();
  }

  return null;
}

async function runOpenAiAuthorizationAlertTest(): Promise<Response> {
  const userId = "member-private-openai-alert";
  const lease = { attemptId: "synthetic-alert-attempt", generation: "1", workspaceVersion: "7" };
  const headers = new Headers({
    authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
    "content-type": "application/json; charset=utf-8",
    [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: userId,
    "x-private-request-header": "private-request-header",
  });
  writeRunnerRuntimeWriteFenceHeaders(headers, {
    attemptId: lease.attemptId,
    generation: lease.generation,
    workspaceVersion: lease.workspaceVersion ?? "7",
  });
  const providerRequest = new Request(
    "https://api.openai.com/v1/images/generations?private_query=private-query",
    {
      body: JSON.stringify({
        attemptDetail: "private-attempt-detail",
        model: "private-model",
        prompt: "private-provider-payload",
      }),
      headers,
      method: "POST",
    },
  );

  return await handleHostedRunnerOpenAiOutbound(
    providerRequest,
    { ...readWorkerEnvironmentSource(), RUNNER_CONTAINER: { getByName: () => ({ runtimeUsageSettlementAllowsProviders: async () => true }) } },
    { containerId: "private-runner-container-id" },
    async () => new Response("private-upstream-response-body", {
      headers: {
        "content-type": "application/problem+json",
        "x-private-response-header": "private-response-header",
      },
      status: 401,
      statusText: "Synthetic Unauthorized",
    }),
  );
}
