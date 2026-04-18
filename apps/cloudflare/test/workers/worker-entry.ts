import { DurableObject, env } from "cloudflare:workers";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

import worker from "../../src/index.ts";
import type { R2BucketLike } from "../../src/bundle-store.js";
import { persistHostedExecutionCommit } from "../../src/execution-journal.js";
import { readHostedExecutionEnvironment } from "../../src/env.ts";
import type { HostedExecutionContainerNamespaceLike } from "../../src/runner-container.js";
import { hostedDispatchPayloadObjectKeyForSignature } from "../../src/storage-paths.ts";
import { stringifyStructuredJson } from "../../src/structured-json.js";
import { createHostedUserKeyStore } from "../../src/user-key-store.js";
import { HostedUserRunner } from "../../src/user-runner.ts";
import type { WorkerEnvironmentSource } from "../../src/worker-routes/shared.ts";
import {
  armDispatchPayloadReadPause,
  armRunnerCommitPause,
  buildSeededDuplicateCommitPayload,
  clearDispatchPayloadReadPause,
  clearRunnerInvocationState,
  clearRunnerCommitPause,
  pauseDispatchPayloadReadIfArmed,
  readDispatchPayloadReadPauseState,
  readRunnerInvocationState,
  readRunnerCommitPauseState,
  releaseDispatchPayloadReadPause,
  releaseRunnerCommitPause,
} from "./runner-e2e-control.ts";

import type {
  HostedExecutionWake,
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
      createTestControlledBucket(env.BUNDLES),
      env,
      env.RUNNER_CONTAINER,
    );
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bootstrapUser(userId);
  }

  async wake(input: HostedExecutionWake): Promise<HostedExecutionUserStatus> {
    return this.runner.enqueueHostedWake(input);
  }

  async wakeWithOutcome(input: HostedExecutionWake): Promise<HostedExecutionDispatchResult> {
    return this.runner.enqueueHostedWakeWithOutcome(input);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.runner.status();
  }

  async runAlarmForTest(): Promise<void> {
    await this.runner.alarm();
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

  if (url.pathname === "/__test/wake-with-outcome" && request.method === "POST") {
    const wake = readTestWake(await request.json() as unknown);
    const runner = getUserRunnerStub(wake.userId);
    await runner.bootstrapUser(wake.userId);
    return Response.json(await runner.wakeWithOutcome(wake));
  }

  if (url.pathname === "/__test/status" && request.method === "GET") {
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    return Response.json(await getUserRunnerStub(userId).status());
  }

  if (url.pathname === "/__test/bootstrap-user" && request.method === "POST") {
    const body = await request.json() as { userId?: unknown };

    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    await resolveHostedUserCryptoContext(body.userId);
    return Response.json(await getUserRunnerStub(body.userId).bootstrapUser(body.userId));
  }

  if (url.pathname === "/__test/alarm" && request.method === "POST") {
    const body = await request.json() as { userId?: unknown };

    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    await getUserRunnerStub(body.userId).runAlarmForTest();
    return Response.json({
      ok: true,
      userId: body.userId,
    });
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

  if (url.pathname === "/__test/runner/payload-read-pause" && request.method === "POST") {
    const body = await request.json() as { wake?: unknown };

    if (!body.wake) {
      return Response.json({ error: "wake is required." }, { status: 400 });
    }

    const wake = readTestWake(body.wake);
    const expectedKey = await resolveWakePayloadObjectKey(wake);

    await armDispatchPayloadReadPause({
      bucket: (env as { BUNDLES: R2BucketLike }).BUNDLES,
      eventId: wake.eventId,
      expectedKey,
    });
    return Response.json({
      eventId: wake.eventId,
      expectedKey,
      ok: true,
    });
  }

  if (url.pathname === "/__test/runner/payload-read-pause" && request.method === "GET") {
    const eventId = url.searchParams.get("eventId");

    if (!eventId) {
      return Response.json({ error: "eventId is required." }, { status: 400 });
    }

    return Response.json({
      eventId,
      ...await readDispatchPayloadReadPauseState((env as { BUNDLES: R2BucketLike }).BUNDLES, eventId),
    });
  }

  if (url.pathname === "/__test/runner/payload-read-release" && request.method === "POST") {
    const body = await request.json() as { eventId?: unknown };

    if (typeof body.eventId !== "string" || body.eventId.length === 0) {
      return Response.json({ error: "eventId is required." }, { status: 400 });
    }

    const released = await releaseDispatchPayloadReadPause(
      (env as { BUNDLES: R2BucketLike }).BUNDLES,
      body.eventId,
    );
    return Response.json({
      eventId: body.eventId,
      released,
    }, { status: released ? 200 : 404 });
  }

  if (url.pathname === "/__test/runner/payload-read-clear" && request.method === "POST") {
    const body = await request.json() as { eventId?: unknown };

    if (typeof body.eventId !== "string" || body.eventId.length === 0) {
      return Response.json({ error: "eventId is required." }, { status: 400 });
    }

    await clearDispatchPayloadReadPause((env as { BUNDLES: R2BucketLike }).BUNDLES, body.eventId);
    return Response.json({
      eventId: body.eventId,
      ok: true,
    });
  }

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

  return null;
}

function getUserRunnerStub(userId: string) {
  return ((
    env as {
      USER_RUNNER: {
        getByName(name: string): {
          bootstrapUser(userId: string): Promise<{ userId: string }>;
          wakeWithOutcome(input: HostedExecutionWake): Promise<HostedExecutionDispatchResult>;
          runAlarmForTest(): Promise<void>;
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
  await store.provisionManagedUserCryptoAtActivation(userId);
  return store.requireUserCryptoContext(userId);
}

async function resolveWakePayloadObjectKey(
  wake: HostedExecutionWake,
): Promise<string> {
  const crypto = await resolveHostedUserCryptoContext(wake.userId);

  return await hostedDispatchPayloadObjectKeyForSignature(
    crypto.rootKey,
    wake.userId,
    wake.eventId,
    await createWakePayloadSignature(wake),
  );
}

async function createWakePayloadSignature(
  wake: HostedExecutionWake,
): Promise<string> {
  const canonicalJson = stringifyStructuredJson(wake);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readTestWake(value: unknown): HostedExecutionWake {
  return parseHostedExecutionWake(value);
}

function createTestControlledBucket(bucket: R2BucketLike): R2BucketLike {
  return new Proxy(bucket, {
    get(target, property, receiver) {
      if (property === "get") {
        const original = Reflect.get(target, property, receiver) as
          | ((key: string, ...args: unknown[]) => Promise<unknown>)
          | undefined;

        if (!original) {
          return original;
        }

        return async (key: string, ...args: unknown[]) => {
          if (key.startsWith("transient/dispatch-payloads/")) {
            await pauseDispatchPayloadReadIfArmed({
              bucket,
              key,
            });
          }

          return await original.call(target, key, ...args);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as R2BucketLike;
}
