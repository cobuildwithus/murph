import {
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND,
  HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
  type HostedRuntimeWebProtocolAdmission,
} from "@murphai/hosted-execution/runtime-control";

// Synthetic wire evidence for the deployment consumer, not the Web implementation.
// Web's own tests prove that its authenticated handler derives this evidence from
// the real log parser and authority response owner.
export function syntheticHostedWebProtocolAdmission(nonce: string): HostedRuntimeWebProtocolAdmission {
  return {
    kind: HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_KIND,
    schemaVersion: HOSTED_RUNTIME_WEB_PROTOCOL_ADMISSION_VERSION,
    nonce,
    runtimeLogEventCodes: [...HOSTED_RUNTIME_LOG_EVENT_CODES],
    threadRouteAuthority: {
      direct: { authorized: true, threadIsDirect: true },
      group: { authorized: true, threadIsDirect: false },
    },
  };
}
