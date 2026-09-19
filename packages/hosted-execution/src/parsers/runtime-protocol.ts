import {
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
} from "../runtime-control.ts";
import { requireObject } from "./assertions.ts";

// Preserve the legacy response for callers which do not need an audience.
// Scheduled delivery still independently requires the live owner's boolean.
export function parseHostedExternalThreadRouteAuthorityResponse(
  value: unknown,
): { assistantAskFallbackRequired?: boolean; threadIsDirect?: boolean } | void {
  const record = requireObject(value, "Hosted external thread route authority response");
  const { authorized, assistantAskFallbackRequired, threadIsDirect } = record;
  if (
    authorized !== true
    || (assistantAskFallbackRequired !== undefined && typeof assistantAskFallbackRequired !== "boolean")
    || (threadIsDirect !== undefined && typeof threadIsDirect !== "boolean")
  ) {
    throw new TypeError("Hosted external thread route authority response is invalid.");
  }
  if (threadIsDirect === undefined && assistantAskFallbackRequired === undefined) return;
  return {
    ...(typeof assistantAskFallbackRequired === "boolean" ? { assistantAskFallbackRequired } : {}),
    ...(typeof threadIsDirect === "boolean" ? { threadIsDirect } : {}),
  };
}

export function assertHostedRuntimeWebProtocolAdmission(
  value: unknown,
  nonce: string,
): void {
  const record = requireObject(value, "Hosted Web protocol admission");
  if (record.kind !== HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND
    || record.schemaVersion !== HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION
    || record.nonce !== nonce) {
    throw new Error("Hosted Web protocol admission failed: version_or_nonce.");
  }
  const codes = record.runtimeLogEventCodes;
  if (!Array.isArray(codes) || codes.some(code => typeof code !== "string")) {
    throw new Error("Hosted Web protocol admission failed: runtime_log_evidence.");
  }
  // A newer reader's superset is valid; source revision ordering is irrelevant.
  for (const required of HOSTED_RUNTIME_LOG_EVENT_CODES) {
    if (!codes.includes(required)) {
      // Only locally owned enum values enter diagnostics, never response text.
      throw new Error(`Hosted Web protocol admission failed: runtime_log_event:${required}.`);
    }
  }
  let direct: ReturnType<typeof parseHostedExternalThreadRouteAuthorityResponse>;
  let group: ReturnType<typeof parseHostedExternalThreadRouteAuthorityResponse>;
  try {
    const routes = requireObject(record.threadRouteAuthority, "Thread route evidence");
    direct = parseHostedExternalThreadRouteAuthorityResponse(routes.direct);
    group = parseHostedExternalThreadRouteAuthorityResponse(routes.group);
  } catch {
    throw new Error("Hosted Web protocol admission failed: thread_route_audience.");
  }
  if (direct?.threadIsDirect !== true || group?.threadIsDirect !== false) {
    throw new Error("Hosted Web protocol admission failed: thread_route_audience.");
  }
}
