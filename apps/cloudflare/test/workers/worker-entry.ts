import { DurableObject, env } from "cloudflare:workers";
import {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

import worker from "../../src/index.ts";
import type { R2BucketLike } from "../../src/bundle-store.js";
import { readHostedExecutionEnvironment } from "../../src/env.ts";
import type { HostedExecutionContainerNamespaceLike } from "../../src/runner-container.js";
import { createHostedUserKeyStore } from "../../src/user-key-store.js";
import { RunnerBundleSync } from "../../src/user-runner/runner-bundle-sync.js";
import { RunnerStateStore } from "../../src/user-runner/runner-state-store.js";
import type { RunnerPendingCommitRecord } from "../../src/user-runner/types.js";
import { HostedUserRunner } from "../../src/user-runner.ts";
import type { WorkerEnvironmentSource } from "../../src/worker-routes/shared.ts";
import {
  armRunnerCommitPause,
  buildSeededDuplicateCommitPayload,
  clearRunnerInvocationState,
  clearRunnerCommitPause,
  readRunnerCommitPauseRequest,
  readRunnerInvocationState,
  readRunnerCommitPauseState,
  releaseRunnerCommitPause,
} from "./runner-e2e-control.ts";

import type { HostedAssistantRuntimeJobResult } from "@murphai/assistant-runtime";
import type {
  HostedExecutionWake,
  HostedWakeExecutionResult,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import { encryptTestHostedWakePayload } from "../hosted-execution-fixtures.js";

type TestWorkerEnvironment = WorkerEnvironmentSource & {
  RUNNER_CONTAINER: HostedExecutionContainerNamespaceLike;
};

export class VitestUserRunnerDurableObject extends DurableObject {
  private readonly bucket: R2BucketLike;
  private readonly stateStore: RunnerStateStore;
  private readonly runner: HostedUserRunner;

  constructor(ctx: DurableObjectState, env: TestWorkerEnvironment) {
    super(ctx, env);
    this.bucket = createTestControlledBucket(env.BUNDLES);
    this.stateStore = new RunnerStateStore(
      ctx as unknown as import("../../src/user-runner.ts").DurableObjectStateLike,
    );
    this.runner = new HostedUserRunner(
      ctx as unknown as import("../../src/user-runner.ts").DurableObjectStateLike,
      readHostedExecutionEnvironment(env as unknown as Readonly<Record<string, string | undefined>>),
      this.bucket,
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

  async wakeWithOutcome(input: HostedExecutionWake): Promise<HostedWakeExecutionResult> {
    return this.runner.enqueueHostedWakeWithOutcome(input);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.runner.status();
  }

  async runAlarmForTest(): Promise<void> {
    await this.runner.alarm();
  }

  async seedPendingCommitForTest(input: {
    payload: Extract<HostedAssistantRuntimeJobResult, { phase: "committed" }>;
    userId: string;
    wake: HostedExecutionWake;
  }): Promise<void> {
    await this.runner.bootstrapUser(input.userId);
    const crypto = await resolveHostedUserCryptoContext(input.userId);
    const bundleSync = new RunnerBundleSync(
      this.bucket,
      crypto.rootKey,
      crypto.rootKeyId,
      crypto.keysById,
      this.stateStore,
    );
    const bundleState = await this.stateStore.readBundleMetaState();
    const bundleRecord = await bundleSync.applyRunnerResultBundles(
      input.userId,
      bundleState.bundleVersion,
      input.payload.result.bundle,
    );
    const pendingCommit: RunnerPendingCommitRecord = {
      assistantDeliveryEffects: [...input.payload.committedAssistantDeliveryEffects],
      bundleRef: bundleRecord.bundleRef,
      committedAt: new Date().toISOString(),
      eventId: input.wake.eventId,
      finalizedAt: null,
      result: input.payload.result.result,
      schemaVersion: 1,
      userId: input.userId,
      wake: createPendingCommitWakeRecord(input.wake),
    };
    await this.stateStore.writePendingCommit(pendingCommit);
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

    const pausedRequest = await readRunnerCommitPauseRequest(
      (env as { BUNDLES: R2BucketLike }).BUNDLES,
      body.eventId,
    );
    if (!pausedRequest) {
      return Response.json({
        error: `No paused committed runner request is available for ${body.eventId}.`,
      }, { status: 409 });
    }

    await getUserRunnerStub(body.userId).seedPendingCommitForTest({
      payload: seeded,
      userId: body.userId,
      wake: pausedRequest.wake,
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
          seedPendingCommitForTest(input: {
            payload: Extract<HostedAssistantRuntimeJobResult, { phase: "committed" }>;
            userId: string;
            wake: HostedExecutionWake;
          }): Promise<void>;
          wakeWithOutcome(input: HostedExecutionWake): Promise<HostedWakeExecutionResult>;
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

function readTestWake(value: unknown): HostedExecutionWake {
  return parseHostedExecutionWake(value);
}

function createPendingCommitWakeRecord(
  wake: HostedExecutionWake,
): RunnerPendingCommitRecord["wake"] {
  const { payloadCiphertext } = encryptTestHostedWakePayload({
    userId: wake.userId,
    value: wake,
  });

  return {
    eventId: wake.eventId,
    kind: wake.kind,
    occurredAt: wake.occurredAt,
    payloadCiphertext,
    payloadSchema: wake.kind === "conversation.message"
      ? HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA
      : HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
    seq: "1",
    userId: wake.userId,
  };
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

        return async (key: string, ...args: unknown[]) => await original.call(target, key, ...args);
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as R2BucketLike;
}
