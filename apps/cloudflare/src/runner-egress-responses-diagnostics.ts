import {
  HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS,
} from "@murphai/hosted-execution/assistant-model";

const OPENAI_CACHE_DIAGNOSTIC_MODEL_KINDS = new Set([
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-5.2",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "o3",
  "o3-mini",
  "o4-mini",
]);
const VENICE_CACHE_DIAGNOSTIC_MODEL_KINDS: ReadonlySet<string> = new Set(
  Object.values(HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS),
);
const HOSTED_OPENAI_CACHE_DIAGNOSTIC_VERSION = 3;
const OPENAI_CACHE_DIAGNOSTIC_MAX_JSON_BYTES = 6 * 1024 * 1024;
const OPENAI_CACHE_DIAGNOSTIC_MAX_FULL_FINGERPRINT_BYTES = 256 * 1024;
const OPENAI_CACHE_DIAGNOSTIC_MIN_DIGEST_BYTES = 4 * 1024;
const OPENAI_CACHE_DIAGNOSTIC_PREFIX_WINDOWS = [8 * 1024, 32 * 1024, 128 * 1024] as const;
const OPENAI_CACHE_NAMESPACE_MIN_DIGEST_CHARS = 12;
const OPENAI_CACHE_DIAGNOSTIC_FINGERPRINT_CONTEXT =
  "murph.hosted-openai-cache-diagnostic.v1";
const OPENAI_CACHE_DIAGNOSTIC_TEXT_DECODER = new TextDecoder();
const OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER = new TextEncoder();
const OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_DEPTH = 128;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_NODES = 50_000;
const OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS = 16;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_TAIL_ITEM_COUNT = 8;
const OPENAI_CACHE_DIAGNOSTIC_FUNCTION_NAME_MAX_CHARS = 96;
const OPENAI_CACHE_DIAGNOSTIC_DUPLICATE_FUNCTION_NAME_KIND = "duplicate";
const OPENAI_CACHE_DIAGNOSTIC_FUNCTION_OUTPUT_ACTION_KINDS = [
  "command.execution",
  "dynamic.tool.call",
  "mcp.tool.call",
  "other",
] as const;
type HostedOpenAiFunctionOutputActionKind =
  (typeof OPENAI_CACHE_DIAGNOSTIC_FUNCTION_OUTPUT_ACTION_KINDS)[number];
const OPENAI_CACHE_DIAGNOSTIC_FUNCTION_OUTPUT_ACTION_METRIC_KINDS: Readonly<
  Record<HostedOpenAiFunctionOutputActionKind, string>
> = {
  "command.execution": "function_output.action.command.execution",
  "dynamic.tool.call": "function_output.action.dynamic.tool.call",
  "mcp.tool.call": "function_output.action.mcp.tool.call",
  other: "function_output.action.other",
};
const OPENAI_CACHE_DIAGNOSTIC_FUNCTION_OUTPUT_REPEATED_METRIC_KIND =
  "function_output.repeated";
const OPENAI_CACHE_DIAGNOSTIC_FUNCTION_OUTPUT_EQUIVALENT_METRIC_KIND =
  "function_output.equivalent";
const OPENAI_CACHE_DIAGNOSTIC_COMMAND_FUNCTION_NAME_KINDS = new Set([
  "exec_command",
  "local_shell",
]);
const OPENAI_CACHE_DIAGNOSTIC_SAFE_FUNCTION_NAME_PATTERN =
  /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/u;
const OPENAI_CACHE_DIAGNOSTIC_UNSAFE_FUNCTION_NAME_PATTERN =
  /authorization|bearer|cookie|password|secret|token|api_?key|(?:sk|pk|rk)_(?:live|test)_|whsec_/iu;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_ITEM_TYPE_KINDS = [
  "computer_call",
  "computer_call_output",
  "file_search_call",
  "function_call",
  "function_call_output",
  "image_generation_call",
  "local_shell_call",
  "local_shell_call_output",
  "message",
  "reasoning",
  "web_search_call",
] as const;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_ITEM_ROLE_KINDS = [
  "assistant",
  "developer",
  "system",
  "tool",
  "user",
] as const;
const OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_KEYS = new Set(["content", "output"]);
const OPENAI_CACHE_DIAGNOSTIC_INPUT_NESTED_METRIC_KINDS = [
  "content",
  "output",
  "string",
] as const;
const OPENAI_CACHE_DIAGNOSTIC_CODEX_REQUEST_KINDS = new Set([
  "compaction",
  "memory",
  "prewarm",
  "turn",
]);
const OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_TRIGGER_KINDS = new Set([
  "auto",
  "manual",
]);
const OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_REASON_KINDS = new Set([
  "context_limit",
  "model_downshift",
  "user_requested",
]);
const OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_IMPLEMENTATION_KINDS = new Set([
  "responses",
  "responses_compact",
  "responses_compaction_v2",
]);
const OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_PHASE_KINDS = new Set([
  "mid_turn",
  "pre_turn",
  "standalone_turn",
]);

export type HostedOpenAiCacheDiagnosticEndpointKind = "responses" | "responses_compact";
export type HostedResponsesDiagnosticProviderKind = "openai" | "venice";
type HostedRunnerDiagnosticScalar = boolean | null | number | string;
export type HostedRunnerDiagnosticJson = Record<
  string,
  HostedRunnerDiagnosticScalar | HostedRunnerDiagnosticScalar[]
>;

export function readHostedResponsesRequestModelKind(body: ArrayBuffer): string | null {
  try {
    const parsed = JSON.parse(OPENAI_CACHE_DIAGNOSTIC_TEXT_DECODER.decode(body));
    return isHostedOpenAiDiagnosticRecord(parsed)
      ? readStringRecordProperty(parsed, "model")
      : null;
  } catch {
    return null;
  }
}

export async function buildHostedOpenAiCacheDiagnostic(input: {
  canonicalModelKind?: string | null;
  endpointKind: HostedOpenAiCacheDiagnosticEndpointKind;
  fingerprintSecret?: string | null;
  method: string;
  providerKind?: HostedResponsesDiagnosticProviderKind;
  requestBytes: Uint8Array;
  turnMetadataHeader?: string | null;
}): Promise<HostedRunnerDiagnosticJson> {
  const fingerprintKey = await createOpenAiCacheDiagnosticFingerprintKey(
    input.fingerprintSecret ?? null,
  );
  const diagnostic: HostedRunnerDiagnosticJson = {
    diagnosticVersion: HOSTED_OPENAI_CACHE_DIAGNOSTIC_VERSION,
    endpointKind: input.endpointKind,
    fingerprintKind: fingerprintKey ? "hmac-sha256" : "none",
    jsonType: "unknown",
    jsonValid: false,
    methodKind: readOpenAiDiagnosticMethodKind(input.method),
    providerKind: input.providerKind ?? "openai",
    requestBytes: input.requestBytes.byteLength,
  };
  await appendCodexTurnMetadataDiagnostics({
    diagnostic,
    fingerprintKey,
    turnMetadataHeader: input.turnMetadataHeader ?? null,
  });

  await appendFingerprintDiagnostics({
    bytes: input.requestBytes,
    fieldPrefix: "request",
    fingerprintKey,
    output: diagnostic,
  });

  if (input.requestBytes.byteLength > OPENAI_CACHE_DIAGNOSTIC_MAX_JSON_BYTES) {
    diagnostic.jsonSkippedReasonKind = "too_large";
    return diagnostic;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(OPENAI_CACHE_DIAGNOSTIC_TEXT_DECODER.decode(input.requestBytes));
  } catch {
    diagnostic.jsonType = "invalid";
    return diagnostic;
  }

  diagnostic.jsonValid = true;
  diagnostic.jsonType = readOpenAiDiagnosticJsonType(parsed);
  if (!isHostedOpenAiDiagnosticRecord(parsed)) {
    return diagnostic;
  }

  diagnostic.requestFieldCount = Object.keys(parsed).length;
  const requestModel = readStringRecordProperty(parsed, "model");
  diagnostic.modelKind = readOpenAiDiagnosticModelKind(
    input.canonicalModelKind ?? requestModel,
  );
  if ((input.providerKind ?? "openai") === "venice") {
    diagnostic.upstreamModelKind = readVeniceDiagnosticModelKind(requestModel);
  }
  diagnostic.cacheRetentionKind = readOpenAiCacheRetentionKind(parsed.prompt_cache_retention);

  const cacheNamespace = readStringRecordProperty(parsed, "prompt_cache_key");
  diagnostic.cacheNamespacePresent = cacheNamespace !== null;
  if (cacheNamespace) {
    await appendSensitiveIdentifierFingerprint({
      fieldPrefix: "cacheNamespace",
      fingerprintKey,
      output: diagnostic,
      value: cacheNamespace,
    });
  }

  const previousResponseId = readStringRecordProperty(parsed, "previous_response_id");
  diagnostic.previousResponsePresent = previousResponseId !== null;
  if (previousResponseId) {
    await appendSensitiveIdentifierFingerprint({
      fieldPrefix: "previousResponse",
      fingerprintKey,
      output: diagnostic,
      value: previousResponseId,
    });
  }

  const instructions = readStringRecordProperty(parsed, "instructions");
  diagnostic.instructionsPresent = instructions !== null;
  if (instructions) {
    diagnostic.instructionsBytes = byteLengthOfDiagnosticText(instructions);
  }

  const inputValue = parsed.input;
  diagnostic.inputPresent = Object.hasOwn(parsed, "input");
  diagnostic.inputType = readOpenAiDiagnosticJsonType(inputValue);
  diagnostic.inputCount = readOpenAiInputCount(inputValue);
  const inputBytes = encodeOpenAiDiagnosticJsonValue(inputValue);
  if (inputBytes) {
    diagnostic.inputBytes = inputBytes.byteLength;
    await appendFingerprintDiagnostics({
      bytes: inputBytes,
      fieldPrefix: "input",
      fingerprintKey,
      output: diagnostic,
    });
  }
  await appendOpenAiInputShapeDiagnostics({
    diagnostic,
    fingerprintKey,
    inputValue,
  });

  diagnostic.toolCount = Array.isArray(parsed.tools) ? parsed.tools.length : 0;
  diagnostic.includeCount = Array.isArray(parsed.include) ? parsed.include.length : 0;
  diagnostic.storePresent = Object.hasOwn(parsed, "store");
  diagnostic.streamPresent = Object.hasOwn(parsed, "stream");

  return diagnostic;
}

async function appendFingerprintDiagnostics(input: {
  bytes: Uint8Array;
  fieldPrefix: "input" | "request";
  fingerprintKey: CryptoKey | null;
  output: HostedRunnerDiagnosticJson;
}): Promise<void> {
  const fingerprintKey = input.fingerprintKey;
  const fingerprintPresentKey = `${input.fieldPrefix}FingerprintPresent`;
  const prefixFingerprintEligible =
    Boolean(fingerprintKey)
    && input.bytes.byteLength >= OPENAI_CACHE_DIAGNOSTIC_MIN_DIGEST_BYTES;
  const fullFingerprintEligible =
    prefixFingerprintEligible
    && input.bytes.byteLength <= OPENAI_CACHE_DIAGNOSTIC_MAX_FULL_FINGERPRINT_BYTES;
  input.output[fingerprintPresentKey] = fullFingerprintEligible;
  if (
    !fingerprintKey
    || input.bytes.byteLength < OPENAI_CACHE_DIAGNOSTIC_MIN_DIGEST_BYTES
  ) {
    return;
  }
  const activeFingerprintKey = fingerprintKey;

  if (fullFingerprintEligible) {
    input.output[`${input.fieldPrefix}Fingerprint`] = await hmacDiagnosticFingerprint({
      bytes: input.bytes,
      fieldPrefix: input.fieldPrefix,
      fingerprintKey: activeFingerprintKey,
    });
  } else {
    input.output[`${input.fieldPrefix}FullFingerprintSkipped`] = true;
  }
  const prefixLengths = readOpenAiCacheDiagnosticPrefixLengths(input.bytes.byteLength);
  input.output[`${input.fieldPrefix}PrefixLengths`] = prefixLengths;
  input.output[`${input.fieldPrefix}PrefixFingerprints`] = await Promise.all(
    prefixLengths.map((length) =>
      hmacDiagnosticFingerprint({
        bytes: input.bytes.subarray(0, length),
        fieldPrefix: `${input.fieldPrefix}:prefix:${length}`,
        fingerprintKey: activeFingerprintKey,
      })),
  );
}

async function appendSensitiveIdentifierFingerprint(input: {
  fieldPrefix:
    | "cacheNamespace"
    | "codexSession"
    | "codexThread"
    | "codexTurn"
    | "codexWindow"
    | "previousResponse";
  fingerprintKey: CryptoKey | null;
  output: HostedRunnerDiagnosticJson;
  value: string;
}): Promise<void> {
  const fingerprintKey = input.fingerprintKey;
  input.output[`${input.fieldPrefix}FingerprintPresent`] =
    Boolean(fingerprintKey)
    && input.value.length >= OPENAI_CACHE_NAMESPACE_MIN_DIGEST_CHARS;
  if (
    !fingerprintKey
    || input.value.length < OPENAI_CACHE_NAMESPACE_MIN_DIGEST_CHARS
  ) {
    return;
  }
  const activeFingerprintKey = fingerprintKey;

  input.output[`${input.fieldPrefix}Fingerprint`] = await hmacDiagnosticFingerprint({
    bytes: OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(input.value),
    fieldPrefix: input.fieldPrefix,
    fingerprintKey: activeFingerprintKey,
  });
}

function readOpenAiCacheDiagnosticPrefixLengths(byteLength: number): number[] {
  return Array.from(new Set(
    OPENAI_CACHE_DIAGNOSTIC_PREFIX_WINDOWS
      .map((limit) => Math.min(limit, byteLength))
      .filter((length) => length > 0),
  ));
}

function readOpenAiDiagnosticMethodKind(method: string): string {
  return method === "POST" ? "POST" : "other";
}

function readOpenAiDiagnosticModelKind(value: string | null): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "missing";
  }
  return OPENAI_CACHE_DIAGNOSTIC_MODEL_KINDS.has(normalized) ? normalized : "other";
}

export function readVeniceDiagnosticModelKind(value: string | null): string {
  const normalized = value?.split(":", 1)[0]?.trim() ?? "";
  if (!normalized) {
    return "missing";
  }
  return VENICE_CACHE_DIAGNOSTIC_MODEL_KINDS.has(normalized)
    ? normalized
    : "other";
}

function readOpenAiCacheRetentionKind(value: unknown): string {
  if (value === undefined || value === null) {
    return "default";
  }
  if (value === "24h" || value === "in_memory") {
    return value;
  }
  return "other";
}

function readOpenAiDiagnosticJsonType(value: unknown): string {
  if (value === undefined) {
    return "missing";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return typeof value;
    case "object":
      return "object";
    default:
      return "other";
  }
}

function readOpenAiInputCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value === undefined || value === null) {
    return 0;
  }
  return typeof value === "string" && value.length === 0 ? 0 : 1;
}

function readStringRecordProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

async function appendCodexTurnMetadataDiagnostics(input: {
  diagnostic: HostedRunnerDiagnosticJson;
  fingerprintKey: CryptoKey | null;
  turnMetadataHeader: string | null;
}): Promise<void> {
  const header = input.turnMetadataHeader?.trim();
  if (!header) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    input.diagnostic.codexTurnMetadataStatus = "invalid";
    return;
  }
  if (!isHostedOpenAiDiagnosticRecord(parsed)) {
    input.diagnostic.codexTurnMetadataStatus = "invalid";
    return;
  }

  input.diagnostic.codexTurnMetadataStatus = "valid";
  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_REQUEST_KINDS,
    field: "codexRequestKind",
    output: input.diagnostic,
    value: parsed.request_kind,
  });

  const sessionId = readStringRecordProperty(parsed, "session_id");
  if (sessionId) {
    await appendSensitiveIdentifierFingerprint({
      fieldPrefix: "codexSession",
      fingerprintKey: input.fingerprintKey,
      output: input.diagnostic,
      value: sessionId,
    });
  }
  const threadId = readStringRecordProperty(parsed, "thread_id");
  if (threadId) {
    await appendSensitiveIdentifierFingerprint({
      fieldPrefix: "codexThread",
      fingerprintKey: input.fingerprintKey,
      output: input.diagnostic,
      value: threadId,
    });
  }
  const turnId = readStringRecordProperty(parsed, "turn_id");
  if (turnId) {
    await appendSensitiveIdentifierFingerprint({
      fieldPrefix: "codexTurn",
      fingerprintKey: input.fingerprintKey,
      output: input.diagnostic,
      value: turnId,
    });
  }
  const windowId = readStringRecordProperty(parsed, "window_id");
  if (windowId) {
    await appendSensitiveIdentifierFingerprint({
      fieldPrefix: "codexWindow",
      fingerprintKey: input.fingerprintKey,
      output: input.diagnostic,
      value: windowId,
    });
  }

  const compaction = parsed.compaction;
  if (!isHostedOpenAiDiagnosticRecord(compaction)) {
    return;
  }

  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_TRIGGER_KINDS,
    field: "codexCompactionTriggerKind",
    output: input.diagnostic,
    value: compaction.trigger,
  });
  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_REASON_KINDS,
    field: "codexCompactionReasonKind",
    output: input.diagnostic,
    value: compaction.reason,
  });
  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_IMPLEMENTATION_KINDS,
    field: "codexCompactionImplementationKind",
    output: input.diagnostic,
    value: compaction.implementation,
  });
  appendAllowedStringDiagnosticKind({
    allowed: OPENAI_CACHE_DIAGNOSTIC_CODEX_COMPACTION_PHASE_KINDS,
    field: "codexCompactionPhaseKind",
    output: input.diagnostic,
    value: compaction.phase,
  });
}

function appendAllowedStringDiagnosticKind(input: {
  allowed: ReadonlySet<string>;
  field: string;
  output: HostedRunnerDiagnosticJson;
  value: unknown;
}): void {
  const normalized = typeof input.value === "string" ? input.value.trim() : "";
  if (!normalized) {
    return;
  }
  input.output[input.field] = input.allowed.has(normalized) ? normalized : "other";
}

function encodeOpenAiDiagnosticJsonValue(value: unknown): Uint8Array | null {
  return serializeOpenAiDiagnosticJsonValue(value)?.bytes ?? null;
}

function serializeOpenAiDiagnosticJsonValue(value: unknown): {
  bytes: Uint8Array;
  serialized: string;
} | null {
  if (value === undefined) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string"
      ? {
          bytes: OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(serialized),
          serialized,
        }
      : null;
  } catch {
    return null;
  }
}

async function appendOpenAiInputShapeDiagnostics(input: {
  diagnostic: HostedRunnerDiagnosticJson;
  fingerprintKey: CryptoKey | null;
  inputValue: unknown;
}): Promise<void> {
  const diagnostic = input.diagnostic;
  const inputValue = input.inputValue;
  if (!Array.isArray(inputValue)) {
    return;
  }

  const functionCallNamesById = readOpenAiInputFunctionCallNamesById(inputValue);
  const typeCounts = new Map<string, number>();
  const typeBytes = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  const functionCallNameCounts = new Map<string, number>();
  const functionCallBytes = new Map<string, number>();
  const functionOutputNameCounts = new Map<string, number>();
  const functionOutputBytes = new Map<string, number>();
  const functionOutputActionCounts = new Map<string, number>();
  const functionOutputActionBytes = new Map<string, number>();
  const seenFunctionOutputCallIds = new Set<string>();
  const functionOutputEquivalenceBySerializedValue = new Map<
    string,
    { differentCallIdSeen: boolean; firstCallId: string }
  >();
  let repeatedFunctionOutputCount = 0;
  let repeatedFunctionOutputBytes = 0;
  let equivalentFunctionOutputCount = 0;
  let equivalentFunctionOutputBytes = 0;
  let largestItemBytes = 0;
  let largestItemIndex = -1;
  let largestItemKinds = ["type:missing", "role:missing"];
  let largestFunctionOutputBytes = 0;
  let largestFunctionOutputIndex = -1;
  let largestFunctionOutputNameKind = "missing";

  for (const [index, item] of inputValue.entries()) {
    const typeKind = readOpenAiInputItemTypeKind(item);
    const roleKind = readOpenAiInputItemRoleKind(item);
    const itemBytes = encodeOpenAiDiagnosticJsonValue(item)?.byteLength ?? 0;
    incrementDiagnosticCount(typeCounts, typeKind);
    addDiagnosticBytes(typeBytes, typeKind, itemBytes);
    incrementDiagnosticCount(roleCounts, roleKind);

    if (itemBytes > largestItemBytes) {
      largestItemBytes = itemBytes;
      largestItemIndex = index;
      largestItemKinds = [`type:${typeKind}`, `role:${roleKind}`];
    }

    if (typeKind === "function_call") {
      const functionNameKind = readOpenAiInputFunctionCallNameKind(item, functionCallNamesById);
      incrementDiagnosticCount(functionCallNameCounts, functionNameKind);
      addDiagnosticBytes(functionCallBytes, functionNameKind, itemBytes);
    } else if (typeKind === "function_call_output") {
      const functionNameKind = readOpenAiInputFunctionOutputNameKind(
        item,
        functionCallNamesById,
      );
      const actionKind = readOpenAiInputFunctionOutputActionKind(functionNameKind);
      const output = readOpenAiInputFunctionOutputDiagnosticValue(item);
      const outputBytes = output?.bytes.byteLength ?? 0;
      incrementDiagnosticCount(functionOutputNameCounts, functionNameKind);
      addDiagnosticBytes(functionOutputBytes, functionNameKind, outputBytes);
      incrementDiagnosticCount(functionOutputActionCounts, actionKind);
      addDiagnosticBytes(functionOutputActionBytes, actionKind, outputBytes);

      const callId = readOpenAiInputFunctionOutputLookupId(item);
      const repeatedCallId = callId !== null && seenFunctionOutputCallIds.has(callId);
      if (callId !== null) {
        seenFunctionOutputCallIds.add(callId);
      }
      if (repeatedCallId) {
        repeatedFunctionOutputCount += 1;
        repeatedFunctionOutputBytes += outputBytes;
      }
      if (callId !== null && output !== null) {
        const equivalenceState = functionOutputEquivalenceBySerializedValue.get(
          output.serialized,
        );
        if (equivalenceState === undefined) {
          functionOutputEquivalenceBySerializedValue.set(output.serialized, {
            differentCallIdSeen: false,
            firstCallId: callId,
          });
        } else {
          const differsFromFirst = equivalenceState.firstCallId !== callId;
          if (differsFromFirst || equivalenceState.differentCallIdSeen) {
            equivalentFunctionOutputCount += 1;
            equivalentFunctionOutputBytes += outputBytes;
          }
          if (differsFromFirst) {
            equivalenceState.differentCallIdSeen = true;
          }
        }
      }
      if (outputBytes > largestFunctionOutputBytes) {
        largestFunctionOutputBytes = outputBytes;
        largestFunctionOutputIndex = index;
        largestFunctionOutputNameKind = functionNameKind;
      }
    }
  }

  const nestedShape = summarizeOpenAiInputNestedShape(inputValue);
  const inputMetricKinds: string[] = [
    ...OPENAI_CACHE_DIAGNOSTIC_INPUT_NESTED_METRIC_KINDS,
  ];
  const inputMetricCounts = [
    nestedShape.contentCount,
    nestedShape.outputCount,
    nestedShape.stringCount,
  ];
  const inputMetricBytes = [
    nestedShape.contentBytes,
    nestedShape.outputBytes,
    nestedShape.stringBytes,
  ];
  const typeSummary = summarizeOpenAiDiagnosticCountsAndBytes(typeCounts, typeBytes);
  const roleSummary = summarizeOpenAiDiagnosticCounts(roleCounts);
  const functionCallNameSummary = summarizeOpenAiDiagnosticCountsAndBytes(
    functionCallNameCounts,
    functionCallBytes,
  );
  const functionOutputNameSummary = summarizeOpenAiDiagnosticCountsAndBytes(
    functionOutputNameCounts,
    functionOutputBytes,
  );
  diagnostic.inputItemTypeKinds = typeSummary.kinds;
  diagnostic.inputItemTypeCounts = typeSummary.counts;
  diagnostic.inputItemTypeBytes = typeSummary.bytes;
  diagnostic.inputItemRoleKinds = roleSummary.kinds;
  diagnostic.inputItemRoleCounts = roleSummary.counts;
  diagnostic.inputLargestItemBytes = largestItemBytes;
  diagnostic.inputLargestItemIndex = largestItemIndex;
  diagnostic.inputLargestItemReverseIndex =
    largestItemIndex >= 0 ? inputValue.length - 1 - largestItemIndex : -1;
  diagnostic.inputLargestItemKinds = largestItemKinds;
  diagnostic.inputNestedMetricKinds = inputMetricKinds;
  diagnostic.inputNestedMetricCounts = inputMetricCounts;
  diagnostic.inputNestedMetricBytes = inputMetricBytes;
  if (nestedShape.truncated) {
    diagnostic.inputShapeTraversalTruncated = true;
  }
  if (functionCallNameSummary.kinds.length > 0) {
    diagnostic.inputFunctionCallNameKinds = functionCallNameSummary.kinds;
    diagnostic.inputFunctionCallNameCounts = functionCallNameSummary.counts;
    diagnostic.inputFunctionCallBytes = functionCallNameSummary.bytes;
  }
  if (functionOutputNameSummary.kinds.length > 0) {
    diagnostic.inputFunctionOutputNameKinds = functionOutputNameSummary.kinds;
    diagnostic.inputFunctionOutputNameCounts = functionOutputNameSummary.counts;
    diagnostic.inputFunctionOutputBytes = functionOutputNameSummary.bytes;
    diagnostic.inputLargestFunctionOutputBytes = largestFunctionOutputBytes;
    diagnostic.inputLargestFunctionOutputIndex = largestFunctionOutputIndex;
    diagnostic.inputLargestFunctionOutputReverseIndex =
      largestFunctionOutputIndex >= 0 ? inputValue.length - 1 - largestFunctionOutputIndex : -1;
    diagnostic.inputLargestFunctionOutputNameKind = largestFunctionOutputNameKind;
    for (const actionKind of OPENAI_CACHE_DIAGNOSTIC_FUNCTION_OUTPUT_ACTION_KINDS) {
      const actionCount = functionOutputActionCounts.get(actionKind) ?? 0;
      if (actionCount === 0) {
        continue;
      }
      inputMetricKinds.push(
        OPENAI_CACHE_DIAGNOSTIC_FUNCTION_OUTPUT_ACTION_METRIC_KINDS[actionKind],
      );
      inputMetricCounts.push(actionCount);
      inputMetricBytes.push(functionOutputActionBytes.get(actionKind) ?? 0);
    }
    if (repeatedFunctionOutputCount > 0) {
      inputMetricKinds.push(
        OPENAI_CACHE_DIAGNOSTIC_FUNCTION_OUTPUT_REPEATED_METRIC_KIND,
      );
      inputMetricCounts.push(repeatedFunctionOutputCount);
      inputMetricBytes.push(repeatedFunctionOutputBytes);
    }
    if (equivalentFunctionOutputCount > 0) {
      inputMetricKinds.push(
        OPENAI_CACHE_DIAGNOSTIC_FUNCTION_OUTPUT_EQUIVALENT_METRIC_KIND,
      );
      inputMetricCounts.push(equivalentFunctionOutputCount);
      inputMetricBytes.push(equivalentFunctionOutputBytes);
    }
  }

  // Equality comparison is request-local only. Release its serialized-value
  // keys before the asynchronous tail-fingerprint work and never persist them.
  functionOutputEquivalenceBySerializedValue.clear();
  seenFunctionOutputCallIds.clear();

  await appendOpenAiInputTailItemDiagnostics({
    diagnostic,
    fingerprintKey: input.fingerprintKey,
    functionCallNamesById,
    inputValue,
  });
}

async function appendOpenAiInputTailItemDiagnostics(input: {
  diagnostic: HostedRunnerDiagnosticJson;
  fingerprintKey: CryptoKey | null;
  functionCallNamesById: ReadonlyMap<string, string>;
  inputValue: readonly unknown[];
}): Promise<void> {
  const tailItems = input.inputValue.slice(-OPENAI_CACHE_DIAGNOSTIC_INPUT_TAIL_ITEM_COUNT);
  if (tailItems.length === 0) {
    return;
  }

  const startIndex = input.inputValue.length - tailItems.length;
  const indexes: number[] = [];
  const reverseIndexes: number[] = [];
  const typeKinds: string[] = [];
  const roleKinds: string[] = [];
  const itemBytes: number[] = [];
  const contentBytes: number[] = [];
  const outputBytes: number[] = [];
  const stringBytes: number[] = [];
  const functionNameKinds: string[] = [];
  const fingerprints: string[] = [];
  let traversalTruncated = false;
  let functionNameDiagnosticsPresent = false;

  for (const [offset, item] of tailItems.entries()) {
    const index = startIndex + offset;
    const encodedItem = encodeOpenAiDiagnosticJsonValue(item);
    const nestedShape = summarizeOpenAiInputNestedShape(item);
    const typeKind = readOpenAiInputItemTypeKind(item);

    indexes.push(index);
    reverseIndexes.push(input.inputValue.length - 1 - index);
    typeKinds.push(typeKind);
    roleKinds.push(readOpenAiInputItemRoleKind(item));
    itemBytes.push(encodedItem?.byteLength ?? 0);
    contentBytes.push(nestedShape.contentBytes);
    outputBytes.push(nestedShape.outputBytes);
    stringBytes.push(nestedShape.stringBytes);
    traversalTruncated = traversalTruncated || nestedShape.truncated;
    if (typeKind === "function_call") {
      functionNameKinds.push(readOpenAiInputFunctionCallNameKind(
        item,
        input.functionCallNamesById,
      ));
      functionNameDiagnosticsPresent = true;
    } else if (typeKind === "function_call_output") {
      functionNameKinds.push(readOpenAiInputFunctionOutputNameKind(
        item,
        input.functionCallNamesById,
      ));
      functionNameDiagnosticsPresent = true;
    } else {
      functionNameKinds.push("none");
    }

    if (input.fingerprintKey && encodedItem) {
      fingerprints.push(await hmacDiagnosticFingerprint({
        bytes: encodedItem,
        fieldPrefix: "input:item",
        fingerprintKey: input.fingerprintKey,
      }));
    }
  }

  input.diagnostic.inputTailItemCount = tailItems.length;
  input.diagnostic.inputTailItemIndexes = indexes;
  input.diagnostic.inputTailItemReverseIndexes = reverseIndexes;
  input.diagnostic.inputTailItemTypeKinds = typeKinds;
  input.diagnostic.inputTailItemRoleKinds = roleKinds;
  input.diagnostic.inputTailItemBytes = itemBytes;
  input.diagnostic.inputTailItemContentBytes = contentBytes;
  input.diagnostic.inputTailItemOutputBytes = outputBytes;
  input.diagnostic.inputTailItemStringBytes = stringBytes;
  if (functionNameDiagnosticsPresent) {
    input.diagnostic.inputTailItemFunctionNameKinds = functionNameKinds;
  }
  input.diagnostic.inputTailItemFingerprintPresent = fingerprints.length > 0;
  if (fingerprints.length > 0) {
    input.diagnostic.inputTailItemFingerprints = fingerprints;
  }
  if (traversalTruncated) {
    input.diagnostic.inputTailItemShapeTraversalTruncated = true;
  }
}

function readOpenAiInputItemTypeKind(value: unknown): string {
  return readOpenAiInputItemAllowedKind(
    value,
    "type",
    OPENAI_CACHE_DIAGNOSTIC_INPUT_ITEM_TYPE_KINDS,
  );
}

function readOpenAiInputItemRoleKind(value: unknown): string {
  return readOpenAiInputItemAllowedKind(
    value,
    "role",
    OPENAI_CACHE_DIAGNOSTIC_INPUT_ITEM_ROLE_KINDS,
  );
}

function readOpenAiInputItemAllowedKind(
  value: unknown,
  field: "role" | "type",
  allowed: readonly string[],
): string {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return "missing";
  }

  const raw = value[field];
  if (typeof raw !== "string") {
    return "missing";
  }

  const normalized = raw.trim();
  if (normalized.length === 0) {
    return "missing";
  }
  return allowed.includes(normalized) ? normalized : "other";
}

function readOpenAiInputFunctionNameKind(value: unknown): string {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return "unknown";
  }
  return normalizeOpenAiInputFunctionNameKind(readStringRecordProperty(value, "name"));
}

function readOpenAiInputFunctionCallNamesById(inputValue: readonly unknown[]): ReadonlyMap<string, string> {
  const functionCallNamesById = new Map<string, string>();
  for (const item of inputValue) {
    if (readOpenAiInputItemTypeKind(item) !== "function_call") {
      continue;
    }

    const callId = readOpenAiInputFunctionCallLookupId(item);
    if (!callId) {
      continue;
    }

    if (functionCallNamesById.has(callId)) {
      functionCallNamesById.set(callId, OPENAI_CACHE_DIAGNOSTIC_DUPLICATE_FUNCTION_NAME_KIND);
    } else {
      functionCallNamesById.set(callId, readOpenAiInputFunctionNameKind(item));
    }
  }
  return functionCallNamesById;
}

function readOpenAiInputFunctionCallNameKind(
  value: unknown,
  functionCallNamesById: ReadonlyMap<string, string>,
): string {
  const callId = readOpenAiInputFunctionCallLookupId(value);
  if (
    callId
    && functionCallNamesById.get(callId) === OPENAI_CACHE_DIAGNOSTIC_DUPLICATE_FUNCTION_NAME_KIND
  ) {
    return OPENAI_CACHE_DIAGNOSTIC_DUPLICATE_FUNCTION_NAME_KIND;
  }
  return readOpenAiInputFunctionNameKind(value);
}

function readOpenAiInputFunctionOutputNameKind(
  value: unknown,
  functionCallNamesById: ReadonlyMap<string, string>,
): string {
  const callId = readOpenAiInputFunctionOutputLookupId(value);
  return callId ? functionCallNamesById.get(callId) ?? "unknown" : "unknown";
}

function normalizeOpenAiInputFunctionNameKind(value: string | null): string {
  if (!value) {
    return "unknown";
  }
  if (value.length > OPENAI_CACHE_DIAGNOSTIC_FUNCTION_NAME_MAX_CHARS) {
    return "other";
  }
  if (
    !OPENAI_CACHE_DIAGNOSTIC_SAFE_FUNCTION_NAME_PATTERN.test(value)
    || OPENAI_CACHE_DIAGNOSTIC_UNSAFE_FUNCTION_NAME_PATTERN.test(value)
  ) {
    return "other";
  }
  return value;
}

function readOpenAiInputFunctionCallLookupId(value: unknown): string | null {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return null;
  }
  return readStringRecordProperty(value, "call_id") ?? readStringRecordProperty(value, "id");
}

function readOpenAiInputFunctionOutputLookupId(value: unknown): string | null {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return null;
  }
  return readStringRecordProperty(value, "call_id");
}

function readOpenAiInputFunctionOutputActionKind(
  functionNameKind: string,
): HostedOpenAiFunctionOutputActionKind {
  if (OPENAI_CACHE_DIAGNOSTIC_COMMAND_FUNCTION_NAME_KINDS.has(functionNameKind)) {
    return "command.execution";
  }
  if (functionNameKind.startsWith("mcp__")) {
    return "mcp.tool.call";
  }
  if (
    functionNameKind === "duplicate"
    || functionNameKind === "other"
    || functionNameKind === "unknown"
  ) {
    return "other";
  }
  return "dynamic.tool.call";
}

function readOpenAiInputFunctionOutputDiagnosticValue(value: unknown): {
  bytes: Uint8Array;
  serialized: string;
} | null {
  if (!isHostedOpenAiDiagnosticRecord(value)) {
    return null;
  }
  return serializeOpenAiDiagnosticJsonValue(value.output);
}

function summarizeOpenAiInputNestedShape(value: unknown): {
  contentBytes: number;
  contentCount: number;
  outputBytes: number;
  outputCount: number;
  stringCount: number;
  stringBytes: number;
  truncated: boolean;
} {
  const summary = {
    contentBytes: 0,
    contentCount: 0,
    outputBytes: 0,
    outputCount: 0,
    stringCount: 0,
    stringBytes: 0,
    truncated: false,
  };

  const stack: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  let visitedNodes = 0;
  while (stack.length > 0) {
    if (visitedNodes >= OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_NODES) {
      summary.truncated = true;
      break;
    }
    visitedNodes += 1;

    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (typeof current.value === "string") {
      summary.stringCount += 1;
      summary.stringBytes += byteLengthOfDiagnosticText(current.value);
      continue;
    }

    if (!current.value || typeof current.value !== "object") {
      continue;
    }

    if (current.depth >= OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_DEPTH) {
      summary.truncated = true;
      continue;
    }

    if (Array.isArray(current.value)) {
      for (const entry of current.value) {
        if (visitedNodes + stack.length >= OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_NODES) {
          summary.truncated = true;
          break;
        }
        stack.push({ depth: current.depth + 1, value: entry });
      }
      continue;
    }

    for (const [key, entry] of Object.entries(current.value)) {
      if (OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_KEYS.has(key)) {
        const entryBytes = encodeOpenAiDiagnosticJsonValue(entry)?.byteLength ?? 0;
        if (key === "content") {
          summary.contentCount += 1;
          summary.contentBytes += entryBytes;
        } else {
          summary.outputCount += 1;
          summary.outputBytes += entryBytes;
        }
      }
      if (visitedNodes + stack.length >= OPENAI_CACHE_DIAGNOSTIC_INPUT_SHAPE_MAX_NODES) {
        summary.truncated = true;
        break;
      }
      stack.push({ depth: current.depth + 1, value: entry });
    }
  }

  return summary;
}

function incrementDiagnosticCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function addDiagnosticBytes(bytesByKind: Map<string, number>, key: string, bytes: number): void {
  bytesByKind.set(key, (bytesByKind.get(key) ?? 0) + bytes);
}

function summarizeOpenAiDiagnosticCounts(counts: Map<string, number>): {
  counts: number[];
  kinds: string[];
} {
  const entries = [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (entries.length > OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS) {
    const visible = entries.slice(0, OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS - 1);
    const overflowCount = entries
      .slice(OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS - 1)
      .reduce((total, [, count]) => total + count, 0);
    const otherIndex = visible.findIndex(([kind]) => kind === "other");
    if (otherIndex >= 0) {
      const [kind, count] = visible[otherIndex] ?? ["other", 0];
      visible[otherIndex] = [kind, count + overflowCount];
    } else {
      visible.push(["other", overflowCount]);
    }
    return {
      counts: visible.map(([, count]) => count),
      kinds: visible.map(([kind]) => kind),
    };
  }
  return {
    counts: entries.map(([, count]) => count),
    kinds: entries.map(([kind]) => kind),
  };
}

function summarizeOpenAiDiagnosticCountsAndBytes(
  counts: Map<string, number>,
  bytesByKind: Map<string, number>,
): {
  bytes: number[];
  counts: number[];
  kinds: string[];
} {
  const entries = [...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const readBytes = (kind: string) => bytesByKind.get(kind) ?? 0;
  const summaryEntries: Array<[string, number, number]> = entries.map(([kind, count]) => [
    kind,
    count,
    readBytes(kind),
  ]);
  if (entries.length > OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS) {
    const visible = summaryEntries.slice(0, OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS - 1);
    const overflow = summaryEntries.slice(OPENAI_CACHE_DIAGNOSTIC_MAX_COUNT_BUCKETS - 1);
    const overflowCount = overflow.reduce((total, [, count]) => total + count, 0);
    const overflowBytes = overflow.reduce((total, [, , bytes]) => total + bytes, 0);
    const otherIndex = visible.findIndex(([kind]) => kind === "other");
    if (otherIndex >= 0) {
      const [kind, count, bytes] = visible[otherIndex] ?? ["other", 0, 0];
      visible[otherIndex] = [kind, count + overflowCount, bytes + overflowBytes];
    } else {
      visible.push(["other", overflowCount, overflowBytes]);
    }
    return {
      bytes: visible.map(([, , bytes]) => bytes),
      counts: visible.map(([, count]) => count),
      kinds: visible.map(([kind]) => kind),
    };
  }
  return {
    bytes: summaryEntries.map(([, , bytes]) => bytes),
    counts: summaryEntries.map(([, count]) => count),
    kinds: summaryEntries.map(([kind]) => kind),
  };
}

function byteLengthOfDiagnosticText(value: string): number {
  return OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(value).byteLength;
}

async function createOpenAiCacheDiagnosticFingerprintKey(
  secret: string | null,
): Promise<CryptoKey | null> {
  const normalized = secret?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  return await crypto.subtle.importKey(
    "raw",
    OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(normalized),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
}

async function hmacDiagnosticFingerprint(input: {
  bytes: Uint8Array;
  fieldPrefix: string;
  fingerprintKey: CryptoKey;
}): Promise<string> {
  const context = OPENAI_CACHE_DIAGNOSTIC_TEXT_ENCODER.encode(
    `${OPENAI_CACHE_DIAGNOSTIC_FINGERPRINT_CONTEXT}\0${input.fieldPrefix}\0`,
  );
  const payload = new Uint8Array(context.byteLength + input.bytes.byteLength);
  payload.set(context);
  payload.set(input.bytes, context.byteLength);
  const digestInput = payload.buffer instanceof ArrayBuffer
    ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
    : copyDiagnosticBytesToArrayBuffer(payload);
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    input.fingerprintKey,
    digestInput,
  ));
  return `hmac-sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function copyDiagnosticBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isHostedOpenAiDiagnosticRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

