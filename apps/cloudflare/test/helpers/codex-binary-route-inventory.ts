const CONCATENATED_ROUTE_LITERALS: Readonly<Record<string, string>> = {
  "/v1/agent/register/backend-api": "/v1/agent/register",
  "/v1/liveazurefd.": "/v1/live",
  "/v1/livebusinessend_turnthread": "/v1/live",
  "/v1/livecityargscoregoalusedcoveechosagevaleargv": "/v1/live",
  "/v1/metricsclient-": "/v1/metrics",
  "/v1/metricsstatsig-api-keyclient-": "/v1/metrics",
  "/v1/realtimewswsshttpsquicksilverintentmodelevent": "/v1/realtime",
  "/v1/realtimewswsshttpsmodelevent": "/v1/realtime",
  "/v1/tokenevent": "/v1/token",
  "/v1/user-auth-credential/whoamievent": "/v1/user-auth-credential/whoami",
};

const FULL_ROUTE_PATTERN =
  /\/v1\/[a-z0-9][a-z0-9_{}:.-]*(?:\/[a-z0-9][a-z0-9_{}:.-]*)*/gu;
const OPENAI_PROVIDER_BASE = "https://api.openai.com/v1";
const PROVIDER_ANCHORED_RELATIVE_ROUTE_PATTERN =
  /^(?:\s+|\/)([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*)(?=$|[^a-z0-9_\/-])/u;

export interface CodexBinaryRouteDiscoveryOptions {
  reviewedRelativeProviderRoutes?: readonly string[];
}

/**
 * Discovers conservative route candidates from the exact installed native
 * Codex artifact. Rust may concatenate adjacent string constants, so known
 * full-route prefixes are trimmed to their reviewed boundary. Unknown full
 * `/v1/**` literals are intentionally returned unchanged and fail conformance
 * until they receive an explicit disposition. The caller supplies the complete
 * source-reviewed relative-route set for the pin; an unknown single- or
 * multi-segment relative route separated from the OpenAI provider base by a
 * slash or whitespace is retained independently. Separator-free linker
 * concatenations are intentionally covered by the source-owned route list,
 * because arbitrary adjacent binary text cannot identify a route boundary.
 * Binary discovery corroborates the verified upstream source inventory; it is
 * not the authoritative inventory owner.
 */
export function discoverCodexBinaryRouteCandidates(
  binary: Buffer,
  options: CodexBinaryRouteDiscoveryOptions = {},
): string[] {
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
        options.reviewedRelativeProviderRoutes ?? [],
      );
    }
    printableStart = -1;
  }

  return [...candidates].sort();
}

function discoverFromPrintableSequence(
  sequence: string,
  candidates: Set<string>,
  reviewedRelativeProviderRoutes: readonly string[],
): void {
  for (const match of sequence.matchAll(FULL_ROUTE_PATTERN)) {
    candidates.add(normalizeFullRouteCandidate(match[0]));
  }
  for (const relativeRoute of reviewedRelativeProviderRoutes) {
    if (sequence.includes(relativeRoute)) {
      candidates.add(`/v1/${relativeRoute}`);
    }
  }
  discoverProviderAnchoredRelativeRoutes(sequence, candidates);
}

function discoverProviderAnchoredRelativeRoutes(
  sequence: string,
  candidates: Set<string>,
): void {
  const markerIndex = sequence.indexOf(OPENAI_PROVIDER_BASE);
  if (markerIndex < 0) {
    return;
  }
  const suffix = sequence.slice(markerIndex + OPENAI_PROVIDER_BASE.length);
  const relativeRoute = PROVIDER_ANCHORED_RELATIVE_ROUTE_PATTERN.exec(suffix)?.[1];
  if (relativeRoute !== undefined) {
    candidates.add(`/v1/${relativeRoute}`);
  }
}

function normalizeFullRouteCandidate(candidate: string): string {
  return CONCATENATED_ROUTE_LITERALS[candidate] ?? candidate;
}
