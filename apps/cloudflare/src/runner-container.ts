import { Container, type OutboundHandlerContext } from "@cloudflare/containers";
import {
  parseHostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import {
  CLOUDFLARE_HOSTED_RUNTIME_HOSTS,
} from "./internal-hosts.ts";
import { methodNotAllowed } from "./json.ts";
import { handleRunnerOutboundRequest, type RunnerOutboundEnvironmentSource } from "./runner-outbound.ts";

const RUNNER_PORT = 8080;
const RUNNER_PING_ENDPOINT = "container/health";
const RUNNER_HEALTH_URL = "http://container/health";
const RUNNER_EXECUTE_URL = "http://container/__internal/run";
const RUNNER_WAIT_INTERVAL_MS = 250;
const RUNNER_READY_TIMEOUT_MS = 20_000;
const DEFAULT_RUNNER_IDLE_TTL_MS = 120_000;
const MIN_RUNNER_IDLE_TTL_MS = 1_000;

export class HostedExecutionConfigurationError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.code = code;
    this.name = "HostedExecutionConfigurationError";
  }
}

interface HostedExecutionContainerInvokeRequest {
  job: HostedAssistantRuntimeJobInput;
  timeoutMs: number;
  userId: string;
}

type HostedExecutionContainerInvokeInput = HostedExecutionContainerInvokeRequest;

interface HostedExecutionContainerRunnerInput {
  job: HostedAssistantRuntimeJobInput;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike;
  timeoutMs: number;
  userId: string;
}

export interface HostedExecutionContainerStubLike {
  destroyInstance(): Promise<void>;
  invoke(input: HostedExecutionContainerInvokeRequest): Promise<HostedAssistantRuntimeJobResult>;
}

export interface HostedExecutionContainerNamespaceLike {
  getByName(name: string): HostedExecutionContainerStubLike;
}

type RunnerOutboundHandlerContext = OutboundHandlerContext<{
  internalWorkerProxyToken?: unknown;
  userId?: unknown;
} | undefined>;

type RunnerContainerEnvironmentSource = Readonly<Record<string, unknown>>;

type RunnerOutboundHandlerName =
  | "artifactsWorker"
  | "deviceSyncWorker"
  | "resultsWorker"
  | "usageWorker";

interface RunnerContainerStateLike {
  storage?: {
    deleteAlarm?: () => Promise<void>;
    setAlarm?: (scheduledTime: number | Date) => Promise<void>;
  };
}

const RUNNER_OUTBOUND_HOSTS = {
  [CLOUDFLARE_HOSTED_RUNTIME_HOSTS.artifactStore]: "artifactsWorker",
  [CLOUDFLARE_HOSTED_RUNTIME_HOSTS.effectsPort]: "resultsWorker",
  [CLOUDFLARE_HOSTED_RUNTIME_HOSTS.deviceSyncPort]: "deviceSyncWorker",
  [CLOUDFLARE_HOSTED_RUNTIME_HOSTS.usageExportPort]: "usageWorker",
} as const satisfies Record<string, RunnerOutboundHandlerName>;

export class RunnerContainer extends Container {
  static override outboundHandlers = {
    artifactsWorker: createRunnerOutboundHandler(),
    deviceSyncWorker: createRunnerOutboundHandler(),
    resultsWorker: createRunnerOutboundHandler(),
    usageWorker: createRunnerOutboundHandler(),
  };

  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;

  private readonly containerState: RunnerContainerStateLike;
  private readonly idleTtlMs: number;
  private lifecycleLock: Promise<void> = Promise.resolve();
  private runnerControlToken: string | null = null;

  constructor(state: unknown, env: RunnerContainerEnvironmentSource) {
    super(state as never, env as never);
    this.containerState = state as RunnerContainerStateLike;
    this.idleTtlMs = readRunnerIdleTtlMs(env);
  }

  async invoke(payload: HostedExecutionContainerInvokeRequest): Promise<HostedAssistantRuntimeJobResult> {
    return this.withLifecycleLock(async () =>
      this.invokeHostedExecution(parseHostedExecutionContainerInvokeInput(payload))
    );
  }

  async destroyInstance(): Promise<void> {
    await this.withLifecycleLock(async () => {
      await this.stopWarmContainer();
    });
  }

  async alarm(): Promise<void> {
    await this.withLifecycleLock(async () => {
      await this.stopWarmContainer();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/invoke" || url.pathname === "/internal/destroy") {
      return methodNotAllowed();
    }

    return super.fetch(request);
  }

  private async invokeHostedExecution(
    input: HostedExecutionContainerInvokeInput,
  ): Promise<HostedAssistantRuntimeJobResult> {
    const dispatch = input.job.request.dispatch;
    const run = input.job.request.run ?? null;
    const internalWorkerProxyToken = crypto.randomUUID();
    let keepWarm = false;

    await this.clearIdleDestroyAlarm();

    try {
      const startTime = Date.now();
      const runnerControlToken = await this.ensureContainerReady(input);
      await this.installOutboundHandlers(input.userId, internalWorkerProxyToken);

      const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - startTime));
      const response = await this.containerFetch(
        RUNNER_EXECUTE_URL,
        {
          body: JSON.stringify({
            internalWorkerProxyToken,
            job: input.job,
          }),
          headers: {
            authorization: `Bearer ${runnerControlToken}`,
            "content-type": "application/json; charset=utf-8",
          },
          method: "POST",
          signal: AbortSignal.timeout(remainingTimeoutMs),
        },
        RUNNER_PORT,
      );

      if (!response.ok) {
        throw await classifyHostedRunnerContainerErrorResponse(response);
      }

      const result = (await response.json()) as HostedAssistantRuntimeJobResult;
      keepWarm = true;
      return result;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "container",
        dispatch,
        error,
        message: "Hosted execution container failed.",
        phase: "failed",
        run,
      });
      throw error;
    } finally {
      const outboundInvalidated = await this.invalidateOutboundHandlers(input.userId);
      const shouldDestroy = !(keepWarm && outboundInvalidated && await this.scheduleIdleDestroy());

      if (shouldDestroy) {
        await this.stopWarmContainer();
      }
    }
  }

  private async ensureContainerReady(
    input: HostedExecutionContainerInvokeInput,
  ): Promise<string> {
    const readinessStartedAt = Date.now();
    const dispatch = input.job.request.dispatch;
    const run = input.job.request.run ?? null;
    const status = readContainerStatus(await this.getState());

    if (!isRunnerContainerStopped(status) && this.runnerControlToken) {
      try {
        await assertRunnerHealthy(this, Math.min(input.timeoutMs, RUNNER_READY_TIMEOUT_MS));
        emitHostedExecutionStructuredLog({
          component: "container",
          dispatch,
          message: "Hosted execution container is ready.",
          phase: "container.ready",
          run,
        });
        return this.runnerControlToken;
      } catch {
        await this.stopWarmContainer();
      }
    } else if (!isRunnerContainerStopped(status)) {
      await this.stopWarmContainer();
    }

    emitHostedExecutionStructuredLog({
      component: "container",
      dispatch,
      message: "Hosted execution container starting.",
      phase: "container.starting",
      run,
    });

    const runnerControlToken = crypto.randomUUID();
    const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - readinessStartedAt));
    const readinessTimeoutMs = Math.min(remainingTimeoutMs, RUNNER_READY_TIMEOUT_MS);
    await this.startAndWaitForPorts({
      cancellationOptions: {
        abort: AbortSignal.timeout(readinessTimeoutMs),
        instanceGetTimeoutMS: readinessTimeoutMs,
        portReadyTimeoutMS: readinessTimeoutMs,
        waitInterval: RUNNER_WAIT_INTERVAL_MS,
      },
      ports: RUNNER_PORT,
      startOptions: {
        enableInternet: true,
        envVars: {
          HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: runnerControlToken,
          PORT: String(RUNNER_PORT),
        },
      },
    });
    this.runnerControlToken = runnerControlToken;

    emitHostedExecutionStructuredLog({
      component: "container",
      dispatch,
      message: "Hosted execution container is ready.",
      phase: "container.ready",
      run,
    });

    return runnerControlToken;
  }

  private async installOutboundHandlers(
    userId: string,
    internalWorkerProxyToken: string,
  ): Promise<void> {
    await this.setOutboundByHosts(
      Object.fromEntries(
        Object.entries(RUNNER_OUTBOUND_HOSTS).map(([host, method]) => [
          host,
          {
            method,
            params: {
              internalWorkerProxyToken,
              userId,
            },
          },
        ]),
      ),
    );
  }

  private async destroyIfRunning(input: {
    failClosed?: boolean;
  } = {}): Promise<void> {
    try {
      if (isRunnerContainerStopped(readContainerStatus(await this.getState()))) {
        return;
      }

      await this.destroy();

      if (!isRunnerContainerStopped(readContainerStatus(await this.getState()))) {
        throw new Error("Hosted runner container destroy did not stop the shell.");
      }
    } catch {
      if (input.failClosed) {
        throw new Error("Hosted runner container failed to destroy cleanly.");
      }
      // best-effort cleanup only
    }
  }

  private async scheduleIdleDestroy(): Promise<boolean> {
    const setAlarm = this.containerState.storage?.setAlarm;

    if (typeof setAlarm !== "function") {
      return false;
    }

    try {
      await setAlarm(Date.now() + this.idleTtlMs);
      return true;
    } catch {
      return false;
    }
  }

  private async clearIdleDestroyAlarm(): Promise<void> {
    const deleteAlarm = this.containerState.storage?.deleteAlarm;

    if (typeof deleteAlarm !== "function") {
      return;
    }

    try {
      await deleteAlarm();
    } catch {
      // best-effort cleanup only
    }
  }

  private async stopWarmContainer(): Promise<void> {
    this.runnerControlToken = null;
    await this.clearIdleDestroyAlarm();
    await this.destroyIfRunning({ failClosed: true });
  }

  private async invalidateOutboundHandlers(userId: string): Promise<boolean> {
    try {
      if (isRunnerContainerStopped(readContainerStatus(await this.getState()))) {
        return false;
      }

      await this.installOutboundHandlers(userId, crypto.randomUUID());
      return true;
    } catch {
      return false;
    }
  }

  private async withLifecycleLock<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lifecycleLock.then(work, work);
    this.lifecycleLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export async function invokeHostedExecutionContainerRunner(
  input: HostedExecutionContainerRunnerInput,
): Promise<HostedAssistantRuntimeJobResult> {
  return input.runnerContainerNamespace.getByName(input.userId).invoke({
    job: input.job,
    timeoutMs: input.timeoutMs,
    userId: input.userId,
  });
}

async function classifyHostedRunnerContainerErrorResponse(
  response: Response,
): Promise<Error> {
  let payload: {
    code?: unknown;
    error?: unknown;
  } | null = null;

  try {
    payload = await response.clone().json() as {
      code?: unknown;
      error?: unknown;
    };
  } catch {
    payload = null;
  }

  const message = typeof payload?.error === "string" && payload.error.trim().length > 0
    ? payload.error
    : `Hosted runner container returned HTTP ${response.status}.`;
  const code = typeof payload?.code === "string" && payload.code.trim().length > 0
    ? payload.code
    : null;

  if (response.status === 503) {
    return new HostedExecutionConfigurationError(message, code);
  }

  return new Error(message);
}

function createRunnerOutboundHandler() {
  return async (
    request: Request,
    env: unknown,
    ctx: RunnerOutboundHandlerContext,
  ): Promise<Response> => {
    return handleRunnerOutboundRequest(
      request,
      env as RunnerOutboundEnvironmentSource,
      requireString(ctx.params?.userId, "ctx.params.userId"),
      requireString(
        ctx.params?.internalWorkerProxyToken,
        "ctx.params.internalWorkerProxyToken",
      ),
    );
  };
}

export async function destroyHostedExecutionContainer(input: {
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  userId: string;
}): Promise<void> {
  if (!input.runnerContainerNamespace) {
    return;
  }

  try {
    await input.runnerContainerNamespace.getByName(input.userId).destroyInstance();
  } catch {
    // best-effort cleanup only
  }
}

function parseHostedExecutionContainerInvokeInput(
  payload: {
    job?: unknown;
    timeoutMs?: unknown;
    userId?: unknown;
  },
): HostedExecutionContainerInvokeInput {
  return {
    job: parseHostedAssistantRuntimeJobInput(payload.job),
    timeoutMs: readTimeoutMs(payload.timeoutMs, RUNNER_READY_TIMEOUT_MS),
    userId: requireString(payload.userId, "payload.userId"),
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readTimeoutMs(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new TypeError("timeoutMs must be a positive number.");
  }

  return Math.trunc(value);
}

async function assertRunnerHealthy(
  container: RunnerContainer,
  timeoutMs: number,
): Promise<void> {
  const response = await container.containerFetch(
    RUNNER_HEALTH_URL,
    {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    },
    RUNNER_PORT,
  );

  if (!response.ok) {
    throw new Error(`Hosted runner container health check returned HTTP ${response.status}.`);
  }
}

function readContainerStatus(state: unknown): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const status = (state as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

function isRunnerContainerStopped(status: string | null): boolean {
  return status === "stopped" || status === "stopped_with_code";
}

function readRunnerIdleTtlMs(source: RunnerContainerEnvironmentSource): number {
  const raw = source.HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS;

  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RUNNER_IDLE_TTL_MS;
  }

  if (typeof raw !== "string") {
    throw new TypeError("HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS must be a string when configured.");
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < MIN_RUNNER_IDLE_TTL_MS) {
    throw new TypeError(
      `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS must be an integer greater than or equal to ${MIN_RUNNER_IDLE_TTL_MS}.`,
    );
  }

  return parsed;
}
