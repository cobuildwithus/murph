import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import {
  buildHostedRuntimeLogProtocolProbe,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
  type HostedRuntimeWebProtocolAdmission,
} from "@murphai/hosted-execution/runtime-control";

export function buildHostedThreadRouteAuthorityResponse(
  threadIsDirect: boolean,
  assistantAskFallbackRequired?: boolean,
) {
  return {
    authorized: true,
    threadIsDirect,
    ...(assistantAskFallbackRequired ? { assistantAskFallbackRequired: true } : {}),
  };
}

export function buildHostedRuntimeWebProtocolAdmission(nonce: string): HostedRuntimeWebProtocolAdmission {
  return {
    kind: HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND,
    schemaVersion: HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
    nonce,
    // This is the same parser imported by the real /hosted-runtime/log route.
    // No log is persisted and no member, provider or runner is accessed.
    runtimeLogEventCodes: HOSTED_RUNTIME_LOG_EVENT_CODES.map(eventCode =>
      parseHostedRuntimeLogRequest(buildHostedRuntimeLogProtocolProbe(eventCode)).entries[0]!.eventCode),
    threadRouteAuthority: {
      direct: buildHostedThreadRouteAuthorityResponse(true),
      group: buildHostedThreadRouteAuthorityResponse(false),
    },
  };
}
