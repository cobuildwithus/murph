import { DurableObject, env } from "cloudflare:workers";
import {
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";

import worker from "../../src/index.ts";
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
  readHostedExecutionEnvironment,
  type HostedExecutionEnvironment,
} from "../../src/env.ts";
import type { HostedExecutionContainerNamespaceLike } from "../../src/runner-container.js";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
} from "../../src/user-runner.ts";
import {
  RunnerStateStore,
  type RunnerWriteFenceToken,
} from "../../src/user-runner/runner-state-store.ts";
import type { WorkerEnvironmentSource } from "../../src/worker-routes/shared.ts";
import { asWorkerStringEnvironment } from "../../src/worker-contracts.ts";
import {
  requireRunnerRuntimeWriteFence,
  requireRunnerRuntimeWriteFenceHeaders,
  writeRunnerRuntimeWriteFenceHeaders,
} from "../../src/runner-outbound/write-fence.ts";
import {
  handleRunnerGeneratedImageUploadRequest,
} from "../../src/runner-outbound/generated-images.ts";
import {
  DatabaseHealthDurableObject,
} from "../../src/worker/database-health-durable-object.ts";
import {
  armTemporalMailboxSignalFaultForTest,
  clearTemporalMailboxSignalFaultForTest,
  consumeTemporalMailboxSignalFaultForTest,
} from "../support/temporal-mailbox-signal-fault-control.ts";
import {
  armInvalidRunnerOutputBundleFault,
  clearRunnerInvocationState,
  clearRunnerOutputBundleFault,
  persistRunnerRuntimeTimerWake,
  readRunnerInvocationState,
} from "./runner-e2e-control.ts";

import type {
  HostedExecutionWake,
} from "@murphai/hosted-execution";
import type { HostedRunnerStatusResponse } from "@murphai/hosted-execution/runtime-control";
import {
  handleDatabaseHealthEgress,
  readDatabaseHealthNowMs,
} from "./database-health-fetch.ts";

export { DatabaseHealthDurableObject };

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
  status: HostedRunnerStatusResponse;
}

function toDurableObjectStateLike(ctx: DurableObjectState): DurableObjectStateLike {
  return {
    storage: ctx.storage as DurableObjectStateLike["storage"],
    waitUntil: (promise) => ctx.waitUntil(promise),
  };
}

function readWorkerEnvironmentSource(): WorkerEnvironmentSource {
  return env as WorkerEnvironmentSource;
}

export class VitestUserRunnerDurableObject extends DurableObject {
  private readonly bucket: R2BucketLike;
  private readonly runtimeEnv: HostedExecutionEnvironment;
  private readonly runner: HostedUserRunner;
  private readonly stateStore: RunnerStateStore;

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

  async bindUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bindUser(userId);
  }

  async beginWriteFenceForTest(input: {
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<RunnerWriteFenceToken> {
    const token = await this.stateStore.beginWriteFence({
      runnerContainerName: input.userId,
      userId: input.userId,
    });
    if (!input.workspaceVersion) {
      return token;
    }

    return await this.stateStore.bindWriteFenceWorkspaceVersion({
      token,
      workspaceVersion: input.workspaceVersion,
    });
  }

  async validateRuntimeWriteFence(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<boolean> {
    return await this.runner.validateRuntimeWriteFence(input);
  }

  async validateRuntimeProviderEgressToken(input: {
    providerEgressToken: string;
    userId: string;
  }): ReturnType<HostedUserRunner["validateRuntimeProviderEgressToken"]> {
    return await this.runner.validateRuntimeProviderEgressToken(input);
  }

  async wake(input: TestWake): Promise<HostedRunnerStatusResponse> {
    return wakeRunnerForTest(this.runner, this.runtimeEnv, input);
  }

  async wakeWithOutcome(input: TestWake): Promise<TestWakeExecutionResult> {
    return wakeRunnerWithOutcomeForTest(this.runner, this.runtimeEnv, input);
  }

  async runnerStatus(): Promise<HostedRunnerStatusResponse> {
    return this.runner.runnerStatus();
  }

  async runAlarmForTest(): Promise<void> {
    await this.runner.alarm();
  }

  override async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

async function wakeRunnerForTest(
  runner: HostedUserRunner,
  runtimeEnv: ReturnType<typeof readHostedExecutionEnvironment>,
  wake: TestWake,
): Promise<HostedRunnerStatusResponse> {
  await runner.bindUser(wake.userId);
  if (wake.kind === "runtime.timer") {
    await persistRuntimeTimerWakeForTest(wake);
    await armRuntimeWakeInWeb(runtimeEnv, wake);
    await driveRunnerNudgeForTest(runner, wake.userId);
    return runner.runnerStatus();
  }

  await appendHostedWakeInWeb(runtimeEnv, wake);
  await driveRunnerNudgeForTest(runner, wake.userId);
  return runner.runnerStatus();
}

async function wakeRunnerWithOutcomeForTest(
  runner: HostedUserRunner,
  runtimeEnv: ReturnType<typeof readHostedExecutionEnvironment>,
  wake: TestWake,
): Promise<TestWakeExecutionResult> {
  await runner.bindUser(wake.userId);
  if (wake.kind === "runtime.timer") {
    await persistRuntimeTimerWakeForTest(wake);
    await armRuntimeWakeInWeb(runtimeEnv, wake);
    await driveRunnerNudgeForTest(runner, wake.userId);
  } else {
    await appendHostedWakeInWeb(runtimeEnv, wake);
    await driveRunnerNudgeForTest(runner, wake.userId);
  }
  const status = await runner.runnerStatus();

  return {
    event: {
      eventId: wake.eventId,
      lastError: null,
      state: hostedRunnerStatusIsIdle(status) ? "completed" : "queued",
      userId: wake.userId,
    },
    status,
  };
}

async function armRuntimeWakeInWeb(
  runtimeEnv: ReturnType<typeof readHostedExecutionEnvironment>,
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>,
): Promise<void> {
  const response = await fetch(
    new URL("/__test/hosted-runtime/wake", runtimeEnv.hostedWebBaseUrl),
    {
      body: JSON.stringify({
        occurredAt: wake.occurredAt,
        userId: wake.userId,
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-hosted-execution-user-id": wake.userId,
      },
      method: "POST",
    },
  );

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
  const response = await fetch(
    new URL("/__test/hosted-mailbox/append", runtimeEnv.hostedWebBaseUrl),
    {
      body: JSON.stringify(wake),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );

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
  const temporalMailboxSignalFaultRoute =
    readTemporalMailboxSignalFaultRoute(url.pathname);

  if (
    temporalMailboxSignalFaultRoute
    && request.method === "POST"
  ) {
    const { action, userId } = temporalMailboxSignalFaultRoute;
    if (action === "clear") {
      return Response.json({
        ...clearTemporalMailboxSignalFaultForTest(userId),
        ok: true,
      });
    }

    const body: unknown = await request.json();
    if (!isTemporalMailboxSignalFaultRequestBody(body)) {
      return Response.json(
        { error: "mailboxItemId is required." },
        { status: 400 },
      );
    }

    if (action === "arm") {
      try {
        return Response.json(armTemporalMailboxSignalFaultForTest({
          mailboxItemId: body.mailboxItemId,
          userId,
        }));
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 409 },
        );
      }
    }

    return Response.json({
      consume: await consumeTemporalMailboxSignalFaultForTest({
        mailboxItemId: body.mailboxItemId,
        userId,
      }, 30_000),
    });
  }

  if (url.pathname === "/__test/wake-with-outcome" && request.method === "POST") {
    const wakePayload: unknown = await request.json();
    const wake = readTestWake(wakePayload);
    const runner = getUserRunnerStub(wake.userId);
    await runner.bindUser(wake.userId);
    return Response.json(await runner.wakeWithOutcome(wake));
  }

  if (url.pathname === "/__test/status" && request.method === "GET") {
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    return Response.json(await getUserRunnerStub(userId).runnerStatus());
  }

  if (url.pathname === "/__test/bootstrap-user" && request.method === "POST") {
    const body = await request.json() as { userId?: unknown };

    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    return Response.json(await getUserRunnerStub(body.userId).bindUser(body.userId));
  }

  if (url.pathname === "/__test/runner/lease-latency" && request.method === "POST") {
    return Response.json(await measureRunnerLeaseLatency(request));
  }

  if (
    url.pathname === "/__test/generated-images/upload-handler-signal"
    && request.method === "POST"
  ) {
    return Response.json(await exerciseGeneratedImageUploadTombstone());
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

interface TemporalMailboxSignalFaultRoute {
  action: "arm" | "clear" | "consume";
  userId: string;
}

function readTemporalMailboxSignalFaultRoute(
  pathname: string,
): TemporalMailboxSignalFaultRoute | null {
  const match = pathname.match(
    /^\/__test\/users\/([^/]+)\/temporal-mailbox-signal-fault\/(arm|clear|consume)$/u,
  );
  if (!match) {
    return null;
  }

  const encodedUserId = match[1];
  const action = match[2];
  if (!encodedUserId || !isTemporalMailboxSignalFaultAction(action)) {
    return null;
  }

  try {
    const userId = decodeURIComponent(encodedUserId).trim();
    return userId ? { action, userId } : null;
  } catch {
    return null;
  }
}

function isTemporalMailboxSignalFaultAction(
  value: string,
): value is TemporalMailboxSignalFaultRoute["action"] {
  return value === "arm" || value === "clear" || value === "consume";
}

function isTemporalMailboxSignalFaultRequestBody(
  value: unknown,
): value is { mailboxItemId: string } {
  return typeof value === "object"
    && value !== null
    && "mailboxItemId" in value
    && typeof value.mailboxItemId === "string"
    && value.mailboxItemId.trim().length > 0;
}

function getUserRunnerStub(userId: string) {
  return ((
    env as {
      USER_RUNNER: {
        getByName(name: string): {
          beginWriteFenceForTest(input: {
            userId: string;
            workspaceVersion?: string | null;
          }): Promise<RunnerWriteFenceToken>;
          bindUser(userId: string): Promise<{ userId: string }>;
          validateRuntimeWriteFence(input: {
            attemptId: string;
            generation: string;
            userId: string;
          }): Promise<boolean>;
          validateRuntimeProviderEgressToken(input: {
            providerEgressToken: string;
            userId: string;
          }): ReturnType<HostedUserRunner["validateRuntimeProviderEgressToken"]>;
          wakeWithOutcome(input: TestWake): Promise<TestWakeExecutionResult>;
          runAlarmForTest(): Promise<void>;
          runnerStatus(): Promise<HostedRunnerStatusResponse>;
        };
      };
    }
  ).USER_RUNNER).getByName(userId);
}

async function measureRunnerLeaseLatency(request: Request): Promise<{
  estimatedAddedLatency: LatencySummary;
  headerOnly: LatencySummary;
  iterations: number;
  liveLease: LatencySummary;
  warmupIterations: number;
}> {
  const body = await request.json() as {
    iterations?: unknown;
    userId?: unknown;
    warmupIterations?: unknown;
  };
  const userId = typeof body.userId === "string" && body.userId.length > 0
    ? body.userId
    : "member_runner_lease_latency";
  const iterations = readBoundedInteger(body.iterations, {
    defaultValue: 200,
    max: 2_000,
    min: 20,
  });
  const warmupIterations = readBoundedInteger(body.warmupIterations, {
    defaultValue: 25,
    max: 200,
    min: 0,
  });

  const lease = await getUserRunnerStub(userId).beginWriteFenceForTest({
    userId,
    workspaceVersion: "7",
  });
  const writeFenceRequest = createWriteFenceLatencyRequest(lease);

  for (let index = 0; index < warmupIterations; index += 1) {
    requireRunnerRuntimeWriteFenceHeaders(writeFenceRequest);
    await requireRunnerRuntimeWriteFence({
      env: readWorkerEnvironmentSource(),
      request: writeFenceRequest,
      userId,
    });
  }

  const headerOnlySamples: number[] = [];
  const liveLeaseSamples: number[] = [];
  const addedSamples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const headerStartedAt = performance.now();
    requireRunnerRuntimeWriteFenceHeaders(writeFenceRequest);
    const headerElapsed = performance.now() - headerStartedAt;

    const liveStartedAt = performance.now();
    await requireRunnerRuntimeWriteFence({
      env: readWorkerEnvironmentSource(),
      request: writeFenceRequest,
      userId,
    });
    const liveElapsed = performance.now() - liveStartedAt;

    headerOnlySamples.push(headerElapsed);
    liveLeaseSamples.push(liveElapsed);
    addedSamples.push(liveElapsed - headerElapsed);
  }

  return {
    estimatedAddedLatency: summarizeLatency(addedSamples),
    headerOnly: summarizeLatency(headerOnlySamples),
    iterations,
    liveLease: summarizeLatency(liveLeaseSamples),
    warmupIterations,
  };
}

async function exerciseGeneratedImageUploadTombstone(): Promise<{
  status: number;
}> {
  const userId = `member_generated_image_upload_worker_${Date.now()}`;
  await getUserRunnerStub(userId).bindUser(userId);
  const lease = await getUserRunnerStub(userId).beginWriteFenceForTest({
    userId,
    workspaceVersion: "7",
  });
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  writeRunnerRuntimeWriteFenceHeaders(headers, {
    attemptId: lease.attemptId,
    generation: lease.leaseGeneration,
    workspaceVersion: lease.workspaceVersion ?? "7",
  });

  const uploadRequest = new Request("http://results.worker/generated-images", {
    headers,
    method: "POST",
  });
  const response = await handleRunnerGeneratedImageUploadRequest({
    env: readWorkerEnvironmentSource(),
    request: uploadRequest,
    userId,
  });

  return {
    status: response.status,
  };
}

type LatencySummary = {
  avgMs: number;
  maxMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  samples: number;
  totalMs: number;
};

function createWriteFenceLatencyRequest(lease: RunnerWriteFenceToken): Request {
  const headers = new Headers();
  writeRunnerRuntimeWriteFenceHeaders(headers, {
    attemptId: lease.attemptId,
    generation: lease.leaseGeneration,
    workspaceVersion: lease.workspaceVersion ?? "7",
  });
  return new Request("http://results.worker/__test/lease-latency", {
    headers,
    method: "POST",
  });
}

function summarizeLatency(samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    avgMs: roundLatencyMs(total / samples.length),
    maxMs: roundLatencyMs(sorted[sorted.length - 1] ?? 0),
    minMs: roundLatencyMs(sorted[0] ?? 0),
    p50Ms: roundLatencyMs(readPercentile(sorted, 0.5)),
    p95Ms: roundLatencyMs(readPercentile(sorted, 0.95)),
    samples: samples.length,
    totalMs: roundLatencyMs(total),
  };
}

function readPercentile(sortedSamples: readonly number[], percentile: number): number {
  if (sortedSamples.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * percentile) - 1),
  );
  return sortedSamples[index] ?? 0;
}

function readBoundedInteger(
  value: unknown,
  bounds: {
    defaultValue: number;
    max: number;
    min: number;
  },
): number {
  const numberValue = typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : bounds.defaultValue;
  return Math.min(bounds.max, Math.max(bounds.min, numberValue));
}

function roundLatencyMs(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

async function driveRunnerNudgeForTest(
  runner: HostedUserRunner,
  userId: string,
): Promise<void> {
  await runner.ensureRuntimeProcessingForUser({
    orchestrationAttemptId: createTestOrchestrationAttemptId("wake"),
    userId,
  });
}

function createTestOrchestrationAttemptId(source: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `test-worker-${source}-${crypto.randomUUID()}`;
  }

  return `test-worker-${source}-${Date.now().toString(36)}`;
}

function hostedRunnerStatusIsIdle(status: HostedRunnerStatusResponse): boolean {
  return !status.inFlight && status.mailboxLag.every((lane) => lane.lag === "0");
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

  return parseHostedExecutionWake(value);
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
