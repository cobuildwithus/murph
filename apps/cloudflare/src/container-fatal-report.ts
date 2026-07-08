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

const HOSTED_CONTAINER_FATAL_STAGES = [
  "ambiguous_abort_poison",
  "entrypoint_start_failed",
  "uncaught_exception",
  "unhandled_rejection",
] as const;

export type HostedContainerFatalStage =
  (typeof HOSTED_CONTAINER_FATAL_STAGES)[number];

export const HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS = 1_500;

// Client-side cap with headroom under the worker route's 8KB body limit so an
// oversized sanitized payload degrades to a truncated envelope instead of a
// silently dropped 413 (fetch does not throw on HTTP error statuses, so the
// reporter would otherwise treat the rejection as success).
export const HOSTED_CONTAINER_FATAL_REPORT_MAX_BODY_BYTES = 6 * 1024;

export interface HostedContainerFatalReportPayload {
  detailsTruncated?: boolean;
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

export function buildHostedContainerFatalReportBody(input: {
  error: unknown;
  stage: HostedContainerFatalStage;
}): string {
  const payload = buildHostedContainerFatalReportPayload(input);
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength
    <= HOSTED_CONTAINER_FATAL_REPORT_MAX_BODY_BYTES) {
    return serialized;
  }

  // The envelope (stage + error codes) is what makes the death attributable;
  // oversized sanitized details are dropped rather than risking the whole
  // report.
  const { safeErrorDetails: _droppedDetails, ...envelope } = payload;
  return JSON.stringify({
    ...envelope,
    detailsTruncated: true,
  });
}

export async function reportHostedContainerFatalBestEffort(input: {
  boundUserId?: string | null;
  error: unknown;
  fetchImpl?: typeof fetch;
  stage: HostedContainerFatalStage;
}): Promise<void> {
  // Best-effort by contract: a failed or slow report must never change exit
  // behavior, throw, or create a new unhandled rejection while the process is
  // already dying. The hard deadline lives here (not in callers) so every
  // exit path gets the same bound even if fetch ignores its abort signal.
  try {
    const fetchImpl = input.fetchImpl ?? fetch;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const deadlinePromise = new Promise<void>((resolve) => {
      deadline = setTimeout(resolve, HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS + 500);
      deadline.unref?.();
    });
    try {
      await Promise.race([
        fetchImpl(CLOUDFLARE_HOSTED_CONTAINER_FATAL_ENDPOINT, {
          body: buildHostedContainerFatalReportBody(input),
          headers: {
            "content-type": "application/json",
            ...(input.boundUserId
              ? { [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: input.boundUserId }
              : {}),
          },
          method: "POST",
          signal: AbortSignal.timeout(HOSTED_CONTAINER_FATAL_REPORT_TIMEOUT_MS),
        }).then(() => undefined, () => undefined),
        deadlinePromise,
      ]);
    } finally {
      clearTimeout(deadline);
    }
  } catch {
    // Swallow: the structured console log already happened; the report is the
    // durable bonus, not a requirement.
  }
}
