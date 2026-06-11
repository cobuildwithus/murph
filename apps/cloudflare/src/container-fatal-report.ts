import {
  buildHostedExecutionSafeErrorDetails,
  deriveHostedExecutionErrorCode,
  readHostedExecutionSafeErrorName,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";

import { CLOUDFLARE_HOSTED_CONTAINER_FATAL_ENDPOINT } from "./internal-hosts.ts";
import { HOSTED_RUNNER_BOUND_USER_ID_HEADER } from "./runner-outbound/headers.ts";

// Container stdout is console-only: once the entrypoint process exits, the
// reason is unrecoverable (2026-06-11 rollback incidents: repeated unrequested
// exit-1 stops with no attributable cause). A fatal report is one bounded POST
// through the egress intercept that leaves a durable worker-side log line
// before the process exits.

export const HOSTED_CONTAINER_FATAL_STAGES = [
  "ambiguous_abort_poison",
  "entrypoint_start_failed",
  "shell_isolation_poison",
  "uncaught_exception",
  "unhandled_rejection",
] as const;

export type HostedContainerFatalStage =
  (typeof HOSTED_CONTAINER_FATAL_STAGES)[number];

export const HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS = 1_500;

export interface HostedContainerFatalReportPayload {
  errorCode: string;
  errorName?: string;
  safeErrorDetails?: HostedExecutionStructuredLogDetails;
  stage: HostedContainerFatalStage;
}

export function buildHostedContainerFatalReportPayload(input: {
  error: unknown;
  stage: HostedContainerFatalStage;
}): HostedContainerFatalReportPayload {
  // buildHostedExecutionSafeErrorDetails is the shared redaction helper: it
  // sanitizes message/stack/cause/own-properties before anything leaves the
  // container.
  const errorName = readHostedExecutionSafeErrorName(input.error);
  const safeErrorDetails = buildHostedExecutionSafeErrorDetails(input.error);
  return {
    errorCode: deriveHostedExecutionErrorCode(input.error),
    ...(errorName ? { errorName } : {}),
    ...(safeErrorDetails ? { safeErrorDetails } : {}),
    stage: input.stage,
  };
}

export async function reportHostedContainerFatalBestEffort(input: {
  boundUserId?: string | null;
  error: unknown;
  fetchImpl?: typeof fetch;
  stage: HostedContainerFatalStage;
}): Promise<void> {
  // Best-effort by contract: a failed or slow report must never change exit
  // behavior, throw, or create a new unhandled rejection while the process is
  // already dying.
  try {
    const fetchImpl = input.fetchImpl ?? fetch;
    await fetchImpl(CLOUDFLARE_HOSTED_CONTAINER_FATAL_ENDPOINT, {
      body: JSON.stringify(buildHostedContainerFatalReportPayload(input)),
      headers: {
        "content-type": "application/json",
        ...(input.boundUserId
          ? { [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: input.boundUserId }
          : {}),
      },
      method: "POST",
      signal: AbortSignal.timeout(HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS),
    });
  } catch {
    // Swallow: the structured console log already happened; the report is the
    // durable bonus, not a requirement.
  }
}
