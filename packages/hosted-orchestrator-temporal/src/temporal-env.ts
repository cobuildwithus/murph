import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "@murphai/hosted-execution/orchestration-control";

const DEFAULT_TEMPORAL_ADDRESS = "localhost:7233";
const DEFAULT_TEMPORAL_NAMESPACE = "default";

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedRuntimeTemporalEnvironment {
  address: string;
  namespace: string;
  taskQueue: string;
  tls: boolean;
}

export function readHostedRuntimeTemporalEnvironment(
  source: EnvSource = process.env,
): HostedRuntimeTemporalEnvironment {
  return {
    address:
      readOptionalTrimmedString(source.TEMPORAL_ADDRESS)
      ?? DEFAULT_TEMPORAL_ADDRESS,
    namespace:
      readOptionalTrimmedString(source.TEMPORAL_NAMESPACE)
      ?? DEFAULT_TEMPORAL_NAMESPACE,
    taskQueue:
      readOptionalTrimmedString(source.TEMPORAL_TASK_QUEUE)
      ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
    tls: readBooleanEnv(source.TEMPORAL_TLS_ENABLED, "TEMPORAL_TLS_ENABLED"),
  };
}

function readOptionalTrimmedString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readBooleanEnv(value: string | undefined, label: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  throw new TypeError(`${label} must be true or false.`);
}
