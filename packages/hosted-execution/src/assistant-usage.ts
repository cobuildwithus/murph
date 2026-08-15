import { createHash, createHmac, randomUUID } from "node:crypto";

export const ASSISTANT_USAGE_SCHEMA = "murph.assistant-usage.v1";
export const ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_SOURCE_PATH =
  "codex.idle_compact.estimated_context_tokens";
export const ASSISTANT_IDLE_COMPACTION_USAGE_ESTIMATE_VERSION =
  "codex-idle-compact-estimate-v1";
const HOSTED_MEMBER_AI_CREDENTIAL_ENV_KEYS = new Set<string>(["OPENAI_API_KEY"]);
const ASSISTANT_USAGE_REPORTING_USER_ID_HMAC_CONTEXT =
  "murph.assistant-usage.reporting-user.v1";
const ASSISTANT_USAGE_RAW_TOKEN_KEYS = new Set<string>([
  "cacheWriteInputTokens",
  "cacheWriteTokens",
  "cache_write_tokens",
  "cachedInputTokens",
  "cached_input_tokens",
  "completionTokens",
  "completion_tokens",
  "inputTokens",
  "input_tokens",
  "outputTokens",
  "output_tokens",
  "promptTokens",
  "prompt_tokens",
  "reasoningTokens",
  "reasoning_tokens",
  "reasoningOutputTokens",
  "totalTokens",
  "total_tokens",
]);
const ASSISTANT_USAGE_RAW_DETAIL_TOKEN_KEYS = new Map<string, ReadonlySet<string>>([
  ["input_tokens_details", new Set([
    "cache_write_tokens",
    "cached_tokens",
    "image_tokens",
    "text_tokens",
  ])],
  ["output_tokens_details", new Set(["image_tokens", "reasoning_tokens", "text_tokens"])],
  ["prompt_tokens_details", new Set(["cached_tokens"])],
]);
// Audio transcription usage is metered by audio duration rather than tokens.
// These keys carry the cost basis for duration-priced rows and stay under the
// same non-negative-integer rule as the token keys.
const ASSISTANT_USAGE_RAW_AUDIO_KEYS = new Set<string>([
  "audioBytes",
  "durationMs",
]);
const ASSISTANT_USAGE_RAW_TTS_KEYS = new Set<string>([
  "characterCount",
]);
// Provider-reported billed cost for pass-through-priced rows (today: xAI
// x_search). Integer ticks where 1 USD = 10^10 ticks, so the same
// non-negative-integer rule applies.
const ASSISTANT_USAGE_RAW_COST_KEYS = new Set<string>([
  "cost_in_usd_ticks",
]);
export const ASSISTANT_TURN_PROFILE_SCHEMA_V1 = "murph.assistant-turn-profile.v1";
export const ASSISTANT_TURN_PROFILE_SCHEMA = "murph.assistant-turn-profile.v2";
export const ASSISTANT_TURN_PROFILE_MAX_REQUESTS = 32;
export const ASSISTANT_TURN_PROFILE_MAX_TOOLS = 16;
export const ASSISTANT_TURN_PROFILE_MAX_TOOL_LABEL_LENGTH = 64;
const ASSISTANT_TURN_PROFILE_TOOL_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/ -]*$/u;
const ASSISTANT_TURN_PROFILE_IDENTIFIER_COMPONENT_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const ASSISTANT_TURN_PROFILE_IDENTIFIER_COMPONENT_MAX_LENGTH = 48;
const ASSISTANT_TURN_PROFILE_TOOL_KINDS = new Set([
  "command",
  "dynamic_tool",
  "mcp_tool",
]);
export const ASSISTANT_TURN_PROFILE_COMMAND_FAMILIES = [
  "cat",
  "command",
  "curl",
  "food.search-labels",
  "food.search-labels-batch",
  "goal.list",
  "goal.show",
  "head",
  "jq",
  "meal.add",
  "meal.edit",
  "meal.nutrients",
  "meal.show",
  "meal.totals",
  "node",
  "other",
  "printf",
  "python",
  "python3",
  "search",
  "sed",
  "tail",
  "vault-cli audit",
  "vault-cli automation",
  "vault-cli blood-test",
  "vault-cli event",
  "vault-cli exercise",
  "vault-cli food",
  "vault-cli knowledge",
  "vault-cli meal",
  "vault-cli batch",
  "vault-cli memory show",
  "vault-cli wearables",
  "vault-cli workout",
] as const;
export type AssistantTurnProfileCommandFamily =
  (typeof ASSISTANT_TURN_PROFILE_COMMAND_FAMILIES)[number];
const ASSISTANT_TURN_PROFILE_COMMAND_FAMILY_SET = new Set<string>(
  ASSISTANT_TURN_PROFILE_COMMAND_FAMILIES,
);

export function isAssistantTurnProfileCommandFamily(
  value: unknown,
): value is AssistantTurnProfileCommandFamily {
  return typeof value === "string"
    && ASSISTANT_TURN_PROFILE_COMMAND_FAMILY_SET.has(value);
}

export function buildAssistantTurnProfileToolIdentityLabel(input: {
  context: string | null;
  kind: "dynamic_tool" | "mcp_tool";
  tool: string | null;
}): string {
  const genericLabel = input.kind;
  const context = input.context ?? "";
  if (
    input.tool === null
    || !isAssistantTurnProfileIdentifierComponent(input.tool)
    || (
      input.context !== null
      && !isAssistantTurnProfileIdentifierComponent(input.context)
    )
  ) {
    return genericLabel;
  }

  const contextPrefix = input.kind === "mcp_tool" ? "s" : "n";
  const label = `${contextPrefix}${context.length}_${context}t${input.tool.length}_${input.tool}`;
  return label.length <= ASSISTANT_TURN_PROFILE_MAX_TOOL_LABEL_LENGTH
    ? label
    : genericLabel;
}

function isAssistantTurnProfileIdentifierComponent(value: string): boolean {
  return value.length <= ASSISTANT_TURN_PROFILE_IDENTIFIER_COMPONENT_MAX_LENGTH
    && ASSISTANT_TURN_PROFILE_IDENTIFIER_COMPONENT_PATTERN.test(value);
}

function isAssistantTurnProfileToolIdentityLabel(
  kind: "dynamic_tool" | "mcp_tool",
  label: string,
): boolean {
  if (label === kind) {
    return true;
  }

  const prefix = kind === "mcp_tool" ? "s" : "n";
  if (!label.startsWith(prefix)) {
    return false;
  }
  const contextLengthEnd = label.indexOf("_", prefix.length);
  if (contextLengthEnd < 0) {
    return false;
  }
  const contextLengthText = label.slice(prefix.length, contextLengthEnd);
  const contextLength = readCanonicalTurnProfileLength(contextLengthText);
  if (
    contextLength === null
    || contextLength > ASSISTANT_TURN_PROFILE_IDENTIFIER_COMPONENT_MAX_LENGTH
  ) {
    return false;
  }
  const contextStart = contextLengthEnd + 1;
  const contextEnd = contextStart + contextLength;
  const context = label.slice(contextStart, contextEnd);
  if (
    context.length !== contextLength
    || (context.length > 0 && !isAssistantTurnProfileIdentifierComponent(context))
    || label[contextEnd] !== "t"
  ) {
    return false;
  }

  const toolLengthStart = contextEnd + 1;
  const toolLengthEnd = label.indexOf("_", toolLengthStart);
  if (toolLengthEnd < 0) {
    return false;
  }
  const toolLengthText = label.slice(toolLengthStart, toolLengthEnd);
  const toolLength = readCanonicalTurnProfileLength(toolLengthText);
  if (
    toolLength === null
    || toolLength === 0
    || toolLength > ASSISTANT_TURN_PROFILE_IDENTIFIER_COMPONENT_MAX_LENGTH
  ) {
    return false;
  }
  const tool = label.slice(toolLengthEnd + 1);
  return tool.length === toolLength
    && isAssistantTurnProfileIdentifierComponent(tool);
}

function readCanonicalTurnProfileLength(value: string): number | null {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export type AssistantUsageCredentialSource = "member" | "platform" | "unknown";
export type AssistantProviderRequestOutcome =
  | "aborted"
  | "failed"
  | "partial"
  | "succeeded";
export type AssistantUsageTokenPricingBasis =
  | "openai-flex"
  | "standard";
export type AssistantUsageStripeMeterSource = "murph";

export interface AssistantUsageRecord {
  apiKeyEnv: string | null;
  attemptCount: number;
  baseUrl: string | null;
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  credentialSource: AssistantUsageCredentialSource;
  featureKey: string | null;
  gatewayTags: string[];
  inputTokens: number | null;
  memberId: string | null;
  occurredAt: string;
  outputTokens: number | null;
  provider: string;
  providerName: string | null;
  providerRequestId: string | null;
  providerRequestOutcome?: AssistantProviderRequestOutcome;
  providerRequestOrdinal?: number;
  rawUsageJson: Record<string, unknown> | null;
  rawUsageJsonHash: string | null;
  reasoningTokens: number | null;
  reportingUserId: string | null;
  requestedModel: string | null;
  routeId: string | null;
  schema: typeof ASSISTANT_USAGE_SCHEMA;
  servedModel: string | null;
  sessionId: string;
  stripeMeterSource: AssistantUsageStripeMeterSource;
  surface: string | null;
  tokenPricingBasis: AssistantUsageTokenPricingBasis;
  totalTokens: number | null;
  triggerKind: string | null;
  turnId: string;
  turnProfileJson: Record<string, unknown> | null;
  usageId: string;
  usageExtractionSourcePath: string | null;
  usageExtractionVersion: string;
}

export interface AssistantOpenAiImageUsageBasisInput {
  cachedInputTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  rawUsageJson: Record<string, unknown> | null;
  totalTokens: number | null;
}

export interface AssistantOpenAiImageUsageTokenBuckets {
  billableImageInputTokens: bigint;
  billableTextInputTokens: bigint;
  cachedImageInputTokens: bigint;
  cachedInputTokens: bigint;
  cachedTextInputTokens: bigint;
  imageInputTokens: bigint;
  outputTokens: bigint;
  textInputTokens: bigint;
}

export type AssistantOpenAiImageUsageUnpriceableReason =
  | "inconsistent_provider_usage_tokens"
  | "missing_provider_usage_tokens";

export type AssistantOpenAiImageUsageBasis =
  | {
    priceable: true;
    tokenBuckets: AssistantOpenAiImageUsageTokenBuckets;
  }
  | {
    priceable: false;
    reason: AssistantOpenAiImageUsageUnpriceableReason;
  };

export function classifyAssistantOpenAiImageUsageBasis(
  input: AssistantOpenAiImageUsageBasisInput,
): AssistantOpenAiImageUsageBasis {
  const totalInputTokens = readAssistantOpenAiImageAggregateToken(
    input,
    "inputTokens",
    "input_tokens",
  );
  if (totalInputTokens.kind === "invalid") return inconsistentOpenAiImageUsageBasis();

  const totalOutputTokens = readAssistantOpenAiImageAggregateToken(
    input,
    "outputTokens",
    "output_tokens",
  );
  if (totalOutputTokens.kind === "invalid") return inconsistentOpenAiImageUsageBasis();

  const totalTokens = readAssistantOpenAiImageAggregateToken(
    input,
    "totalTokens",
    "total_tokens",
  );
  if (totalTokens.kind === "invalid") return inconsistentOpenAiImageUsageBasis();
  if (
    totalTokens.value !== null
    && totalInputTokens.value !== null
    && totalOutputTokens.value !== null
    && totalTokens.value !== totalInputTokens.value + totalOutputTokens.value
  ) {
    return inconsistentOpenAiImageUsageBasis();
  }

  const detailTextInputTokens = readAssistantOpenAiImageRawDetailToken(
    input.rawUsageJson,
    "input_tokens_details",
    "text_tokens",
  );
  const detailImageInputTokens = readAssistantOpenAiImageRawDetailToken(
    input.rawUsageJson,
    "input_tokens_details",
    "image_tokens",
  );
  const hasInputDetails =
    detailTextInputTokens !== null || detailImageInputTokens !== null;
  if (!hasInputDetails) return missingOpenAiImageUsageBasis();

  const textInputTokens = detailTextInputTokens ?? 0n;
  const imageInputTokens = detailImageInputTokens ?? 0n;
  const detailedInputTokens = textInputTokens + imageInputTokens;
  if (
    totalInputTokens.value === null
    || detailedInputTokens !== totalInputTokens.value
  ) {
    return inconsistentOpenAiImageUsageBasis();
  }

  const cachedInputTokens = readAssistantOpenAiImageCachedInputTokens(input);
  if (cachedInputTokens.kind === "invalid") return inconsistentOpenAiImageUsageBasis();
  const cachedInputTokenCount = cachedInputTokens.value ?? 0n;
  if (cachedInputTokenCount > detailedInputTokens) {
    return inconsistentOpenAiImageUsageBasis();
  }
  const detailImageOutputTokens = readAssistantOpenAiImageRawDetailToken(
    input.rawUsageJson,
    "output_tokens_details",
    "image_tokens",
  );
  const detailTextOutputTokens = readAssistantOpenAiImageRawDetailToken(
    input.rawUsageJson,
    "output_tokens_details",
    "text_tokens",
  );
  const detailReasoningOutputTokens = readAssistantOpenAiImageRawDetailToken(
    input.rawUsageJson,
    "output_tokens_details",
    "reasoning_tokens",
  );
  const hasOutputDetails =
    detailImageOutputTokens !== null
    || detailTextOutputTokens !== null
    || detailReasoningOutputTokens !== null;
  const outputTokens = hasOutputDetails
    ? (detailImageOutputTokens ?? 0n)
      + (detailTextOutputTokens ?? 0n)
      + (detailReasoningOutputTokens ?? 0n)
    : totalOutputTokens.value ?? 0n;
  if (
    hasOutputDetails
    && (
      totalOutputTokens.value === null
      || outputTokens !== totalOutputTokens.value
    )
  ) {
    return inconsistentOpenAiImageUsageBasis();
  }

  const cachedTextInputTokens =
    textInputTokens > 0n
      ? minAssistantOpenAiImageTokenCount(textInputTokens, cachedInputTokenCount)
      : 0n;
  const cachedAfterText = cachedInputTokenCount - cachedTextInputTokens;
  const cachedImageInputTokens =
    imageInputTokens > 0n
      ? minAssistantOpenAiImageTokenCount(imageInputTokens, cachedAfterText)
      : 0n;
  const tokenBuckets = {
    billableImageInputTokens:
      subtractAssistantOpenAiImageTokenCountFloor(
        imageInputTokens,
        cachedImageInputTokens,
      ),
    billableTextInputTokens:
      subtractAssistantOpenAiImageTokenCountFloor(
        textInputTokens,
        cachedTextInputTokens,
      ),
    cachedImageInputTokens,
    cachedInputTokens: cachedInputTokenCount,
    cachedTextInputTokens,
    imageInputTokens,
    outputTokens,
    textInputTokens,
  } satisfies AssistantOpenAiImageUsageTokenBuckets;

  const hasInputPricingBasis =
    tokenBuckets.textInputTokens > 0n || tokenBuckets.imageInputTokens > 0n;
  return hasInputPricingBasis && tokenBuckets.outputTokens > 0n
    ? {
        priceable: true,
        tokenBuckets,
      }
    : missingOpenAiImageUsageBasis();
}

type AssistantOpenAiImageTokenReadResult =
  | {
    kind: "valid";
    value: bigint | null;
  }
  | {
    kind: "invalid";
  };

function missingOpenAiImageUsageBasis(): AssistantOpenAiImageUsageBasis {
  return {
    priceable: false,
    reason: "missing_provider_usage_tokens",
  };
}

function inconsistentOpenAiImageUsageBasis(): AssistantOpenAiImageUsageBasis {
  return {
    priceable: false,
    reason: "inconsistent_provider_usage_tokens",
  };
}

function readAssistantOpenAiImageAggregateToken(
  input: AssistantOpenAiImageUsageBasisInput,
  recordKey: "inputTokens" | "outputTokens" | "totalTokens",
  rawKey: "input_tokens" | "output_tokens" | "total_tokens",
): AssistantOpenAiImageTokenReadResult {
  const recordTokens = readAssistantOpenAiImageRecordToken(input[recordKey]);
  const rawTokens = readAssistantOpenAiImageRawTopLevelToken(
    input.rawUsageJson,
    rawKey,
  );
  if (
    recordTokens !== null
    && rawTokens !== null
    && recordTokens !== rawTokens
  ) {
    return { kind: "invalid" };
  }

  return {
    kind: "valid",
    value: recordTokens ?? rawTokens,
  };
}

function readAssistantOpenAiImageCachedInputTokens(
  input: AssistantOpenAiImageUsageBasisInput,
): AssistantOpenAiImageTokenReadResult {
  const recordTokens = readAssistantOpenAiImageRecordToken(input.cachedInputTokens);
  const rawTokens = readAssistantOpenAiImageRawDetailToken(
    input.rawUsageJson,
    "input_tokens_details",
    "cached_tokens",
  );
  if (
    recordTokens !== null
    && rawTokens !== null
    && recordTokens !== rawTokens
  ) {
    return { kind: "invalid" };
  }

  return {
    kind: "valid",
    value: recordTokens ?? rawTokens ?? 0n,
  };
}

function readAssistantOpenAiImageRawDetailToken(
  rawUsageJson: Record<string, unknown> | null,
  detailKey: "input_tokens_details" | "output_tokens_details",
  tokenKey: string,
): bigint | null {
  const detail = rawUsageJson?.[detailKey];
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) {
    return null;
  }

  const value = (detail as Record<string, unknown>)[tokenKey];
  return readAssistantOpenAiImageNumberToken(value);
}

function readAssistantOpenAiImageRecordToken(value: number | null): bigint | null {
  return readAssistantOpenAiImageNumberToken(value);
}

function readAssistantOpenAiImageRawTopLevelToken(
  rawUsageJson: Record<string, unknown> | null,
  tokenKey: "input_tokens" | "output_tokens" | "total_tokens",
): bigint | null {
  return readAssistantOpenAiImageNumberToken(rawUsageJson?.[tokenKey]);
}

function readAssistantOpenAiImageNumberToken(value: unknown): bigint | null {
  return typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 0
    ? BigInt(value)
    : null;
}

function minAssistantOpenAiImageTokenCount(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function subtractAssistantOpenAiImageTokenCountFloor(
  value: bigint,
  subtract: bigint,
): bigint {
  return value > subtract ? value - subtract : 0n;
}

export function createAssistantUsageId(input: {
  attemptCount: number;
  providerRequestOrdinal?: number;
  turnId: string;
}): string {
  const attemptCount = normalizeRequiredInteger(input.attemptCount, "attemptCount");
  const providerRequestOrdinal = normalizeOptionalInteger(
    input.providerRequestOrdinal,
    "providerRequestOrdinal",
  ) ?? 0;
  const turnId = normalizeRequiredString(input.turnId, "turnId");

  return providerRequestOrdinal === 0
    ? `${turnId}.attempt-${attemptCount}`
    : `${turnId}.request-${providerRequestOrdinal}.attempt-${attemptCount}`;
}

// Usage record for provider work that happens outside any member turn (today:
// idle-time thread compaction). Uses a synthetic turn id so the existing
// turn-keyed dedupe and storage path apply unchanged.
export function buildAssistantMaintenanceUsageRecord(input: {
  // The Murph assistant session/conversation id — never a provider thread id.
  assistantSessionId: string;
  // Provider-side correlation handle, stored as providerRequestId.
  codexThreadId: string | null;
  credentialSource: AssistantUsageCredentialSource;
  featureKey: string;
  memberId: string;
  model: string;
  occurredAt: string;
  providerName?: string | null;
  tokenPricingBasis?: AssistantUsageTokenPricingBasis;
  triggerKind: string;
  usage: {
    cachedInputTokens: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  usageExtractionSourcePath?: string | null;
  usageExtractionVersion?: string | null;
}): AssistantUsageRecord {
  const turnId = `turn_maintenance_${randomUUID().replaceAll("-", "")}`;

  return parseAssistantUsageRecord({
    attemptCount: 1,
    cachedInputTokens: input.usage.cachedInputTokens,
    credentialSource: input.credentialSource,
    featureKey: input.featureKey,
    inputTokens: input.usage.inputTokens,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    outputTokens: input.usage.outputTokens,
    provider: "codex-cli",
    ...(input.providerName === undefined ? {} : { providerName: input.providerName }),
    providerRequestId: input.codexThreadId,
    requestedModel: input.model,
    schema: ASSISTANT_USAGE_SCHEMA,
    sessionId: input.assistantSessionId,
    surface: "hosted-runtime",
    totalTokens: input.usage.totalTokens,
    ...(input.tokenPricingBasis === undefined
      ? {}
      : { tokenPricingBasis: input.tokenPricingBasis }),
    triggerKind: input.triggerKind,
    turnId,
    ...(input.usageExtractionSourcePath === undefined
      ? {}
      : { usageExtractionSourcePath: input.usageExtractionSourcePath }),
    ...(input.usageExtractionVersion === undefined
      ? {}
      : { usageExtractionVersion: input.usageExtractionVersion }),
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId,
    }),
  });
}

// Usage record for Worker-mediated Workers AI audio transcription. It runs
// outside any member turn (hosted attachment parse jobs), so it uses a
// synthetic turn id like the maintenance record above. Cost basis is audio
// duration in rawUsageJson rather than tokens.
export function buildHostedTranscriptionUsageRecord(input: {
  audioBytes: number;
  durationMs: number | null;
  memberId: string;
  model: string;
  occurredAt: string;
}): AssistantUsageRecord {
  const turnId = `turn_transcribe_${randomUUID().replaceAll("-", "")}`;

  return parseAssistantUsageRecord({
    attemptCount: 1,
    credentialSource: "platform",
    featureKey: "audio-transcription",
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    provider: "workers-ai",
    providerName: "Workers AI",
    rawUsageJson: {
      audioBytes: input.audioBytes,
      ...(input.durationMs === null ? {} : { durationMs: input.durationMs }),
    },
    requestedModel: input.model,
    schema: ASSISTANT_USAGE_SCHEMA,
    sessionId: turnId,
    surface: "hosted-runner",
    triggerKind: "attachment-parse",
    turnId,
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId,
    }),
    usageExtractionSourcePath: "workers-ai.transcribe",
    usageExtractionVersion: "workers-ai-transcribe-v1",
  });
}

// Usage record for Worker-mediated ElevenLabs TTS. Telegram voice memos
// generate audio during hosted delivery, outside the original model turn, so
// each completed provider request gets a synthetic turn id just like hosted
// transcription.
export function buildHostedElevenLabsTtsUsageRecord(input: {
  characterCount: number;
  memberId: string;
  model: string;
  occurredAt: string;
}): AssistantUsageRecord {
  const turnId = `turn_elevenlabs_tts_${randomUUID().replaceAll("-", "")}`;

  return parseAssistantUsageRecord({
    apiKeyEnv: "ELEVENLABS_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.elevenlabs.io",
    credentialSource: "platform",
    featureKey: "assistant-reply",
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    provider: "elevenlabs",
    providerName: "ElevenLabs",
    rawUsageJson: {
      characterCount: input.characterCount,
    },
    requestedModel: input.model,
    schema: ASSISTANT_USAGE_SCHEMA,
    sessionId: turnId,
    surface: "hosted-runner",
    triggerKind: "voice-memo-delivery",
    turnId,
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId,
    }),
    usageExtractionSourcePath: "elevenlabs.text_to_speech",
    usageExtractionVersion: "elevenlabs-tts-v1",
  });
}

export function buildHostedElevenLabsMusicUsageRecord(input: {
  durationMs: number;
  memberId: string;
  model: string;
  occurredAt: string;
  providerRequestId?: string | null;
}): AssistantUsageRecord {
  const turnId = `turn_elevenlabs_music_${randomUUID().replaceAll("-", "")}`;

  return parseAssistantUsageRecord({
    apiKeyEnv: "ELEVENLABS_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.elevenlabs.io",
    credentialSource: "platform",
    featureKey: "music-generation",
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    provider: "elevenlabs",
    providerName: "ElevenLabs",
    providerRequestId: input.providerRequestId ?? null,
    rawUsageJson: {
      durationMs: input.durationMs,
    },
    requestedModel: input.model,
    schema: ASSISTANT_USAGE_SCHEMA,
    sessionId: turnId,
    surface: "hosted-runner",
    triggerKind: "generate-song",
    turnId,
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId,
    }),
    usageExtractionSourcePath: "elevenlabs.music.compose",
    usageExtractionVersion: "elevenlabs-music-v1",
  });
}

// Exact usage for Codex-native memory work intercepted outside the foreground
// app-server turn. Provider response ids make re-observation idempotent while
// the provider timestamp keeps the immutable record stable across retries.
export function buildHostedCodexMemoryUsageRecord(input: {
  apiKeyEnv: string;
  baseUrl: string;
  cacheWriteTokens: number | null;
  cachedInputTokens: number | null;
  inputTokens: number;
  memberId: string;
  occurredAt: string;
  outputTokens: number;
  providerName: string;
  providerRequestId: string;
  providerRequestOutcome: AssistantProviderRequestOutcome;
  rawUsageJson: Record<string, unknown>;
  reasoningTokens: number | null;
  requestedModel: string;
  servedModel?: string | null;
  tokenPricingBasis?: AssistantUsageTokenPricingBasis;
  totalTokens: number;
}): AssistantUsageRecord {
  const digest = createHash("sha256")
    .update("murph.hosted-codex-memory-usage.v1")
    .update("\0")
    .update(input.memberId)
    .update("\0")
    .update(input.providerName)
    .update("\0")
    .update(input.providerRequestId)
    .digest("hex")
    .slice(0, 32);
  const turnId = `turn_codex_memory_${digest}`;

  return parseAssistantUsageRecord({
    apiKeyEnv: input.apiKeyEnv,
    attemptCount: 1,
    baseUrl: input.baseUrl,
    cacheWriteTokens: input.cacheWriteTokens,
    cachedInputTokens: input.cachedInputTokens,
    credentialSource: "platform",
    featureKey: "codex-native-memory",
    inputTokens: input.inputTokens,
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    outputTokens: input.outputTokens,
    provider: "codex-cli",
    providerName: input.providerName,
    providerRequestId: input.providerRequestId,
    providerRequestOutcome: input.providerRequestOutcome,
    rawUsageJson: input.rawUsageJson,
    reasoningTokens: input.reasoningTokens,
    requestedModel: input.requestedModel,
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: input.servedModel ?? null,
    sessionId: turnId,
    surface: "hosted-runner",
    tokenPricingBasis: input.tokenPricingBasis ?? "standard",
    totalTokens: input.totalTokens,
    triggerKind: "codex-native-memory",
    turnId,
    usageId: createAssistantUsageId({ attemptCount: 1, turnId }),
    usageExtractionSourcePath: "codex.responses.terminal",
    usageExtractionVersion: "codex-native-memory-v1",
  });
}

// Raw usage keys copied verbatim from the xAI Responses API usage object.
// cost_in_usd_ticks is the billing basis (1 USD = 10^10 ticks); the token
// counts are context only. Keys the provider omits stay absent.
const HOSTED_XAI_SEARCH_RAW_USAGE_KEYS = [
  "cached_input_tokens",
  "cost_in_usd_ticks",
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
] as const;

// Usage record for Worker-mediated xAI x_search calls. The billing basis is
// the provider-reported cost in the response usage object, so the interceptor
// buffers the completed response and passes that usage object through here.
// Each completed provider request gets a synthetic turn id just like hosted
// transcription and ElevenLabs.
export function buildHostedXaiSearchUsageRecord(input: {
  memberId: string;
  model: string;
  occurredAt: string;
  providerRequestId?: string | null;
  usage?: Record<string, unknown> | null;
}): AssistantUsageRecord {
  const turnId = `turn_xai_search_${randomUUID().replaceAll("-", "")}`;
  const rawUsageJson: Record<string, unknown> = {};
  for (const key of HOSTED_XAI_SEARCH_RAW_USAGE_KEYS) {
    const value = input.usage?.[key];
    if (isNonNegativeInteger(value)) {
      rawUsageJson[key] = value;
    }
  }
  const cachedDetailTokens = readHostedXaiSearchDetailToken(
    input.usage,
    "input_tokens_details",
    "cached_tokens",
  );
  if (cachedDetailTokens !== null) {
    rawUsageJson.input_tokens_details = { cached_tokens: cachedDetailTokens };
  }
  const reasoningDetailTokens = readHostedXaiSearchDetailToken(
    input.usage,
    "output_tokens_details",
    "reasoning_tokens",
  );
  if (reasoningDetailTokens !== null) {
    rawUsageJson.output_tokens_details = { reasoning_tokens: reasoningDetailTokens };
  }

  return parseAssistantUsageRecord({
    apiKeyEnv: "XAI_API_KEY",
    attemptCount: 1,
    baseUrl: "https://api.x.ai",
    credentialSource: "platform",
    featureKey: "x-search",
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    provider: "xai",
    providerName: "xAI",
    providerRequestId: input.providerRequestId ?? null,
    ...(Object.keys(rawUsageJson).length > 0 ? { rawUsageJson } : {}),
    requestedModel: input.model,
    schema: ASSISTANT_USAGE_SCHEMA,
    sessionId: turnId,
    surface: "hosted-runner",
    triggerKind: "x-search",
    turnId,
    usageId: createAssistantUsageId({
      attemptCount: 1,
      turnId,
    }),
    usageExtractionSourcePath: "xai.responses",
    usageExtractionVersion: "xai-x-search-v1",
  });
}

function readHostedXaiSearchDetailToken(
  usage: Record<string, unknown> | null | undefined,
  detailKey: "input_tokens_details" | "output_tokens_details",
  tokenKey: string,
): number | null {
  const detail = usage?.[detailKey];
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    return null;
  }
  const value = (detail as Record<string, unknown>)[tokenKey];
  return isNonNegativeInteger(value) ? value : null;
}

export function createAssistantUsageReportingUserId(input: {
  memberId: string;
  reportingSecret?: string | null;
}): string | null {
  const memberId = input.memberId.trim();
  const reportingSecret = input.reportingSecret?.trim() ?? "";

  if (!memberId || !reportingSecret) {
    return null;
  }

  const digest = createHmac("sha256", reportingSecret)
    .update(ASSISTANT_USAGE_REPORTING_USER_ID_HMAC_CONTEXT)
    .update("\0")
    .update(memberId)
    .digest("base64url")
    .slice(0, 32);

  return `musr_${digest}`;
}

export function parseAssistantUsageRecord(value: unknown): AssistantUsageRecord {
  const record = requireRecord(value, "assistant usage record");
  const attemptCount = normalizeRequiredInteger(record.attemptCount, "attemptCount");
  const inputTokens = normalizeOptionalInteger(record.inputTokens, "inputTokens");
  const occurredAt = normalizeRequiredString(record.occurredAt, "occurredAt");
  const outputTokens = normalizeOptionalInteger(record.outputTokens, "outputTokens");
  const providerRequestOrdinal =
    normalizeOptionalInteger(record.providerRequestOrdinal, "providerRequestOrdinal") ?? 0;
  const turnId = normalizeRequiredString(record.turnId, "turnId");
  const usageId = normalizeCanonicalAssistantUsageId({
    attemptCount,
    providerRequestOrdinal,
    turnId,
    usageId: normalizeRequiredString(record.usageId, "usageId"),
  });

  return {
    apiKeyEnv: normalizeOptionalString(record.apiKeyEnv, "apiKeyEnv"),
    attemptCount,
    baseUrl: normalizeOptionalString(record.baseUrl, "baseUrl"),
    cacheWriteTokens: normalizeOptionalInteger(record.cacheWriteTokens, "cacheWriteTokens"),
    cachedInputTokens: normalizeOptionalInteger(record.cachedInputTokens, "cachedInputTokens"),
    credentialSource: normalizeCredentialSource(record.credentialSource),
    featureKey: normalizeOptionalString(record.featureKey, "featureKey"),
    gatewayTags: normalizeOptionalStringArray(record.gatewayTags, "gatewayTags"),
    inputTokens,
    memberId: normalizeOptionalString(record.memberId, "memberId"),
    occurredAt,
    outputTokens,
    provider: normalizeRequiredString(record.provider, "provider"),
    providerName: normalizeOptionalString(record.providerName, "providerName"),
    providerRequestId: normalizeOptionalString(record.providerRequestId, "providerRequestId"),
    ...(record.providerRequestOutcome === undefined
      ? {}
      : {
          providerRequestOutcome: normalizeProviderRequestOutcome(
            record.providerRequestOutcome,
          ),
        }),
    ...(record.providerRequestOrdinal === undefined ? {} : { providerRequestOrdinal }),
    rawUsageJson: normalizeOptionalRawUsageJsonRecord(record.rawUsageJson, "rawUsageJson"),
    rawUsageJsonHash: normalizeOptionalString(record.rawUsageJsonHash, "rawUsageJsonHash"),
    reasoningTokens: normalizeOptionalInteger(record.reasoningTokens, "reasoningTokens"),
    reportingUserId: normalizeOptionalString(record.reportingUserId, "reportingUserId"),
    requestedModel: normalizeOptionalString(record.requestedModel, "requestedModel"),
    routeId: normalizeOptionalString(record.routeId, "routeId"),
    schema: normalizeUsageSchema(record.schema),
    servedModel: normalizeOptionalString(record.servedModel, "servedModel"),
    sessionId: normalizeRequiredString(record.sessionId, "sessionId"),
    stripeMeterSource: normalizeAssistantUsageStripeMeterSource(record.stripeMeterSource),
    surface: normalizeOptionalString(record.surface, "surface"),
    tokenPricingBasis: normalizeAssistantUsageTokenPricingBasis(record.tokenPricingBasis),
    totalTokens: normalizeOptionalInteger(record.totalTokens, "totalTokens"),
    triggerKind: normalizeOptionalString(record.triggerKind, "triggerKind"),
    turnId,
    turnProfileJson: normalizeOptionalTurnProfileJson(record.turnProfileJson, "turnProfileJson"),
    usageId,
    usageExtractionSourcePath: normalizeOptionalString(
      record.usageExtractionSourcePath,
      "usageExtractionSourcePath",
    ),
    usageExtractionVersion:
      normalizeOptionalString(record.usageExtractionVersion, "usageExtractionVersion") ?? "legacy",
  };
}

export function resolveAssistantUsageCredentialSource(input: {
  apiKeyEnv: string | null;
  credentialSourceHint?: Exclude<AssistantUsageCredentialSource, "unknown"> | null;
  effectiveEnv?: Readonly<Record<string, string | undefined>> | null;
  headers?: Readonly<Record<string, string>> | null;
  provider: string;
  userEnvKeys: Iterable<string>;
}): AssistantUsageCredentialSource {
  const userEnvKeys = new Set(
    [...input.userEnvKeys].map((key) => normalizeRequiredString(key, "userEnvKey")),
  );
  const effectiveEnv = input.effectiveEnv ?? null;

  if (
    input.credentialSourceHint === "member"
    || input.credentialSourceHint === "platform"
  ) {
    return input.credentialSourceHint;
  }

  if (hasCredentialLikeAssistantHeaders(input.headers)) {
    return "member";
  }

  if (!input.apiKeyEnv) {
    if (input.provider === "codex-cli" && hasHostedMemberAiCredential(userEnvKeys, effectiveEnv)) {
      return "member";
    }

    return "platform";
  }

  if (!userEnvKeys.has(input.apiKeyEnv)) {
    return "platform";
  }

  if (!effectiveEnv) {
    return "member";
  }

  return hasNonEmptyAssistantEnvValue(effectiveEnv, input.apiKeyEnv) ? "member" : "platform";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function normalizeUsageSchema(value: unknown): typeof ASSISTANT_USAGE_SCHEMA {
  const schema = normalizeRequiredString(value, "schema");

  if (schema !== ASSISTANT_USAGE_SCHEMA) {
    throw new TypeError(`assistant usage record schema must be ${ASSISTANT_USAGE_SCHEMA}.`);
  }

  return ASSISTANT_USAGE_SCHEMA;
}

function normalizeCredentialSource(value: unknown): AssistantUsageCredentialSource {
  const normalized = normalizeRequiredString(value, "credentialSource");

  if (normalized !== "member" && normalized !== "platform" && normalized !== "unknown") {
    throw new TypeError("credentialSource must be 'member', 'platform', or 'unknown'.");
  }

  return normalized;
}

export function normalizeAssistantProviderRequestOutcome(
  value: unknown,
): AssistantProviderRequestOutcome {
  return normalizeProviderRequestOutcome(value);
}

function normalizeProviderRequestOutcome(value: unknown): AssistantProviderRequestOutcome {
  const normalized = normalizeRequiredString(value, "providerRequestOutcome");

  if (
    normalized === "aborted" ||
    normalized === "failed" ||
    normalized === "partial" ||
    normalized === "succeeded"
  ) {
    return normalized;
  }

  throw new TypeError(
    "providerRequestOutcome must be succeeded, failed, aborted, or partial.",
  );
}

export function normalizeAssistantUsageStripeMeterSource(
  value: unknown,
): AssistantUsageStripeMeterSource {
  const normalized = normalizeOptionalString(value, "stripeMeterSource");

  if (!normalized) {
    return "murph";
  }

  if (normalized !== "murph") {
    throw new TypeError(
      "stripeMeterSource must be 'murph' when provided.",
    );
  }

  return normalized;
}

export function normalizeAssistantUsageTokenPricingBasis(
  value: unknown,
): AssistantUsageTokenPricingBasis {
  const normalized = normalizeOptionalString(value, "tokenPricingBasis");

  if (!normalized) {
    return "standard";
  }

  if (normalized === "openai-flex" || normalized === "standard") {
    return normalized;
  }

  throw new TypeError(
    "tokenPricingBasis must be 'standard' or 'openai-flex' when provided.",
  );
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeOptionalString(value, label);

  if (!normalized) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalized;
}

function normalizeOptionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string when provided.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalStringArray(value: unknown, label: string): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of strings when provided.`);
  }

  const seen = new Set<string>();
  const normalizedValues: string[] = [];

  for (const [index, entry] of value.entries()) {
    const normalized = normalizeOptionalString(entry, `${label}[${index}]`);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
}

function normalizeOptionalJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object when provided.`);
  }

  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError(`${label} must be JSON-serializable when provided.`);
  }

  const normalized: unknown = JSON.parse(serialized);

  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new TypeError(`${label} must be a JSON object when provided.`);
  }

  return normalized as Record<string, unknown>;
}

function normalizeOptionalRawUsageJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  const record = normalizeOptionalJsonRecord(value, label);

  if (record === null) {
    return null;
  }

  const normalized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (
      ASSISTANT_USAGE_RAW_TOKEN_KEYS.has(key) ||
      ASSISTANT_USAGE_RAW_AUDIO_KEYS.has(key) ||
      ASSISTANT_USAGE_RAW_TTS_KEYS.has(key) ||
      ASSISTANT_USAGE_RAW_COST_KEYS.has(key)
    ) {
      if (!isNonNegativeInteger(entry)) {
        throw new TypeError(`${label}.${key} must be a non-negative integer.`);
      }
      normalized[key] = entry;
      continue;
    }

    const allowedDetailKeys = ASSISTANT_USAGE_RAW_DETAIL_TOKEN_KEYS.get(key);
    if (allowedDetailKeys) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError(`${label}.${key} must be a token detail object.`);
      }

      const normalizedDetails: Record<string, number> = {};
      for (const [detailKey, detailEntry] of Object.entries(entry)) {
        if (!allowedDetailKeys.has(detailKey)) {
          throw new TypeError(`${label}.${key}.${detailKey} is not allowed.`);
        }
        if (!isNonNegativeInteger(detailEntry)) {
          throw new TypeError(`${label}.${key}.${detailKey} must be a non-negative integer.`);
        }
        normalizedDetails[detailKey] = detailEntry;
      }

      normalized[key] = normalizedDetails;
      continue;
    }

    throw new TypeError(`${label}.${key} is not allowed.`);
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

// Strict allowlist for the per-turn profile: numeric series plus sanitized
// tool labels only, so nothing member-authored can ride along into the DB.
// The profile is droppable telemetry: an invalid profile becomes null instead
// of rejecting the whole usage record, so token accounting never fails open
// because of a telemetry-only validation mismatch.
function normalizeOptionalTurnProfileJson(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  try {
    return requireValidTurnProfileJson(value, label);
  } catch {
    return null;
  }
}

function requireValidTurnProfileJson(
  value: unknown,
  label: string,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireRecord(value, label);
  if (
    record.schema !== ASSISTANT_TURN_PROFILE_SCHEMA_V1
    && record.schema !== ASSISTANT_TURN_PROFILE_SCHEMA
  ) {
    throw new TypeError(
      `${label}.schema must be ${ASSISTANT_TURN_PROFILE_SCHEMA_V1} or ${ASSISTANT_TURN_PROFILE_SCHEMA}.`,
    );
  }
  if (!isNonNegativeInteger(record.requestCount)) {
    throw new TypeError(`${label}.requestCount must be a non-negative integer.`);
  }
  if (record.modelContextWindow !== null && !isNonNegativeInteger(record.modelContextWindow)) {
    throw new TypeError(`${label}.modelContextWindow must be null or a non-negative integer.`);
  }
  if (typeof record.requestsTruncated !== "boolean" || typeof record.toolsTruncated !== "boolean") {
    throw new TypeError(`${label} truncation flags must be booleans.`);
  }
  if (!Array.isArray(record.requests) || record.requests.length > ASSISTANT_TURN_PROFILE_MAX_REQUESTS) {
    throw new TypeError(
      `${label}.requests must be an array of at most ${ASSISTANT_TURN_PROFILE_MAX_REQUESTS} entries.`,
    );
  }
  if (!Array.isArray(record.tools) || record.tools.length > ASSISTANT_TURN_PROFILE_MAX_TOOLS) {
    throw new TypeError(
      `${label}.tools must be an array of at most ${ASSISTANT_TURN_PROFILE_MAX_TOOLS} entries.`,
    );
  }

  const isV2 = record.schema === ASSISTANT_TURN_PROFILE_SCHEMA;
  if (
    isV2
    && (
      record.requestCount < record.requests.length
      || (
        record.requestsTruncated
          ? (
            record.requests.length !== ASSISTANT_TURN_PROFILE_MAX_REQUESTS
            || record.requestCount <= record.requests.length
          )
          : record.requestCount !== record.requests.length
      )
    )
  ) {
    throw new TypeError(`${label} request count and truncation fields are inconsistent.`);
  }

  const seenV2Tools = new Set<string>();
  const tools = record.tools.map((entry, index) => {
    const toolLabel = `${label}.tools[${index}]`;
    const tool = requireRecord(entry, toolLabel);
    if (record.schema === ASSISTANT_TURN_PROFILE_SCHEMA_V1) {
      if (
        typeof tool.label !== "string"
        || tool.label.length === 0
        || tool.label.length > ASSISTANT_TURN_PROFILE_MAX_TOOL_LABEL_LENGTH
        || !ASSISTANT_TURN_PROFILE_TOOL_LABEL_PATTERN.test(tool.label)
      ) {
        throw new TypeError(`${toolLabel}.label must be a short sanitized tool label.`);
      }
      return normalizeTurnProfileV1Tool(tool, toolLabel);
    }

    const normalized = normalizeTurnProfileV2Tool(tool, toolLabel);
    const identity = JSON.stringify([normalized.kind, normalized.label]);
    if (seenV2Tools.has(identity)) {
      throw new TypeError(`${toolLabel} duplicates an existing kind and label.`);
    }
    seenV2Tools.add(identity);
    return normalized;
  });

  return {
    modelContextWindow: record.modelContextWindow,
    requestCount: record.requestCount,
    requests: record.requests.map((entry, index) =>
      normalizeTurnProfileIntegerRecord(
        entry,
        `${label}.requests[${index}]`,
        ["cachedInput", "input", "output"],
      ),
    ),
    requestsTruncated: record.requestsTruncated,
    schema: record.schema,
    tools,
    toolsTruncated: record.toolsTruncated,
  };
}

function normalizeTurnProfileV1Tool(
  tool: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  validateTurnProfileFailedCalls(tool, label, false);
  return {
    ...normalizeTurnProfileIntegerRecord(tool, label, [
      "calls",
      "durationMs",
      "outputChars",
    ]),
    ...(tool.failedCalls === undefined
      ? {}
      : { failedCalls: tool.failedCalls }),
    label: tool.label,
  };
}

function normalizeTurnProfileV2Tool(
  tool: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  if (
    typeof tool.kind !== "string"
    || !ASSISTANT_TURN_PROFILE_TOOL_KINDS.has(tool.kind)
  ) {
    throw new TypeError(`${label}.kind must be a supported tool kind.`);
  }
  if (
    tool.kind === "command"
    && !isAssistantTurnProfileCommandFamily(tool.label)
  ) {
    throw new TypeError(`${label}.label must be a supported command family.`);
  }
  if (
    (tool.kind === "dynamic_tool" || tool.kind === "mcp_tool")
    && (
      typeof tool.label !== "string"
      || tool.label.length === 0
      || tool.label.length > ASSISTANT_TURN_PROFILE_MAX_TOOL_LABEL_LENGTH
      || !isAssistantTurnProfileToolIdentityLabel(tool.kind, tool.label)
    )
  ) {
    throw new TypeError(`${label}.label must be a canonical tool identity label.`);
  }
  validateTurnProfileFailedCalls(tool, label, true);
  const normalized = normalizeTurnProfileIntegerRecord(tool, label, [
    "calls",
    "durationKnownCalls",
    "durationMs",
    "failedCalls",
    "outputBytesMax",
    "outputBytesTotal",
  ]);
  if (normalized.durationKnownCalls > normalized.calls) {
    throw new TypeError(`${label}.durationKnownCalls must not exceed calls.`);
  }
  if (normalized.calls < 1) {
    throw new TypeError(`${label}.calls must be at least one.`);
  }
  if (normalized.durationKnownCalls === 0 && normalized.durationMs !== 0) {
    throw new TypeError(`${label}.durationMs must be zero when no durations are known.`);
  }
  if (normalized.outputBytesMax > normalized.outputBytesTotal) {
    throw new TypeError(`${label}.outputBytesMax must not exceed outputBytesTotal.`);
  }
  if (
    normalized.outputBytesMax > 0
    && normalized.calls > Math.floor(
      Number.MAX_SAFE_INTEGER / normalized.outputBytesMax,
    )
  ) {
    throw new TypeError(`${label} output byte capacity must be a safe integer.`);
  }
  const outputByteCapacity = normalized.calls * normalized.outputBytesMax;
  if (normalized.outputBytesTotal > outputByteCapacity) {
    throw new TypeError(`${label}.outputBytesTotal exceeds calls times outputBytesMax.`);
  }

  return {
    ...normalized,
    kind: tool.kind,
    label: tool.label,
  };
}

function validateTurnProfileFailedCalls(
  tool: Record<string, unknown>,
  label: string,
  required: boolean,
): void {
  if (
    (required && tool.failedCalls === undefined)
    || (tool.failedCalls !== undefined && !isNonNegativeInteger(tool.failedCalls))
  ) {
    throw new TypeError(`${label}.failedCalls must be a non-negative integer.`);
  }
  if (
    typeof tool.failedCalls === "number"
    && typeof tool.calls === "number"
    && tool.failedCalls > tool.calls
  ) {
    throw new TypeError(`${label}.failedCalls must not exceed calls.`);
  }
}

function normalizeTurnProfileIntegerRecord(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, number> {
  const record = requireRecord(value, label);
  const normalized: Record<string, number> = {};

  for (const key of keys) {
    const entry = record[key];
    if (!isNonNegativeInteger(entry)) {
      throw new TypeError(`${label}.${key} must be a non-negative integer.`);
    }
    normalized[key] = entry;
  }

  return normalized;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeRequiredInteger(value: unknown, label: string): number {
  const normalized = normalizeOptionalInteger(value, label);

  if (normalized === null) {
    throw new TypeError(`${label} must be a whole number.`);
  }

  return normalized;
}

function normalizeCanonicalAssistantUsageId(input: {
  attemptCount: number;
  providerRequestOrdinal: number;
  turnId: string;
  usageId: string;
}): string {
  const canonicalUsageId = createAssistantUsageId({
    attemptCount: input.attemptCount,
    providerRequestOrdinal: input.providerRequestOrdinal,
    turnId: input.turnId,
  });

  if (input.usageId !== canonicalUsageId) {
    throw new TypeError(
      `usageId must match the canonical turnId/providerRequestOrdinal/attemptCount-derived value ${canonicalUsageId}.`,
    );
  }

  return canonicalUsageId;
}

function normalizeOptionalInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer when provided.`);
  }

  return value;
}

const SENSITIVE_HEADER_NAME_PATTERN =
  /(?:^|[-_])(?:authorization|cookie|token|secret|api[-_]?key|session[-_]?key)(?:$|[-_])/iu;
const SENSITIVE_HEADER_VALUE_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/iu;

function hasCredentialLikeAssistantHeaders(
  headers: Readonly<Record<string, string>> | null | undefined,
): boolean {
  if (!headers || Object.keys(headers).length === 0) {
    return false;
  }

  return Object.entries(headers).some(([name, value]) =>
    isCredentialLikeAssistantHeader(name, value),
  );
}

function isCredentialLikeAssistantHeader(name: string, value: string): boolean {
  return (
    SENSITIVE_HEADER_NAME_PATTERN.test(name)
    || SENSITIVE_HEADER_VALUE_PATTERN.test(value)
  );
}

function hasHostedMemberAiCredential(
  userEnvKeys: ReadonlySet<string>,
  effectiveEnv: Readonly<Record<string, string | undefined>> | null,
): boolean {
  return [...userEnvKeys].some(
    (key) =>
      HOSTED_MEMBER_AI_CREDENTIAL_ENV_KEYS.has(key)
      && (effectiveEnv === null || hasNonEmptyAssistantEnvValue(effectiveEnv, key)),
  );
}

function hasNonEmptyAssistantEnvValue(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}
