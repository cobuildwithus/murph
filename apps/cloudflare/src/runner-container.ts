import { Container, type OutboundHandlerContext } from "@cloudflare/containers";
import {
  HOSTED_EXECUTION_CALLBACK_HOSTS,
  HOSTED_EXECUTION_PROXY_HOSTS,
  type HostedExecutionRunnerRequest,
  type HostedExecutionRunnerResult,
} from "@murph/hosted-execution";

import { json, readJsonObject } from "./json.ts";
import { handleRunnerOutboundRequest, type RunnerOutboundEnvironmentSource } from "./runner-outbound.ts";

const RUNNER_PORT = 8080;
const RUNNER_PING_ENDPOINT = "container/health";
const RUNNER_EXECUTE_URL = "http://container/__internal/run";
const RUNNER_WAIT_INTERVAL_MS = 250;
const RUNNER_READY_TIMEOUT_MS = 20_000;
const RUNNER_INVOKE_URL = "https://runner.internal/internal/invoke";
const RUNNER_DESTROY_URL = "https://runner.internal/internal/destroy";
const DEFAULT_CONTAINER_SLEEP_AFTER = "5m";
const RUNNER_CONTROL_AUTH_SCHEME = "Bearer";

export class HostedExecutionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedExecutionConfigurationError";
  }
}

interface HostedExecutionContainerInvokeRequest<TRequest extends HostedExecutionRunnerRequest> {
  internalWorkerProxyToken: string;
  request: TRequest;
  runnerEnvironment: Record<string, string>;
  timeoutMs: number;
  userId: string;
}

interface HostedExecutionContainerInvokeInput<TRequest extends HostedExecutionRunnerRequest>
  extends HostedExecutionContainerInvokeRequest<TRequest> {
  runnerControlToken: string;
}

interface HostedExecutionContainerRunnerInput<TRequest extends HostedExecutionRunnerRequest> {
  request: TRequest;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike;
  runnerControlToken: string | null;
  runnerEnvironment: Readonly<Record<string, string>>;
  timeoutMs: number;
  userId: string;
}

export interface HostedExecutionContainerStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
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
  | "outboxWorker"
  | "sharePackWorker"
  | "usageWorker";

const RUNNER_OUTBOUND_HOSTS = {
  [HOSTED_EXECUTION_CALLBACK_HOSTS.artifacts]: "artifactsWorker",
  [HOSTED_EXECUTION_CALLBACK_HOSTS.commit]: "commitWorker",
  [HOSTED_EXECUTION_PROXY_HOSTS.deviceSync]: "deviceSyncWorker",
  [HOSTED_EXECUTION_CALLBACK_HOSTS.email]: "emailWorker",
  [HOSTED_EXECUTION_CALLBACK_HOSTS.outbox]: "outboxWorker",
  [HOSTED_EXECUTION_PROXY_HOSTS.sharePack]: "sharePackWorker",
  [HOSTED_EXECUTION_CALLBACK_HOSTS.sideEffects]: "outboxWorker",
  [HOSTED_EXECUTION_PROXY_HOSTS.usage]: "usageWorker",
} as const satisfies Record<string, RunnerOutboundHandlerName>;

export class RunnerContainer extends Container {
  static override outboundHandlers = {
    artifactsWorker: createRunnerOutboundHandler(),
    commitWorker: createRunnerOutboundHandler(),
    deviceSyncWorker: createRunnerOutboundHandler(),
    emailWorker: createRunnerOutboundHandler(),
    outboxWorker: createRunnerOutboundHandler(),
    sharePackWorker: createRunnerOutboundHandler(),
    usageWorker: createRunnerOutboundHandler(),
  };

  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  // Keep instances warm across short bursts, but let deploy config tune the idle window explicitly.
  sleepAfter = DEFAULT_CONTAINER_SLEEP_AFTER;
  private readonly runnerControlToken: string | null;

  constructor(state: unknown, env: RunnerContainerEnvironmentSource) {
    super(state as never, env as never);
    this.sleepAfter = readContainerSleepAfter(env);
    this.runnerControlToken = readOptionalString(env.HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/invoke") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const authorizationError = requireRunnerContainerAuthorization(
        request,
        this.runnerControlToken,
      );
      if (authorizationError) {
        return authorizationError;
      }

      try {
        return await this.handleInvokeRequest(await readJsonObject(request), this.runnerControlToken);
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof TypeError) {
          return json({ error: error.message }, 400);
        }

        throw error;
      }
    }

    if (url.pathname === "/internal/destroy") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
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

  private async handleInvokeRequest(
    payload: Record<string, unknown>,
    runnerControlToken: string | null,
  ): Promise<Response> {
    const result = await this.invokeHostedExecution({
      internalWorkerProxyToken: requireString(
        payload.internalWorkerProxyToken,
        "payload.internalWorkerProxyToken",
      ),
      request: requireRecord(payload.request, "request") as unknown as HostedExecutionRunnerRequest,
      runnerControlToken: requireHostedExecutionRunnerControlToken(runnerControlToken),
      runnerEnvironment: readRunnerEnvironment(payload.runnerEnvironment),
      timeoutMs: readTimeoutMs(payload.timeoutMs, RUNNER_READY_TIMEOUT_MS),
      userId: requireString(payload.userId, "payload.userId"),
    });

    return json(result);
  }

  private async invokeHostedExecution<TRequest extends HostedExecutionRunnerRequest>(
    input: HostedExecutionContainerInvokeInput<TRequest>,
  ): Promise<HostedExecutionRunnerResult> {
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
    await this.installOutboundHandlers(input.userId, input.internalWorkerProxyToken);

    const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - startTime));
    const response = await this.containerFetch(RUNNER_EXECUTE_URL, {
      body: JSON.stringify({
        ...input.request,
        internalWorkerProxyToken: input.internalWorkerProxyToken,
      }),
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

export async function invokeHostedExecutionContainerRunner<
  TRequest extends HostedExecutionRunnerRequest,
>(input: HostedExecutionContainerRunnerInput<TRequest>): Promise<HostedExecutionRunnerResult> {
  const runnerControlToken = requireHostedExecutionRunnerControlToken(input.runnerControlToken);
  const internalWorkerProxyToken = crypto.randomUUID();

  const response = await input.runnerContainerNamespace.getByName(input.userId).fetch(
    new Request(RUNNER_INVOKE_URL, {
      body: JSON.stringify({
        internalWorkerProxyToken,
        request: input.request,
        runnerEnvironment: input.runnerEnvironment,
        timeoutMs: input.timeoutMs,
        userId: input.userId,
      } satisfies HostedExecutionContainerInvokeRequest<TRequest>),
      headers: {
        authorization: `${RUNNER_CONTROL_AUTH_SCHEME} ${runnerControlToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(`Hosted runner container returned HTTP ${response.status}.`);
  }

  return (await response.json()) as HostedExecutionRunnerResult;
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
    const runnerControlToken = requireHostedExecutionRunnerControlToken(input.runnerControlToken);
    await input.runnerContainerNamespace.getByName(input.userId).fetch(
      new Request(RUNNER_DESTROY_URL, {
        headers: {
          authorization: `${RUNNER_CONTROL_AUTH_SCHEME} ${runnerControlToken}`,
        },
        method: "POST",
      }),
    );
  } catch {
    // best-effort cleanup only
  }
}

function readContainerSleepAfter(source: RunnerContainerEnvironmentSource): string {
  const configured = typeof source.HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER === "string"
    ? source.HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER.trim()
    : "";
  return configured.length > 0 ? configured : DEFAULT_CONTAINER_SLEEP_AFTER;
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
