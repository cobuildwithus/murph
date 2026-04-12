import {
  normalizeHostedExecutionErrorMessage,
  normalizeHostedExecutionOperatorMessage,
} from "@murphai/hosted-execution";

export function formatHostedExecutionSafeLogError(error: unknown): string {
  return normalizeHostedExecutionOperatorMessage(
    normalizeHostedExecutionErrorMessage(error),
  );
}
