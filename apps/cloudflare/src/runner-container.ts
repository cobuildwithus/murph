import type {
  HostedExecutionRunnerRequest,
  HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";

const RUNNER_PORT = 8080;
const RUNNER_HEALTH_URL = "http://container/health";
const RUNNER_EXECUTE_URL = "http://container/__internal/run";
const RUNNER_READY_DELAY_MS = 250;
const RUNNER_READY_TIMEOUT_MS = 20_000;

export interface HostedExecutionContainerPortLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface HostedExecutionContainerLike {
  readonly running?: boolean;
  destroy?(reason?: string): Promise<void>;
  getTcpPort(port: number): HostedExecutionContainerPortLike;
  start(options?: {
    enableInternet?: boolean;
    entrypoint?: string[];
    env?: Record<string, string>;
  }): void | Promise<void>;
}

export interface HostedExecutionContainerStateLike {
  container?: HostedExecutionContainerLike;
}

export function hasHostedExecutionContainer(
  value: HostedExecutionContainerStateLike,
): value is HostedExecutionContainerStateLike & { container: HostedExecutionContainerLike } {
  return Boolean(
    value.container
      && typeof value.container.getTcpPort === "function"
      && typeof value.container.start === "function",
  );
}

export async function invokeHostedExecutionContainerRunner<
  TRequest extends HostedExecutionRunnerRequest,
>(input: {
  request: TRequest;
  runnerControlToken: string | null;
  runnerEnvironment: Readonly<Record<string, string>>;
  state: HostedExecutionContainerStateLike & { container: HostedExecutionContainerLike };
  timeoutMs: number;
}): Promise<HostedExecutionRunnerResult> {
  if (!input.state.container.running) {
    await input.state.container.start({
      enableInternet: true,
      env: {
        ...input.runnerEnvironment,
        PORT: String(RUNNER_PORT),
        ...(input.runnerControlToken
          ? {
              HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: input.runnerControlToken,
            }
          : {}),
      },
    });
  }

  const port = input.state.container.getTcpPort(RUNNER_PORT);
  await waitForHostedRunnerReadiness({
    port,
    timeoutMs: input.timeoutMs,
  });

  const response = await port.fetch(RUNNER_EXECUTE_URL, {
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
    signal: AbortSignal.timeout(input.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Hosted runner container returned HTTP ${response.status}.`);
  }

  return (await response.json()) as HostedExecutionRunnerResult;
}

export async function destroyHostedExecutionContainer(input: {
  state: HostedExecutionContainerStateLike;
}): Promise<void> {
  if (!hasHostedExecutionContainer(input.state) || !input.state.container.running) {
    return;
  }

  try {
    await input.state.container.destroy?.();
  } catch {
    // best-effort cleanup only
  }
}

async function waitForHostedRunnerReadiness(input: {
  port: HostedExecutionContainerPortLike;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + Math.max(input.timeoutMs, RUNNER_READY_TIMEOUT_MS);
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await input.port.fetch(RUNNER_HEALTH_URL, { method: "GET" });

      if (response.ok) {
        return;
      }

      if (response.status < 500) {
        throw new Error(`Hosted runner healthcheck returned HTTP ${response.status}.`);
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(RUNNER_READY_DELAY_MS);
  }

  if (lastError instanceof Error) {
    throw new Error(`Hosted runner container did not become ready: ${lastError.message}`);
  }

  throw new Error("Hosted runner container did not become ready before timing out.");
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}
