import {
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

export interface HostedExecutionDispatchEnvironment {
  dispatchTimeoutMs: number;
  dispatchUrl: string | null;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionDispatchEnvironment(
  source: EnvSource = process.env,
): HostedExecutionDispatchEnvironment {
  const dispatchUrl = normalizeHostedExecutionBaseUrl(source.HOSTED_EXECUTION_DISPATCH_URL);
  const dispatchTimeout = normalizeHostedExecutionString(source.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS);

  return {
    dispatchTimeoutMs: parsePositiveInteger(
      dispatchTimeout,
      30_000,
      "HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS",
    ),
    dispatchUrl,
  };
}

export function readHostedExecutionControlBaseUrl(
  source: EnvSource = process.env,
): string | null {
  return normalizeHostedExecutionBaseUrl(source.HOSTED_EXECUTION_DISPATCH_URL);
}

function parsePositiveInteger(value: string | null, fallback: number, label: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return parsed;
}
