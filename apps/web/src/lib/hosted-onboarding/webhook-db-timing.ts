import type { PrismaOperationTiming } from "../prisma-operation-timing";
import type { HostedOnboardingStructuredLogDetails } from "./logging";

const MAX_LOGGED_OPERATIONS = 24;

/**
 * Flattens collected Prisma operation timings into the flat key→scalar shape
 * the hosted-onboarding structured logs use: a count, a total, and one
 * `dbNN.<model>.<operation>` entry per operation in execution order.
 */
export function buildHostedWebhookDbTimingLogDetails(
  operations: PrismaOperationTiming[],
): HostedOnboardingStructuredLogDetails {
  const details: HostedOnboardingStructuredLogDetails = {
    dbOperationCount: operations.length,
    dbTotalMs: Math.round(
      operations.reduce((total, operation) => total + operation.ms, 0),
    ),
  };

  operations.slice(0, MAX_LOGGED_OPERATIONS).forEach((operation, index) => {
    details[`db${String(index).padStart(2, "0")}.${operation.key}`] = Math.round(operation.ms);
  });
  if (operations.length > MAX_LOGGED_OPERATIONS) {
    details.dbOperationsTruncated = true;
  }

  return details;
}
