const CONCATENATED_ROUTE_LITERALS: Readonly<Record<string, string>> = {
  "/v1/agent/register/backend-api": "/v1/agent/register",
  "/v1/liveazurefd.": "/v1/live",
  "/v1/metricsstatsig-api-keyclient-": "/v1/metrics",
  "/v1/realtimewswsshttpsmodelevent": "/v1/realtime",
  "/v1/tokenevent": "/v1/token",
};

const RELATIVE_PROVIDER_ROUTES = [
  "alpha/search",
  "realtime/calls",
  "responses/compact",
] as const;

const FULL_ROUTE_PATTERN =
  /\/v1\/[a-z0-9][a-z0-9_{}:.-]*(?:\/[a-z0-9][a-z0-9_{}:.-]*)*/gu;

/**
 * Discovers conservative route candidates from the exact installed native
 * Codex artifact. Rust may concatenate adjacent string constants, so known
 * full-route prefixes are trimmed to their reviewed boundary. Unknown full
 * `/v1/**` literals are intentionally returned unchanged and fail conformance
 * until they receive an explicit disposition.
 */
export function discoverCodexBinaryRouteCandidates(binary: Buffer): string[] {
  const candidates = new Set<string>();
  let printableStart = -1;

  for (let index = 0; index <= binary.byteLength; index += 1) {
    const byte = index < binary.byteLength ? binary[index] : 0;
    const printable = byte !== undefined && byte >= 0x20 && byte <= 0x7e;
    if (printable && printableStart < 0) {
      printableStart = index;
      continue;
    }
    if (printable || printableStart < 0) {
      continue;
    }
    if (index - printableStart >= 4) {
      discoverFromPrintableSequence(
        binary.subarray(printableStart, index).toString("ascii"),
        candidates,
      );
    }
    printableStart = -1;
  }

  return [...candidates].sort();
}

function discoverFromPrintableSequence(
  sequence: string,
  candidates: Set<string>,
): void {
  for (const match of sequence.matchAll(FULL_ROUTE_PATTERN)) {
    candidates.add(normalizeFullRouteCandidate(match[0]));
  }
  for (const relativeRoute of RELATIVE_PROVIDER_ROUTES) {
    if (sequence.includes(relativeRoute)) {
      candidates.add(`/v1/${relativeRoute}`);
    }
  }
}

function normalizeFullRouteCandidate(candidate: string): string {
  return CONCATENATED_ROUTE_LITERALS[candidate] ?? candidate;
}
