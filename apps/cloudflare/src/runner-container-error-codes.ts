export const HOSTED_RUNNER_SHUTTING_DOWN_ERROR_CODE = "HOSTED_RUNNER_SHUTTING_DOWN";

export type RunnerContainerColdWaitDirectCause =
  | "native_no_instance"
  | "port_not_listening"
  | "other"
  | "absent"
  | "unreadable";

export function classifyRunnerContainerColdWaitDirectCause(
  error: unknown,
): RunnerContainerColdWaitDirectCause {
  try {
    if (!(error instanceof Error)) {
      return "other";
    }
    const cause: unknown = error.cause;
    if (cause === undefined) {
      return "absent";
    }
    if (!(cause instanceof Error)) {
      return "other";
    }
    // Only the last retained direct Error cause; never infer a provider root cause.
    const message: unknown = cause.message;
    switch (message) {
      case "there is no container instance that can be provided to this durable object":
        return "native_no_instance";
      case "the container is not listening":
        return "port_not_listening";
      default:
        return "other";
    }
  } catch {
    return "unreadable";
  }
}
