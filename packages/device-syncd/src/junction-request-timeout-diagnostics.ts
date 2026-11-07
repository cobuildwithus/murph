import type { JunctionRequestTimeoutDiagnosticDetails } from "./types.ts";

/** Diagnostic bounds only: never used to configure requests, retries, or jobs. */
export function readSafeJunctionRequestTimeoutDiagnostics(
  code: string,
  input: Partial<Record<keyof JunctionRequestTimeoutDiagnosticDetails, unknown>> = {},
): JunctionRequestTimeoutDiagnosticDetails {
  if (code !== "JUNCTION_API_REQUEST_TIMEOUT") return {};

  const details: JunctionRequestTimeoutDiagnosticDetails = {};
  for (const [field, minimum, maximum] of [
    ["providerRequestTimeoutMs", 1, 300_000],
    ["providerRequestElapsedMs", 0, 300_000],
    ["providerRequestAttempt", 1, 100],
  ] as const) {
    const value = input[field];
    if (typeof value === "number" && Number.isSafeInteger(value)
      && value >= minimum && value <= maximum) {
      details[field] = value;
    }
  }
  const stage = input.providerRequestStage;
  if (stage === "request_setup" || stage === "awaiting_headers"
    || stage === "response_body" || stage === "post_body") {
    details.providerRequestStage = stage;
  }
  if (typeof input.providerResponseHeadersPresent === "boolean") {
    details.providerResponseHeadersPresent = input.providerResponseHeadersPresent;
  }
  return details;
}
