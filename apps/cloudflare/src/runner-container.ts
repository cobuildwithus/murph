import { Container, type OutboundHandlerContext } from "@cloudflare/containers";
import type {
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";

import { json, readJsonObject } from "./json.js";
import { handleRunnerOutboundRequest, type RunnerOutboundEnvironmentSource } from "./runner-outbound.js";

const RUNNER_PORT = 8080;
const RUNNER_PING_ENDPOINT = "container/health";
const RUNNER_EXECUTE_URL = "http://container/__internal/run";
const RUNNER_WAIT_INTERVAL_MS = 250;
const RUNNER_READY_TIMEOUT_MS = 20_000;
const RUNNER_INVOKE_URL = "https://runner.internal/internal/invoke";
const RUNNER_DESTROY_URL = "https://runner.internal/internal/destroy";

interface HostedExecutionContainerInvokeRequest<TRequest extends HostedExecutionRunnerRequest> {
  request: TRequest;
  runnerControlToken: string | null;
  runnerEnvironment: Record<string, string>;
  timeoutMs: number;
  userId: string;
}

export interface HostedExecutionContainerStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface HostedExecutionContainerNamespaceLike {
  getByName(name: string): HostedExecutionContainerStubLike;
}

type RunnerOutboundHandlerContext = OutboundHandlerContext<{ userId?: unknown } | undefined>;

export class RunnerContainer extends Container {
  static override outboundHandlers = {
    async commitWorker(
      request: Request,
      env: unknown,
      ctx: RunnerOutboundHandlerContext,
    ): Promise<Response> {
      return handleRunnerOutboundRequest(
        request,
        env as RunnerOutboundEnvironmentSource,
        requireString(ctx.params?.userId, "ctx.params.userId"),
      );
    },
    async outboxWorker(
      request: Request,
      env: unknown,
      ctx: RunnerOutboundHandlerContext,
    ): Promise<Response> {
      return handleRunnerOutboundRequest(
        request,
        env as RunnerOutboundEnvironmentSource,
        requireString(ctx.params?.userId, "ctx.params.userId"),
      );
    },
  };

  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  // The queue DO explicitly destroys drained runner instances, so keep idle retention short.
  sleepAfter = "1m";

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/invoke") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
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
        return json({ error: "Method not allowed." }, 405);
      }

      await this.destroyIfRunning();
      return new Response(null, { status: 204 });
    }

    return super.fetch(request);
  }

  private async handleInvokeRequest(
    payload: Record<string, unknown>,
  ): Promise<Response> {
    const result = await this.invokeHostedExecution({
      request: requireRecord(payload.request, "request") as unknown as HostedExecutionRunnerRequest,
      runnerControlToken: readRunnerControlToken(payload.runnerControlToken),
      runnerEnvironment: readRunnerEnvironment(payload.runnerEnvironment),
      timeoutMs: readTimeoutMs(payload.timeoutMs, RUNNER_READY_TIMEOUT_MS),
      userId: requireString(payload.userId, "payload.userId"),
    });

    return json(result);
  }

  private async invokeHostedExecution<TRequest extends HostedExecutionRunnerRequest>(
    input: HostedExecutionContainerInvokeRequest<TRequest>,
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
          PORT: String(RUNNER_PORT),
          ...(input.runnerControlToken
            ? {
                HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: input.runnerControlToken,
              }
            : {}),
        },
      },
    });
    await this.installOutboundHandlers(input.userId);

    const remainingTimeoutMs = Math.max(1, input.timeoutMs - (Date.now() - startTime));
    const response = await this.containerFetch(RUNNER_EXECUTE_URL, {
      body: JSON.stringify(input.request),
      headers: {
        ...(input.runnerControlToken
          ? {
              authorization: `Bearer ${input.runnerControlToken}`,
            }
          : {}),
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

  private async installOutboundHandlers(userId: string): Promise<void> {
    await this.setOutboundByHosts({
      "commit.worker": {
        method: "commitWorker",
        params: {
          userId,
        },
      },
      "outbox.worker": {
        method: "outboxWorker",
        params: {
          userId,
        },
      },
      "side-effects.worker": {
        method: "outboxWorker",
        params: {
          userId,
        },
      },
    });
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
>(input: {
  request: TRequest;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike;
  runnerControlToken: string | null;
  runnerEnvironment: Readonly<Record<string, string>>;
  timeoutMs: number;
  userId: string;
}): Promise<HostedExecutionRunnerResult> {
  const response = await input.runnerContainerNamespace.getByName(input.userId).fetch(
    new Request(RUNNER_INVOKE_URL, {
      body: JSON.stringify({
        request: input.request,
        runnerControlToken: input.runnerControlToken,
        runnerEnvironment: input.runnerEnvironment,
        timeoutMs: input.timeoutMs,
        userId: input.userId,
      } satisfies HostedExecutionContainerInvokeRequest<TRequest>),
      headers: {
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

export async function destroyHostedExecutionContainer(input: {
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  userId: string;
}): Promise<void> {
  if (!input.runnerContainerNamespace) {
    return;
  }

  try {
    await input.runnerContainerNamespace.getByName(input.userId).fetch(
      new Request(RUNNER_DESTROY_URL, {
        method: "POST",
      }),
    );
  } catch {
    // best-effort cleanup only
  }
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

function readRunnerControlToken(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError("runnerControlToken must be a string when provided.");
  }

  return value;
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
