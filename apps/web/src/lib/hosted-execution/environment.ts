import {
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

export interface HostedExecutionControlEnvironment {
  controlBaseUrl: string | null;
  controlTimeoutMs: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedExecutionControlEnvironment(
  source: EnvSource = process.env,
): HostedExecutionControlEnvironment {
  const controlBaseUrl = normalizeHostedExecutionBaseUrl(source.HOSTED_EXECUTION_CONTROL_URL, {
    allowHttpLocalhost: true,
  });
  const controlTimeout = normalizeHostedExecutionString(source.HOSTED_EXECUTION_CONTROL_TIMEOUT_MS);

  return {
    controlBaseUrl,
    controlTimeoutMs: parsePositiveInteger(
      controlTimeout,
      30_000,
      "HOSTED_EXECUTION_CONTROL_TIMEOUT_MS",
    ),
  };
}

export function readHostedExecutionControlBaseUrl(
  source: EnvSource = process.env,
): string | null {
  return readHostedExecutionControlEnvironment(source).controlBaseUrl;
}

export function readHostedExecutionControlOrigin(
  source: EnvSource = process.env,
): string | null {
  const controlBaseUrl = readHostedExecutionControlBaseUrl(source);
  return controlBaseUrl ? new URL(controlBaseUrl).origin : null;
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
