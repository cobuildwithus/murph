const CODEX_TURN_METADATA_HEADER = "x-codex-turn-metadata";
const OPENAI_MEMGEN_REQUEST_HEADER = "x-openai-memgen-request";
const INVALID_USAGE_TOKEN = Symbol("invalid-usage-token");

export const HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

export type HostedCodexNativeMemoryKind = "consolidation" | "extraction";
export type HostedCodexMemoryProviderRequestOutcome =
  | "failed"
  | "partial"
  | "succeeded";

export interface HostedCodexMemoryRequestMetadata {
  usageRequired: boolean;
  requestedModel: string;
  serviceTier: string | null;
}

export interface HostedCodexMemoryUsage {
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  inputTokens: number;
  occurredAt: string;
  outputTokens: number;
  providerRequestId: string;
  rawUsageJson: Record<string, unknown>;
  reasoningTokens: number | null;
  servedModel: string | null;
  serviceTier: string | null;
  totalTokens: number;
}

export interface HostedCodexMemoryTerminalResponse {
  providerRequestOutcome: HostedCodexMemoryProviderRequestOutcome;
  usage: HostedCodexMemoryUsage | null;
}

export type HostedCodexMemoryClientFrame =
  | { kind: "other" }
  | {
      kind: "response-create";
      metadata: HostedCodexMemoryRequestMetadata;
    }
  | { kind: "invalid-response-create" };

export type HostedCodexMemoryServerFrame =
  | { kind: "other" }
  | { kind: "terminal-error" }
  | {
      kind: "response-terminal";
      terminal: HostedCodexMemoryTerminalResponse;
    }
  | { kind: "invalid-response-terminal" };

/**
 * Codex marks both native memory phases without Murph inferring intent:
 * extraction uses request_kind=memory and consolidation uses the dedicated
 * memgen marker even though its Responses request_kind remains turn.
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


export function parseHostedCodexMemoryRequestMetadata(
  body: ArrayBuffer,
): HostedCodexMemoryRequestMetadata | null {
  try {
    return parseRequestMetadata(JSON.parse(new TextDecoder().decode(body)));
  } catch {
    return null;
  }
}

export function parseHostedCodexMemoryClientFrame(
  text: string,
): HostedCodexMemoryClientFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "other" };
  }
  if (!isJsonObject(parsed) || parsed.type !== "response.create") {
    return { kind: "other" };
  }

  const metadata = parseRequestMetadata(parsed);
  return metadata
    ? { kind: "response-create", metadata }
    : { kind: "invalid-response-create" };
}

export function parseHostedCodexMemoryServerFrame(
  text: string,
): HostedCodexMemoryServerFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "other" };
  }
  if (!isJsonObject(parsed)) {
    return { kind: "other" };
  }
  if (parsed.type === "error") {
    return { kind: "terminal-error" };
  }

  const providerRequestOutcome = readTerminalProviderRequestOutcome(parsed.type);
  if (providerRequestOutcome === null) {
    return { kind: "other" };
  }
  const terminal = parseTerminalEvent(parsed, providerRequestOutcome);
  return terminal
    ? { kind: "response-terminal", terminal }
    : { kind: "invalid-response-terminal" };
}

/**
 * HTTP and WebSocket traffic share the same terminal Responses schema. The
 * HTTP path buffers only marked native-memory responses.
 */
export function parseHostedCodexMemoryTerminalResponse(
  body: ArrayBuffer,
): HostedCodexMemoryTerminalResponse | null {
  const text = new TextDecoder().decode(body);
  const events = text.split(/\r?\n\r?\n/u);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]?.trim();
    if (!event) {
      continue;
    }
    const data = readSseData(event) ?? event;
    const parsed = parseHostedCodexMemoryServerFrame(data);
    if (parsed.kind === "response-terminal") {
      return parsed.terminal;
    }
    if (parsed.kind === "invalid-response-terminal") {
      return null;
    }
  }
  return null;
}

function parseRequestMetadata(
  value: unknown,
): HostedCodexMemoryRequestMetadata | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const requestedModel = readNonEmptyString(value.model);
  if (!requestedModel) {
    return null;
  }
  if (value.generate !== undefined && typeof value.generate !== "boolean") {
    return null;
  }

  return {
    usageRequired: value.generate !== false,
    requestedModel,
    serviceTier: readNonEmptyString(value.service_tier),
  };
}

function parseTerminalEvent(
  event: Record<string, unknown>,
  providerRequestOutcome: HostedCodexMemoryProviderRequestOutcome,
): HostedCodexMemoryTerminalResponse | null {
  const response = event.response;
  if (!isJsonObject(response)) {
    return null;
  }
  const providerRequestId = readNonEmptyString(response.id);
  const occurredAt = readProviderOccurredAt(response.created_at);
  if (!providerRequestId || !occurredAt) {
    return null;
  }

  const servedModel = readNonEmptyString(response.model);
  const serviceTier = readNonEmptyString(response.service_tier);
  if (response.usage === undefined || response.usage === null) {
    return {
      providerRequestOutcome,
      usage: null,
    };
  }
  if (!isJsonObject(response.usage)) {
    return null;
  }
  const usage = response.usage;
  const inputTokens = readNonNegativeInteger(usage.input_tokens);
  const outputTokens = readNonNegativeInteger(usage.output_tokens);
  const totalTokens = readNonNegativeInteger(usage.total_tokens);
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    return null;
  }

  const cachedInputTokens = readOptionalNestedUsageToken(
    usage,
    "input_tokens_details",
    "cached_tokens",
  );
  const cacheWriteTokens = readOptionalNestedUsageToken(
    usage,
    "input_tokens_details",
    "cache_write_tokens",
  );
  const reasoningTokens = readOptionalNestedUsageToken(
    usage,
    "output_tokens_details",
    "reasoning_tokens",
  );
  if (
    cachedInputTokens === INVALID_USAGE_TOKEN
    || cacheWriteTokens === INVALID_USAGE_TOKEN
    || reasoningTokens === INVALID_USAGE_TOKEN
  ) {
    return null;
  }
  if (
    inputTokens > Number.MAX_SAFE_INTEGER - outputTokens
    || totalTokens !== inputTokens + outputTokens
    || (cachedInputTokens ?? 0) > inputTokens
    || (cacheWriteTokens ?? 0) > inputTokens
    || (reasoningTokens ?? 0) > outputTokens
  ) {
    return null;
  }

  const rawUsageJson: Record<string, unknown> = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
  if (cachedInputTokens !== null || cacheWriteTokens !== null) {
    rawUsageJson.input_tokens_details = {
      ...(cachedInputTokens === null ? {} : { cached_tokens: cachedInputTokens }),
      ...(cacheWriteTokens === null ? {} : { cache_write_tokens: cacheWriteTokens }),
    };
  }
  if (reasoningTokens !== null) {
    rawUsageJson.output_tokens_details = { reasoning_tokens: reasoningTokens };
  }

  return {
    providerRequestOutcome,
    usage: {
      cacheWriteTokens,
      cachedInputTokens,
      inputTokens,
      occurredAt,
      outputTokens,
      providerRequestId,
      rawUsageJson,
      reasoningTokens,
      servedModel,
      serviceTier,
      totalTokens,
    },
  };
}

export function hasHostedCodexMemoryBillableUsage(
  usage: HostedCodexMemoryUsage,
): boolean {
  return usage.inputTokens > 0
    || usage.outputTokens > 0
    || usage.totalTokens > 0
    || (usage.cachedInputTokens ?? 0) > 0
    || (usage.cacheWriteTokens ?? 0) > 0
    || (usage.reasoningTokens ?? 0) > 0;
}

function readTerminalProviderRequestOutcome(
  type: unknown,
): HostedCodexMemoryProviderRequestOutcome | null {
  if (type === "response.completed") return "succeeded";
  if (type === "response.incomplete") return "partial";
  if (type === "response.failed") return "failed";
  return null;
}

function readProviderOccurredAt(value: unknown): string | null {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    return null;
  }
  const milliseconds = value * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    return null;
  }
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readOptionalNestedUsageToken(
  usage: Record<string, unknown>,
  detailsKey: string,
  tokenKey: string,
): number | null | typeof INVALID_USAGE_TOKEN {
  const details = usage[detailsKey];
  if (details === undefined) {
    return null;
  }
  if (!isJsonObject(details)) {
    return INVALID_USAGE_TOKEN;
  }

  const value = details[tokenKey];
  if (value === undefined) {
    return null;
  }
  return readNonNegativeInteger(value) ?? INVALID_USAGE_TOKEN;
}

function readSseData(event: string): string | null {
  const dataLines = event
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 0
    ? value
    : null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
