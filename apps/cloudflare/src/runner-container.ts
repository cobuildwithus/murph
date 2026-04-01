import { Container, type OutboundHandlerContext } from "@cloudflare/containers";
import {
  parseHostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobInput,
} from "@murphai/assistant-runtime";
import {
  emitHostedExecutionStructuredLog,
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  HOSTED_EXECUTION_PROXY_HOSTS,
  type HostedExecutionRunnerResult,
} from "@murphai/hosted-execution";

import { json, methodNotAllowed, readJsonObject } from "./json.ts";
import { handleRunnerOutboundRequest, type RunnerOutboundEnvironmentSource } from "./runner-outbound.ts";

const RUNNER_PORT = 8080;
const RUNNER_PING_ENDPOINT = "container/health";
const RUNNER_EXECUTE_URL = "http://container/__internal/run";
const RUNNER_WAIT_INTERVAL_MS = 250;
const RUNNER_READY_TIMEOUT_MS = 20_000;
const DEFAULT_CONTAINER_SLEEP_AFTER = "5m";
const RUNNER_CONTROL_AUTH_SCHEME = "Bearer";

export class HostedExecutionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedExecutionConfigurationError";
  }
}

interface HostedExecutionContainerInvokeRequest {
  job: HostedAssistantRuntimeJobInput;
  runnerEnvironment: Record<string, string>;
  timeoutMs: number;
  userId: string;
}

interface HostedExecutionContainerInvokeInput extends HostedExecutionContainerInvokeRequest {
  runnerControlToken: string;
}

interface HostedExecutionContainerRunnerInput {
  job: HostedAssistantRuntimeJobInput;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike;
  runnerControlToken: string | null;
  runnerEnvironment: Readonly<Record<string, string>>;
  timeoutMs: number;
  userId: string;
}

export interface HostedExecutionContainerStubLike {
  destroyInstance(): Promise<void>;
  invoke(input: HostedExecutionContainerInvokeRequest): Promise<HostedExecutionRunnerResult>;
}

export interface HostedExecutionContainerNamespaceLike {
  getByName(name: string): HostedExecutionContainerStubLike;
}

type RunnerOutboundHandlerContext = OutboundHandlerContext<{
  internalWorkerProxyToken?: unknown;
  userId?: unknown;
} | undefined>;

interface RunnerContainerEnvironmentSource extends Readonly<Record<string, unknown>> {
  HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER?: string;
  HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN?: string;
}

type RunnerOutboundHandlerName =
  | "artifactsWorker"
  | "commitWorker"
  | "deviceSyncWorker"
  | "emailWorker"
  | "sideEffectsWorker"
  | "sharePackWorker"
  | "usageWorker";

const RUNNER_OUTBOUND_HOSTS = {
  [HOSTED_EXECUTION_CALLBACK_HOSTS.artifacts]: "artifactsWorker",
  [HOSTED_EXECUTION_CALLBACK_HOSTS.commit]: "commitWorker",
  [HOSTED_EXECUTION_PROXY_HOSTS.deviceSync]: "deviceSyncWorker",
  [HOSTED_EXECUTION_CALLBACK_HOSTS.email]: "emailWorker",
  [HOSTED_EXECUTION_PROXY_HOSTS.sharePack]: "sharePackWorker",
  [HOSTED_EXECUTION_CALLBACK_HOSTS.sideEffects]: "sideEffectsWorker",
  [HOSTED_EXECUTION_PROXY_HOSTS.usage]: "usageWorker",
} as const satisfies Record<string, RunnerOutboundHandlerName>;

export class RunnerContainer extends Container {
  static override outboundHandlers = {
    artifactsWorker: createRunnerOutboundHandler(),
    commitWorker: createRunnerOutboundHandler(),
    deviceSyncWorker: createRunnerOutboundHandler(),
    emailWorker: createRunnerOutboundHandler(),
    sideEffectsWorker: createRunnerOutboundHandler(),
    sharePackWorker: createRunnerOutboundHandler(),
    usageWorker: createRunnerOutboundHandler(),
  };

  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  sleepAfter = DEFAULT_CONTAINER_SLEEP_AFTER;
  private readonly runnerControlToken: string | null;

  constructor(state: unknown, env: RunnerContainerEnvironmentSource) {
    super(state as never, env as never);
    this.sleepAfter = readContainerSleepAfter(env);
    this.runnerControlToken = readOptionalString(env.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN);
  }

  async invoke(payload: HostedExecutionContainerInvokeRequest): Promise<HostedExecutionRunnerResult> {
    return this.invokeHostedExecution(
      parseHostedExecutionContainerInvokeInput(payload, this.runnerControlToken),
    );
  }

  async destroyInstance(): Promise<void> {
    await this.destroyIfRunning();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/invoke") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      const authorizationError = requireRunnerContainerAuthorization(
        request,
        this.runnerControlToken,
      );
      if (authorizationError) {
        return authorizationError;
      }

      try {
        return await this.handleInvokeRequest(await readJsonObject(request));
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof TypeError) {
          return json({ error: error.message }, 400);
        }

        throw error;
      }
    }

    if (url.pathname === "/internal/destroy") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      const authorizationError = requireRunnerContainerAuthorization(
        request,
        this.runnerControlToken,
      );
      if (authorizationError) {
        return authorizationError;
      }

      await this.destroyIfRunning();
      return new Response(null, { status: 204 });
    }

    return super.fetch(request);
  }

  private async handleInvokeRequest(payload: Record<string, unknown>): Promise<Response> {
    const result = await this.invokeHostedExecution(
      parseHostedExecutionContainerInvokeInput(payload, this.runnerControlToken),
    );

    return json(result);
  }

  private async invokeHostedExecution(
    input: HostedExecutionContainerInvokeInput,
  ): Promise<HostedExecutionRunnerResult> {
    const dispatch = input.job.request.dispatch;
    const run = input.job.request.run ?? null;
    const internalWorkerProxyToken = crypto.randomUUID();

    emitHostedExecutionStructuredLog({
      component: "container",
      dispatch,
      message: "Hosted execution container starting.",
      phase: "container.starting",
      run,
    });

    try {
      const startTime = Date.now();
      const readinessTimeoutMs = Math.min(input.timeoutMs, RUNNER_READY_TIMEOUT_MS);
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
            ...input.runnerEnvironment,
            HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: input.runnerControlToken,
            PORT: String(RUNNER_PORT),
          },
        },
      });
      emitHostedExecutionStructuredLog({
        component: "container",
        dispatch,
        message: "Hosted execution container is ready.",
        phase: "container.ready",
        run,
      });
      await this.installOutboundHandlers(input.userId, internalWorkerProxyToken);

      const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - startTime));
      const response = await this.containerFetch(RUNNER_EXECUTE_URL, {
        body: JSON.stringify(
          injectInternalWorkerProxyToken(input.job, internalWorkerProxyToken),
        ),
        headers: {
          authorization: `Bearer ${input.runnerControlToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal: AbortSignal.timeout(remainingTimeoutMs),
      }, RUNNER_PORT);

      if (!response.ok) {
        throw new Error(`Hosted runner container returned HTTP ${response.status}.`);
      }

      return (await response.json()) as HostedExecutionRunnerResult;
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
    }
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

  private async destroyIfRunning(): Promise<void> {
    const state = await this.getState();

    if (state.status === "stopped" || state.status === "stopped_with_code") {
      return;
    }

    try {
      await this.destroy();
    } catch {
      // best-effort cleanup only
    }
  }
}

export async function invokeHostedExecutionContainerRunner(
  input: HostedExecutionContainerRunnerInput,
): Promise<HostedExecutionRunnerResult> {
  requireHostedExecutionRunnerControlToken(input.runnerControlToken);

  return input.runnerContainerNamespace.getByName(input.userId).invoke({
    job: input.job,
    runnerEnvironment: { ...input.runnerEnvironment },
    timeoutMs: input.timeoutMs,
    userId: input.userId,
  });
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
  runnerControlToken: string | null;
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

function readContainerSleepAfter(source: RunnerContainerEnvironmentSource): string {
  return readOptionalString(source.HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER)
    ?? DEFAULT_CONTAINER_SLEEP_AFTER;
}

function parseHostedExecutionContainerInvokeInput(
  payload: {
    job?: unknown;
    runnerEnvironment?: unknown;
    timeoutMs?: unknown;
    userId?: unknown;
  },
  runnerControlToken: string | null,
): HostedExecutionContainerInvokeInput {
  return {
    job: parseHostedAssistantRuntimeJobInput(payload.job),
    runnerControlToken: requireHostedExecutionRunnerControlToken(runnerControlToken),
    runnerEnvironment: readRunnerEnvironment(payload.runnerEnvironment),
    timeoutMs: readTimeoutMs(payload.timeoutMs, RUNNER_READY_TIMEOUT_MS),
    userId: requireString(payload.userId, "payload.userId"),
  };
}

function injectInternalWorkerProxyToken(
  job: HostedAssistantRuntimeJobInput,
  internalWorkerProxyToken: string,
): HostedAssistantRuntimeJobInput {
  return {
    ...job,
    runtime: {
      ...(job.runtime ?? {}),
      internalWorkerProxyToken,
    },
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireHostedExecutionRunnerControlToken(value: string | null): string {
  if (!value) {
    throw new HostedExecutionConfigurationError(
      "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN must be configured for native hosted execution.",
    );
  }

  return value;
}

function requireRunnerContainerAuthorization(
  request: Request,
  expectedToken: string | null,
): Response | null {
  if (!expectedToken) {
    return json({
      error: "Hosted runner control token is not configured.",
    }, 503);
  }

  if (request.headers.get("authorization") !== `${RUNNER_CONTROL_AUTH_SCHEME} ${expectedToken}`) {
    return json({
      error: "Unauthorized",
    }, 401);
  }

  return null;
}

function readRunnerEnvironment(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  return toStringRecord(requireRecord(value, "runnerEnvironment"));
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

function toStringRecord(value: Record<string, unknown>): Record<string, string> {
  const entries = Object.entries(value)
    .filter(([, entryValue]) => typeof entryValue === "string") as Array<[string, string]>;

  return Object.fromEntries(entries);
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
