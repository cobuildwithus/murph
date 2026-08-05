const CODEX_TURN_METADATA_HEADER = "x-codex-turn-metadata";
const OPENAI_MEMGEN_REQUEST_HEADER = "x-openai-memgen-request";

export type HostedCodexNativeMemoryKind = "consolidation" | "extraction";

/**
 * Codex marks both native-memory phases without Murph inferring intent:
 * extraction uses request_kind=memory and consolidation uses the dedicated
 * memgen marker even though its Responses request_kind remains turn.
 *
 * Hosted config disables both phases. The runner retains only this classifier
 * so unexpected or stale marked requests can fail closed at the egress boundary.
 */
export function readHostedCodexNativeMemoryKind(
  headers: Headers,
): HostedCodexNativeMemoryKind | null {
  if (headers.get(OPENAI_MEMGEN_REQUEST_HEADER)?.trim().toLowerCase() === "true") {
    return "consolidation";
  }

  const metadata = headers.get(CODEX_TURN_METADATA_HEADER);
  if (!metadata) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(metadata);
    return isJsonObject(parsed) && parsed.request_kind === "memory"
      ? "extraction"
      : null;
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
