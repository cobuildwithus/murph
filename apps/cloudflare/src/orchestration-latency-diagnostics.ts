import type {
  HostedRuntimeOrchestrationLatencyDiagnostics,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_ORCHESTRATION_LATENCY_DIAGNOSTICS_HEADER,
  sanitizeHostedRuntimeOrchestrationLatencyDiagnostics,
} from "@murphai/hosted-execution/runtime-control";

type HeaderRecord = Readonly<Record<string, string | readonly string[] | undefined>>;

export {
  sanitizeHostedRuntimeOrchestrationLatencyDiagnostics,
  type HostedRuntimeOrchestrationLatencyDiagnostics,
};

export function buildHostedRuntimeOrchestrationLatencyHeaders(
  diagnostics: HostedRuntimeOrchestrationLatencyDiagnostics | null | undefined,
): Record<string, string> {
  const sanitized = sanitizeHostedRuntimeOrchestrationLatencyDiagnostics(diagnostics);
  if (!sanitized) {
    return {};
  }

  return {
    [HOSTED_RUNTIME_ORCHESTRATION_LATENCY_DIAGNOSTICS_HEADER]:
      JSON.stringify(sanitized),
  };
}

export function readHostedRuntimeOrchestrationLatencyHeaders(
  headers: HeaderRecord,
): HostedRuntimeOrchestrationLatencyDiagnostics | null {
  const raw = readSingleHeader(
    headers,
    HOSTED_RUNTIME_ORCHESTRATION_LATENCY_DIAGNOSTICS_HEADER,
  );
  if (raw === null) {
    return null;
  }

  try {
    return sanitizeHostedRuntimeOrchestrationLatencyDiagnostics(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readSingleHeader(headers: HeaderRecord, name: string): string | null {
  const raw = headers[name];
  if (typeof raw === "string") {
    return raw.trim();
  }
  return null;
}
