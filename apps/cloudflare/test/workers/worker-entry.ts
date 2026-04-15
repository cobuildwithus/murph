import { DurableObject, env } from "cloudflare:workers";
import { parseHostedExecutionDispatchRequest } from "@murphai/hosted-execution/parsers";

import worker from "../../src/index.ts";
import type { R2BucketLike } from "../../src/bundle-store.js";
import { persistHostedExecutionCommit } from "../../src/execution-journal.js";
import { readHostedExecutionEnvironment } from "../../src/env.ts";
import type { HostedExecutionContainerNamespaceLike } from "../../src/runner-container.js";
import { createHostedUserKeyStore } from "../../src/user-key-store.js";
import { HostedUserRunner } from "../../src/user-runner.ts";
import type { WorkerEnvironmentSource } from "../../src/worker-routes/shared.ts";
import {
  armRunnerCommitPause,
  buildSeededDuplicateCommitPayload,
  clearRunnerCommitPause,
  readRunnerCommitPauseState,
  releaseRunnerCommitPause,
} from "./runner-e2e-control.ts";

import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchResult,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";

type TestWorkerEnvironment = WorkerEnvironmentSource & {
  RUNNER_CONTAINER: HostedExecutionContainerNamespaceLike;
};

export class VitestUserRunnerDurableObject extends DurableObject {
  private readonly runner: HostedUserRunner;

  constructor(ctx: DurableObjectState, env: TestWorkerEnvironment) {
    super(ctx, env);
    this.runner = new HostedUserRunner(
      ctx as unknown as import("../../src/user-runner.ts").DurableObjectStateLike,
      readHostedExecutionEnvironment(env as unknown as Readonly<Record<string, string | undefined>>),
      env.BUNDLES,
      env,
      env.RUNNER_CONTAINER,
    );
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bootstrapUser(userId);
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    return this.runner.dispatch(input);
  }

  async dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult> {
    return this.runner.dispatchWithOutcome(input);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.runner.status();
  }

  override async alarm(): Promise<void> {
    await this.runner.alarm();
  }
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
};

async function handleTestRoute(request: Request): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/__test/dispatch-with-outcome" && request.method === "POST") {
    const dispatch = parseHostedExecutionDispatchRequest(await request.json() as unknown);
    return Response.json(await getUserRunnerStub(dispatch.event.userId).dispatchWithOutcome(dispatch));
  }

  if (url.pathname === "/__test/status" && request.method === "GET") {
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    return Response.json(await getUserRunnerStub(userId).status());
  }

  if (url.pathname === "/__test/runner/pause" && request.method === "POST") {
    const body = await request.json() as { eventId?: unknown };

    if (typeof body.eventId !== "string" || body.eventId.length === 0) {
      return Response.json({ error: "eventId is required." }, { status: 400 });
    }

    await armRunnerCommitPause((env as { BUNDLES: R2BucketLike }).BUNDLES, body.eventId);
    return Response.json({
      eventId: body.eventId,
      ok: true,
    });
  }

  if (url.pathname === "/__test/runner/pause" && request.method === "GET") {
    const eventId = url.searchParams.get("eventId");

    if (!eventId) {
      return Response.json({ error: "eventId is required." }, { status: 400 });
    }

    return Response.json({
      eventId,
      ...await readRunnerCommitPauseState((env as { BUNDLES: R2BucketLike }).BUNDLES, eventId),
    });
  }

  if (url.pathname === "/__test/runner/release" && request.method === "POST") {
    const body = await request.json() as { eventId?: unknown };

    if (typeof body.eventId !== "string" || body.eventId.length === 0) {
      return Response.json({ error: "eventId is required." }, { status: 400 });
    }

    const released = await releaseRunnerCommitPause(
      (env as { BUNDLES: R2BucketLike }).BUNDLES,
      body.eventId,
    );
    return Response.json({
      eventId: body.eventId,
      released,
    }, { status: released ? 200 : 404 });
  }

  if (url.pathname === "/__test/seed-duplicate-commit" && request.method === "POST") {
    const body = await request.json() as { eventId?: unknown; userId?: unknown };

    if (typeof body.eventId !== "string" || body.eventId.length === 0) {
      return Response.json({ error: "eventId is required." }, { status: 400 });
    }

    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    const seeded = await buildSeededDuplicateCommitPayload(
      (env as { BUNDLES: R2BucketLike }).BUNDLES,
      body.eventId,
    );

    if (!seeded || seeded.phase !== "committed") {
      return Response.json({
        error: `No paused committed runner request is available for ${body.eventId}.`,
      }, { status: 409 });
    }

    const crypto = await resolveHostedUserCryptoContext(body.userId);
    await persistHostedExecutionCommit({
      bucket: (env as { BUNDLES: R2BucketLike }).BUNDLES,
      currentBundleRef: null,
      eventId: body.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        assistantDeliveryEffects: seeded.committedAssistantDeliveryEffects,
        bundle: seeded.result.bundle,
        gatewayProjectionSnapshot: seeded.committedGatewayProjectionSnapshot,
        result: seeded.result.result,
      },
      userId: body.userId,
    });

    return Response.json({
      eventId: body.eventId,
      ok: true,
      userId: body.userId,
    });
  }

  if (url.pathname === "/__test/runner/clear" && request.method === "POST") {
    const body = await request.json() as { eventId?: unknown };

    if (typeof body.eventId !== "string" || body.eventId.length === 0) {
      return Response.json({ error: "eventId is required." }, { status: 400 });
    }

    await clearRunnerCommitPause((env as { BUNDLES: R2BucketLike }).BUNDLES, body.eventId);
    return Response.json({
      eventId: body.eventId,
      ok: true,
    });
  }

  return null;
}

function getUserRunnerStub(userId: string) {
  return ((
    env as {
      USER_RUNNER: {
        getByName(name: string): {
          dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult>;
          status(): Promise<HostedExecutionUserStatus>;
        };
      };
    }
  ).USER_RUNNER).getByName(userId);
}

async function resolveHostedUserCryptoContext(userId: string) {
  const environment = readHostedExecutionEnvironment(
    env as unknown as Readonly<Record<string, string | undefined>>,
  );

  const store = createHostedUserKeyStore({
    automationRecipientKeyId: environment.automationRecipientKeyId,
    automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: environment.automationRecipientPublicKey,
    bucket: (env as { BUNDLES: R2BucketLike }).BUNDLES,
    envelopeEncryptionKey: environment.platformEnvelopeKey,
    envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
    envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
    recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
    teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
  });
  await store.ensureManagedUserCryptoEnvelope(userId);
  return store.requireUserCryptoContext(userId);
}
