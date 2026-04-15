import { Container, type OutboundHandlerContext } from "@cloudflare/containers";
import {
  parseHostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  emitHostedExecutionStructuredLog,
  sanitizeHostedExecutionStructuredLogDetails,
  type HostedExecutionStructuredLogDetails,
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
const RUNNER_DESTROY_TIMEOUT_MS = 5_000;
const DEFAULT_RUNNER_IDLE_TTL_MS = 120_000;
const MIN_RUNNER_IDLE_TTL_MS = 1_000;

export class HostedExecutionConfigurationError extends Error {
  readonly code: string | null;
  readonly details: HostedExecutionStructuredLogDetails | null;
  readonly statusCode: number | null;

  constructor(
    message: string,
    code: string | null = null,
    options: {
      details?: HostedExecutionStructuredLogDetails | null;
      statusCode?: number | null;
    } = {},
  ) {
    super(message);
    this.code = code;
    this.details = options.details ?? null;
    this.name = "HostedExecutionConfigurationError";
    this.statusCode = options.statusCode ?? null;
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

// Cloudflare rolls Worker code ahead of container instances, so keep the
// worker/container outbound contract to one stable handler method.
const RUNNER_OUTBOUND_HANDLER_METHOD = "internalWorkerProxy";

const RUNNER_OUTBOUND_HOSTS = Object.values(CLOUDFLARE_HOSTED_RUNTIME_HOSTS);

export class RunnerContainer extends Container {
  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  sleepAfter = formatRunnerSleepAfter(DEFAULT_RUNNER_IDLE_TTL_MS);

  private lifecycleLock: Promise<void> = Promise.resolve();
  private runnerControlToken: string | null = null;

  constructor(state: unknown, env: RunnerContainerEnvironmentSource) {
    super(state as never, env as never);
    this.sleepAfter = formatRunnerSleepAfter(readRunnerIdleTtlMs(env));
  }

  async invoke(
    payload: HostedExecutionContainerInvokeRequest,
  ): Promise<HostedAssistantRuntimeJobResult> {
    return this.withLifecycleLock(async () =>
      this.invokeHostedExecution(parseHostedExecutionContainerInvokeInput(payload))
    );
  }

  async destroyInstance(): Promise<void> {
    await this.withLifecycleLock(async () => {
      await this.stopWarmContainer();
    });
  }

  override async onActivityExpired(): Promise<void> {
    await this.withLifecycleLock(async () => {
      await this.stopWarmContainer({ failClosed: false });
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
      const shouldDestroy = !(keepWarm && outboundInvalidated);

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
          details: {
            readinessLatencyMs: Date.now() - readinessStartedAt,
            runElapsedMs: computeHostedRunElapsedMs(run),
            startMode: "warm",
          },
          message: "Hosted execution container is ready.",
          phase: "container.ready",
          run,
        });
        return this.runnerControlToken;
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "container",
          dispatch,
          details: {
            readinessLatencyMs: Date.now() - readinessStartedAt,
            runElapsedMs: computeHostedRunElapsedMs(run),
            startMode: "warm",
          },
          error,
          level: "warn",
          message: "Hosted execution container warm health check failed; restarting shell.",
          phase: "container.starting",
          run,
        });
        await this.stopWarmContainer();
      }
    } else if (!isRunnerContainerStopped(status)) {
      await this.stopWarmContainer();
    }

    emitHostedExecutionStructuredLog({
      component: "container",
      dispatch,
      details: {
        runElapsedMs: computeHostedRunElapsedMs(run),
        startMode: "cold",
      },
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
      details: {
        readinessLatencyMs: Date.now() - readinessStartedAt,
        runElapsedMs: computeHostedRunElapsedMs(run),
        startMode: "cold",
      },
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
        RUNNER_OUTBOUND_HOSTS.map((host) => [
          host,
          {
            method: RUNNER_OUTBOUND_HANDLER_METHOD,
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
      await waitForRunnerContainerStop(this, RUNNER_DESTROY_TIMEOUT_MS);
    } catch {
      if (input.failClosed) {
        throw new Error("Hosted runner container failed to destroy cleanly.");
      }
      // best-effort cleanup only
    }
  }

  private async stopWarmContainer(input: {
    failClosed?: boolean;
  } = {
    failClosed: true,
  }): Promise<void> {
    this.runnerControlToken = null;
    await this.destroyIfRunning(input);
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

RunnerContainer.outboundHandlers = {
  [RUNNER_OUTBOUND_HANDLER_METHOD]: createRunnerOutboundHandler(),
};

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
    details?: unknown;
    error?: unknown;
    errorName?: unknown;
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
  const details = sanitizeHostedExecutionStructuredLogDetails(
    payload?.details && typeof payload.details === "object" && !Array.isArray(payload.details)
      ? payload.details as HostedExecutionStructuredLogDetails
      : null,
  );
  const errorName = typeof payload?.errorName === "string" && payload.errorName.trim().length > 0
    ? payload.errorName.trim()
    : readHostedExecutionErrorNameForCode(code);

  if (response.status === 503) {
    return new HostedExecutionConfigurationError(message, code, {
      details,
      statusCode: response.status,
    });
  }

  const error = new Error(message) as Error & {
    code?: string | null;
    details?: HostedExecutionStructuredLogDetails | null;
    status?: number;
    statusCode?: number;
  };
  if (code) {
    error.code = code;
  }
  if (details) {
    error.details = details;
  }
  if (errorName) {
    error.name = errorName;
  }
  error.status = response.status;
  error.statusCode = response.status;
  return error;
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

async function waitForRunnerContainerStop(
  container: RunnerContainer,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (isRunnerContainerStopped(readContainerStatus(await container.getState()))) {
      return;
    }
    await sleep(RUNNER_WAIT_INTERVAL_MS);
  }

  throw new Error("Hosted runner container destroy did not stop the shell.");
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

function computeHostedRunElapsedMs(
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null,
): number | null {
  if (!run?.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, Date.now() - startedAtMs);
}

function formatRunnerSleepAfter(idleTtlMs: number): `${number}s` {
  return `${Math.max(1, Math.ceil(idleTtlMs / 1_000))}s`;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function readHostedExecutionErrorNameForCode(code: string | null): string | null {
  switch (code) {
    case "configuration_error":
      return "HostedExecutionConfigurationError";
    case "range_error":
      return "RangeError";
    case "reference_error":
      return "ReferenceError";
    case "syntax_error":
      return "SyntaxError";
    case "type_error":
      return "TypeError";
    case "uri_error":
      return "URIError";
    default:
      return null;
  }
}
