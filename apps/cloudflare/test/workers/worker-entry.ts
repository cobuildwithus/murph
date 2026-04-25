import { DurableObject, env } from "cloudflare:workers";
import {
  buildHostedExecutionRuntimeTimerWake,
  createRuntimeTimerSyntheticWake,
  parseHostedIngressEnvelope,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";

import worker from "../../src/index.ts";
import type { R2BucketLike } from "../../src/bundle-store.js";
import {
  readHostedExecutionEnvironment,
  type HostedExecutionEnvironment,
} from "../../src/env.ts";
import type { HostedExecutionContainerNamespaceLike } from "../../src/runner-container.js";
import { createHostedUserKeyStore } from "../../src/user-key-store.js";
import { RunnerBundleSync } from "../../src/user-runner/runner-bundle-sync.js";
import { RunnerStateStore } from "../../src/user-runner/runner-state-store.js";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
} from "../../src/user-runner.ts";
import type { WorkerEnvironmentSource } from "../../src/worker-routes/shared.ts";
import { asWorkerStringEnvironment } from "../../src/worker-contracts.ts";
import {
  armInvalidRunnerOutputBundleFault,
  armRunnerCommitPause,
  buildSeededDuplicateCommitPayload,
  clearRunnerInvocationState,
  clearRunnerOutputBundleFault,
  clearRunnerCommitPause,
  persistRunnerRuntimeTimerWake,
  readRunnerCommitPauseRequest,
  readRunnerInvocationState,
  readRunnerCommitPauseState,
  releaseRunnerCommitPause,
} from "./runner-e2e-control.ts";

import type { HostedAssistantRuntimeJobResult } from "@murphai/assistant-runtime";
import type {
  HostedExecutionBundleRef,
  HostedExecutionWake,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";

type TestWorkerEnvironment = WorkerEnvironmentSource & {
  RUNNER_CONTAINER: HostedExecutionContainerNamespaceLike;
};

type TestWake = HostedExecutionWake | ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;

interface TestWakeExecutionResult {
  event: {
    eventId: string;
    lastError: string | null;
    state: "completed" | "queued";
    userId: string;
  };
  status: HostedExecutionUserStatus;
}

function toDurableObjectStateLike(ctx: DurableObjectState): DurableObjectStateLike {
  return {
    storage: ctx.storage as DurableObjectStateLike["storage"],
  };
}

function readWorkerEnvironmentSource(): WorkerEnvironmentSource {
  return env as WorkerEnvironmentSource;
}

export class VitestUserRunnerDurableObject extends DurableObject {
  private readonly bucket: R2BucketLike;
  private readonly runtimeEnv: HostedExecutionEnvironment;
  private readonly stateStore: RunnerStateStore;
  private readonly runner: HostedUserRunner;

  constructor(ctx: DurableObjectState, env: TestWorkerEnvironment) {
    super(ctx, env);
    this.bucket = createTestControlledBucket(env.BUNDLES);
    const state = toDurableObjectStateLike(ctx);
    this.stateStore = new RunnerStateStore(state);
    this.runtimeEnv = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));
    this.runner = new HostedUserRunner(
      state,
      this.runtimeEnv,
      this.bucket,
      env,
      env.RUNNER_CONTAINER,
    );
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bootstrapUser(userId);
  }

  async wake(input: TestWake): Promise<HostedExecutionUserStatus> {
    return wakeRunnerForTest(this.runner, this.runtimeEnv, input);
  }

  async wakeWithOutcome(input: TestWake): Promise<TestWakeExecutionResult> {
    return wakeRunnerWithOutcomeForTest(this.runner, this.runtimeEnv, input);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.runner.status();
  }

  async runAlarmForTest(): Promise<void> {
    await this.runner.nudgeHostedRun();
  }

  async seedPendingCommitForTest(input: {
    payload: Extract<HostedAssistantRuntimeJobResult, { phase: "prepared" }>;
    userId: string;
    wake: HostedRuntimeEvent;
  }): Promise<{ bundleRef: HostedExecutionBundleRef | null }> {
    await this.runner.bootstrapUser(input.userId);
    const crypto = await resolveHostedUserCryptoContext(input.userId);
    const bundleSync = new RunnerBundleSync(
      this.bucket,
      crypto.rootKey,
      crypto.rootKeyId,
      crypto.keysById,
    );
    const { bundleRef } = await bundleSync.applyRunnerResultBundles(
      input.userId,
      null,
      input.payload.result.bundle,
    );
    await this.stateStore.syncBundleRefCache(bundleRef);
    return {
      bundleRef,
    };
  }

  override async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

async function wakeRunnerForTest(
  runner: HostedUserRunner,
  runtimeEnv: ReturnType<typeof readHostedExecutionEnvironment>,
  wake: TestWake,
): Promise<HostedExecutionUserStatus> {
  await runner.bootstrapUser(wake.userId);
  if (wake.kind === "runtime.timer") {
    await persistRuntimeTimerWakeForTest(wake);
    await armRuntimeWakeInWeb(runtimeEnv, wake);
    await runner.drainHostedRuns();
    return runner.status();
  }

  const append = await appendHostedWakeInWeb(runtimeEnv, wake);
  await runner.drainHostedRuns({
    targetCommittedSeqHint: append.wake.seq,
  });
  return runner.status();
}

async function wakeRunnerWithOutcomeForTest(
  runner: HostedUserRunner,
  runtimeEnv: ReturnType<typeof readHostedExecutionEnvironment>,
  wake: TestWake,
): Promise<TestWakeExecutionResult> {
  await runner.bootstrapUser(wake.userId);
  if (wake.kind === "runtime.timer") {
    await persistRuntimeTimerWakeForTest(wake);
    await armRuntimeWakeInWeb(runtimeEnv, wake);
    await runner.drainHostedRuns();
  } else {
    const append = await appendHostedWakeInWeb(runtimeEnv, wake);
    await runner.drainHostedRuns({
      targetCommittedSeqHint: append.wake.seq,
    });
  }
  const status = await runner.status();

  return {
    event: {
      eventId: wake.eventId,
      lastError: null,
      state: status.pendingIngressEventCount === 0 ? "completed" : "queued",
      userId: wake.userId,
    },
    status,
  };
}

async function armRuntimeWakeInWeb(
  runtimeEnv: ReturnType<typeof readHostedExecutionEnvironment>,
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>,
): Promise<void> {
  const response = await fetch(new URL("/__test/hosted-run/runtime-wake", runtimeEnv.hostedWebBaseUrl), {
    body: JSON.stringify({
      occurredAt: wake.occurredAt,
      userId: wake.userId,
    }),
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-hosted-execution-user-id": wake.userId,
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to arm the runtime wake: HTTP ${response.status}.`);
  }
}

export { RunnerContainerTestDouble } from "./runner-container-double.ts";

async function appendHostedWakeInWeb(
  runtimeEnv: ReturnType<typeof readHostedExecutionEnvironment>,
  wake: HostedExecutionWake,
): Promise<{
  wake: {
    seq: string;
  };
}> {
  const response = await fetch(new URL("/__test/hosted-wake/append", runtimeEnv.hostedWebBaseUrl), {
    body: JSON.stringify(wake),
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to append the test hosted wake: HTTP ${response.status}.`);
  }

  return await response.json() as {
    wake: {
      seq: string;
    };
  };
}

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
    const wakePayload: unknown = await request.json();
    const wake = readTestWake(wakePayload);
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

    if (!seeded || seeded.phase !== "prepared") {
      return Response.json({
        error: `No paused prepared runner request is available for ${body.eventId}.`,
      }, { status: 409 });
    }

    const pausedRequest = await readRunnerCommitPauseRequest(
      (env as { BUNDLES: R2BucketLike }).BUNDLES,
      body.eventId,
    );
    if (!pausedRequest) {
      return Response.json({
        error: `No paused prepared runner request is available for ${body.eventId}.`,
      }, { status: 409 });
    }

    await getUserRunnerStub(body.userId).seedPendingCommitForTest({
      payload: seeded,
      userId: body.userId,
      wake: resolvePrimaryWake(pausedRequest),
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

  return null;
}

function getUserRunnerStub(userId: string) {
  return ((
    env as {
      USER_RUNNER: {
        getByName(name: string): {
          bootstrapUser(userId: string): Promise<{ userId: string }>;
          seedPendingCommitForTest(input: {
            payload: Extract<HostedAssistantRuntimeJobResult, { phase: "prepared" }>;
            userId: string;
            wake: HostedRuntimeEvent;
          }): Promise<{ bundleRef: HostedExecutionBundleRef | null }>;
          wakeWithOutcome(input: TestWake): Promise<TestWakeExecutionResult>;
          runAlarmForTest(): Promise<void>;
          status(): Promise<HostedExecutionUserStatus>;
        };
      };
    }
  ).USER_RUNNER).getByName(userId);
}

function resolvePrimaryWake(
  request: import("@murphai/assistant-runtime").HostedAssistantRuntimeJobRequest,
): HostedRuntimeEvent {
  const [firstEvent] = request.runDrain.events;
  return firstEvent?.wake ?? createRuntimeTimerSyntheticWake(request.runDrain);
}

async function resolveHostedUserCryptoContext(userId: string) {
  const environment = readHostedExecutionEnvironment(
    asWorkerStringEnvironment(readWorkerEnvironmentSource()),
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

function readTestWake(value: unknown): TestWake {
  if (
    value
    && typeof value === "object"
    && "kind" in value
    && value.kind === "runtime.timer"
  ) {
    const record = value as {
      eventId?: unknown;
      occurredAt?: unknown;
      triggerKind?: unknown;
      userId?: unknown;
    };

    if (
      typeof record.eventId === "string"
      && typeof record.occurredAt === "string"
      && typeof record.triggerKind === "string"
      && typeof record.userId === "string"
    ) {
      return buildHostedExecutionRuntimeTimerWake({
        eventId: record.eventId,
        occurredAt: record.occurredAt,
        triggerKind: record.triggerKind as "runtime_timer",
        userId: record.userId,
      });
    }
  }

  return parseHostedIngressEnvelope(value);
}

async function persistRuntimeTimerWakeForTest(
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>,
): Promise<void> {
  await persistRunnerRuntimeTimerWake({
    bucket: (env as { BUNDLES: R2BucketLike }).BUNDLES,
    wake,
  });
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
