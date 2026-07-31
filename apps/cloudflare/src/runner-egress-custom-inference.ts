import {
  buildHostedCustomInferenceModelAlias,
} from "@murphai/hosted-execution/assistant-inference";
import type {
  HostedInferenceRuntimeTarget,
} from "./hosted-inference-runtime-target.ts";

export const HOSTED_CUSTOM_INFERENCE_RESPONSES_MAX_BODY_BYTES = 8 * 1024 * 1024;

const HOSTED_CUSTOM_INFERENCE_MAX_TOOLS = 128;
const HOSTED_CUSTOM_INFERENCE_MAX_TOOL_SCHEMA_BYTES = 256 * 1024;
const HOSTED_CUSTOM_INFERENCE_MAX_SSE_EVENT_BYTES = 1024 * 1024;
const HOSTED_CUSTOM_INFERENCE_MAX_STREAM_BYTES = 16 * 1024 * 1024;
const HOSTED_CUSTOM_INFERENCE_MAX_TRANSLATED_OUTPUT_BYTES = 16 * 1024 * 1024;
const HOSTED_CUSTOM_INFERENCE_MAX_TRANSLATED_STATE_BYTES = 512 * 1024;
const HOSTED_CUSTOM_INFERENCE_CUSTOM_TOOL_PREFIX = "murph_custom_";
const HOSTED_CUSTOM_INFERENCE_NAMESPACE_TOOL_PREFIX = "murph_ns_";
const HOSTED_CUSTOM_INFERENCE_TEXT_ENCODER = new TextEncoder();

const HOSTED_CUSTOM_INFERENCE_ALLOWED_RESPONSES_KEYS = new Set([
  "background",
  "include",
  "input",
  "instructions",
  "max_output_tokens",
  "metadata",
  "model",
  "parallel_tool_calls",
  "prompt_cache_key",
  "prompt_cache_retention",
  "reasoning",
  "safety_identifier",
  "service_tier",
  "store",
  "stream",
  "stream_options",
  "temperature",
  "text",
  "tool_choice",
  "tools",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
]);

export class HostedCustomInferenceRequestError extends Error {
  constructor(
    readonly code:
      | "IMAGE_INPUT_UNSUPPORTED"
      | "MODEL_ALIAS_MISMATCH"
      | "REQUEST_INVALID"
      | "RESPONSE_INVALID"
      | "TOOL_UNSUPPORTED",
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "HostedCustomInferenceRequestError";
  }
}

export function buildHostedCustomInferenceUpstreamRequestBody(input: {
  body: ArrayBuffer;
  target: HostedInferenceRuntimeTarget;
}): string {
  const record = parseHostedCustomInferenceRequest(input.body);
  if (
    record.model !== buildHostedCustomInferenceModelAlias(input.target.revision)
  ) {
    throw new HostedCustomInferenceRequestError(
      "MODEL_ALIAS_MISMATCH",
      403,
      "The custom inference model alias did not match the active connection.",
    );
  }
  if (!input.target.supportsImages && containsImageInput(record.input)) {
    throw new HostedCustomInferenceRequestError(
      "IMAGE_INPUT_UNSUPPORTED",
      422,
      "The selected custom inference endpoint does not support image input.",
    );
  }

  return input.target.protocol === "responses"
    ? buildNativeResponsesRequest(record, input.target)
    : buildChatCompletionsRequest(record, input.target);
}

export async function adaptHostedCustomInferenceUpstreamResponse(input: {
  protocol: HostedInferenceRuntimeTarget["protocol"];
  response: Response;
  revision: number;
}): Promise<Response> {
  if (!input.response.ok) {
    await input.response.body?.cancel();
    return safeUpstreamError(input.response.status);
  }
  if (!isEventStream(input.response.headers.get("content-type"))) {
    await input.response.body?.cancel();
    throw new HostedCustomInferenceRequestError(
      "RESPONSE_INVALID",
      502,
      "The custom inference endpoint returned an invalid stream.",
    );
  }
  if (!input.response.body) {
    throw new HostedCustomInferenceRequestError(
      "RESPONSE_INVALID",
      502,
      "The custom inference endpoint returned an empty stream.",
    );
  }

  const modelAlias = buildHostedCustomInferenceModelAlias(input.revision);
  const body = input.protocol === "responses"
    ? validateNativeResponsesStream(input.response.body, modelAlias)
    : translateChatCompletionsStream(input.response.body, modelAlias);
  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/event-stream; charset=utf-8",
    },
    status: 200,
  });
}

export function injectHostedCustomInferenceAuth(
  headers: Headers,
  target: HostedInferenceRuntimeTarget,
): void {
  switch (target.auth.kind) {
    case "bearer":
      headers.set("authorization", `Bearer ${target.auth.secret}`);
      return;
    case "api_key":
      headers.set("api-key", target.auth.secret);
      return;
    case "x_api_key":
      headers.set("x-api-key", target.auth.secret);
      return;
  }
}

function parseHostedCustomInferenceRequest(
  body: ArrayBuffer,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw invalidRequest();
  }
  if (!isJsonObject(parsed)) {
    throw invalidRequest();
  }
  if (
    Object.keys(parsed).some((key) =>
      !HOSTED_CUSTOM_INFERENCE_ALLOWED_RESPONSES_KEYS.has(key)
    )
    || parsed.input === undefined
    || typeof parsed.model !== "string"
  ) {
    throw invalidRequest();
  }
  validateToolBudget(readResponsesTools(parsed));
  return parsed;
}

function buildNativeResponsesRequest(
  record: Record<string, unknown>,
  target: HostedInferenceRuntimeTarget,
): string {
  const upstream: Record<string, unknown> = {
    ...record,
    model: target.model,
    parallel_tool_calls: false,
    store: false,
    stream: true,
  };
  delete upstream.include;
  delete upstream.prompt_cache_key;
  delete upstream.prompt_cache_retention;
  delete upstream.reasoning;
  delete upstream.service_tier;
  delete upstream.stream_options;
  return JSON.stringify(upstream);
}

function buildChatCompletionsRequest(
  record: Record<string, unknown>,
  target: HostedInferenceRuntimeTarget,
): string {
  const tools = readResponsesTools(record);
  const normalizedTools = normalizeChatTools(tools);
  const messages = translateResponsesInputToChatMessages({
    input: record.input,
    instructions: record.instructions,
  });
  const request: Record<string, unknown> = {
    messages,
    model: target.model,
    parallel_tool_calls: false,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (normalizedTools.length > 0) {
    request.tools = normalizedTools;
  }
  const maxTokens = record.max_output_tokens;
  if (
    typeof maxTokens === "number"
    && Number.isSafeInteger(maxTokens)
    && maxTokens > 0
  ) {
    request.max_tokens = maxTokens;
  }
  if (typeof record.temperature === "number" && Number.isFinite(record.temperature)) {
    request.temperature = record.temperature;
  }
  if (typeof record.top_p === "number" && Number.isFinite(record.top_p)) {
    request.top_p = record.top_p;
  }
  const toolChoice = normalizeChatToolChoice(record.tool_choice);
  if (toolChoice !== undefined) {
    request.tool_choice = toolChoice;
  }
  return JSON.stringify(request);
}

function readResponsesTools(record: Record<string, unknown>): unknown[] {
  const topLevel = record.tools;
  const input = record.input;
  let additional: unknown[] | null = null;
  const cleanedInput: unknown[] = [];

  if (Array.isArray(input)) {
    for (const item of input) {
      if (isJsonObject(item) && item.type === "additional_tools") {
        if (
          additional !== null
          || item.role !== "developer"
          || !Array.isArray(item.tools)
          || Object.keys(item).some((key) =>
            key !== "id" && key !== "role" && key !== "tools" && key !== "type"
          )
        ) {
          throw unsupportedTool();
        }
        additional = item.tools;
      } else {
        cleanedInput.push(item);
      }
    }
    if (additional !== null) {
      if (topLevel !== undefined && topLevel !== null) {
        throw unsupportedTool();
      }
      record.input = cleanedInput;
      record.tools = additional;
    }
  }

  if (additional !== null) {
    return additional;
  }
  if (topLevel === undefined || topLevel === null) {
    return [];
  }
  if (!Array.isArray(topLevel)) {
    throw invalidRequest();
  }
  return topLevel;
}

function validateToolBudget(tools: unknown[]): void {
  if (tools.length > HOSTED_CUSTOM_INFERENCE_MAX_TOOLS) {
    throw unsupportedTool();
  }
  const bytes = HOSTED_CUSTOM_INFERENCE_TEXT_ENCODER.encode(
    JSON.stringify(tools),
  ).byteLength;
  if (bytes > HOSTED_CUSTOM_INFERENCE_MAX_TOOL_SCHEMA_BYTES) {
    throw unsupportedTool();
  }
}

function normalizeChatTools(tools: unknown[]): Record<string, unknown>[] {
  const normalized: Record<string, unknown>[] = [];
  for (const tool of tools) {
    if (!isJsonObject(tool) || typeof tool.type !== "string") {
      throw unsupportedTool();
    }
    if (tool.type === "function") {
      normalized.push({
        function: normalizeChatFunctionDefinition(tool),
        type: "function",
      });
      continue;
    }
    if (tool.type === "custom") {
      normalized.push({
        function: normalizeCustomToolDefinition(tool),
        type: "function",
      });
      continue;
    }
    if (tool.type === "namespace") {
      const namespace = requireToolName(tool.name);
      if (!Array.isArray(tool.tools)) {
        throw unsupportedTool();
      }
      for (const nested of tool.tools) {
        if (!isJsonObject(nested) || typeof nested.name !== "string") {
          throw unsupportedTool();
        }
        normalized.push({
          function: normalizeNamespaceToolDefinition(namespace, nested),
          type: "function",
        });
      }
      continue;
    }
    throw unsupportedTool();
  }
  if (normalized.length > HOSTED_CUSTOM_INFERENCE_MAX_TOOLS) {
    throw unsupportedTool();
  }
  return normalized;
}

function normalizeChatFunctionDefinition(
  tool: Record<string, unknown>,
): Record<string, unknown> {
  const name = requireToolName(tool.name);
  const parameters = isJsonObject(tool.parameters)
    ? tool.parameters
    : { additionalProperties: true, type: "object" };
  return {
    ...(typeof tool.description === "string"
      ? { description: tool.description.slice(0, 4_096) }
      : {}),
    name,
    parameters,
  };
}

function normalizeCustomToolDefinition(
  tool: Record<string, unknown>,
): Record<string, unknown> {
  const name = encodeCustomToolName(requireToolName(tool.name));
  return {
    ...(typeof tool.description === "string"
      ? { description: tool.description.slice(0, 4_096) }
      : {}),
    name,
    parameters: {
      additionalProperties: false,
      properties: { input: { type: "string" } },
      required: ["input"],
      type: "object",
    },
  };
}

function normalizeNamespaceToolDefinition(
  namespace: string,
  tool: Record<string, unknown>,
): Record<string, unknown> {
  const name = requireToolName(tool.name);
  return {
    ...(typeof tool.description === "string"
      ? { description: tool.description.slice(0, 4_096) }
      : {}),
    name: encodeNamespaceToolName({ name, namespace }),
    parameters: readToolParameters(tool),
  };
}

function readToolParameters(
  tool: Record<string, unknown>,
): Record<string, unknown> {
  for (const candidate of [
    tool.parameters,
    tool.input_schema,
    tool.inputSchema,
  ]) {
    if (isJsonObject(candidate)) return candidate;
  }
  return { additionalProperties: true, type: "object" };
}

function translateResponsesInputToChatMessages(input: {
  input: unknown;
  instructions: unknown;
}): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  let pendingToolCalls: Record<string, unknown>[] = [];
  const flushPendingToolCalls = (): void => {
    if (pendingToolCalls.length === 0) return;
    messages.push({
      content: null,
      role: "assistant",
      tool_calls: pendingToolCalls,
    });
    pendingToolCalls = [];
  };
  if (typeof input.instructions === "string" && input.instructions.trim()) {
    messages.push({ content: input.instructions, role: "developer" });
  } else if (input.instructions !== undefined && input.instructions !== null) {
    throw invalidRequest();
  }
  if (typeof input.input === "string") {
    messages.push({ content: input.input, role: "user" });
    return messages;
  }
  if (!Array.isArray(input.input)) {
    throw invalidRequest();
  }

  for (const item of input.input) {
    if (!isJsonObject(item)) {
      throw invalidRequest();
    }
    if (item.type === "message") {
      flushPendingToolCalls();
      messages.push({
        content: normalizeChatMessageContent(item.content),
        role: requireChatRole(item.role),
      });
      continue;
    }
    if (item.type === "function_call" || item.type === "custom_tool_call") {
      const callId = requireCallId(item.call_id);
      const originalName = requireToolName(item.name);
      const custom = item.type === "custom_tool_call";
      const namespace = custom || item.namespace === undefined
        ? null
        : requireToolName(item.namespace);
      pendingToolCalls.push({
        function: {
          arguments: custom
            ? JSON.stringify({
                input: typeof item.input === "string" ? item.input : "",
              })
            : requireArguments(item.arguments),
          name: custom
            ? encodeCustomToolName(originalName)
            : namespace
              ? encodeNamespaceToolName({
                  name: originalName,
                  namespace,
                })
              : originalName,
        },
        id: callId,
        type: "function",
      });
      continue;
    }
    if (
      item.type === "function_call_output"
      || item.type === "custom_tool_call_output"
    ) {
      flushPendingToolCalls();
      messages.push({
        content: normalizeToolOutput(item.output),
        role: "tool",
        tool_call_id: requireCallId(item.call_id),
      });
      continue;
    }
    if (
      item.type === "reasoning"
      || item.type === "additional_tools"
      || item.type === "context_compaction"
    ) {
      continue;
    }
    flushPendingToolCalls();
    throw unsupportedTool();
  }
  flushPendingToolCalls();
  return messages;
}

function normalizeChatMessageContent(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw invalidRequest();
  const content: Record<string, unknown>[] = [];
  for (const part of value) {
    if (!isJsonObject(part)) throw invalidRequest();
    if (
      (part.type === "input_text" || part.type === "output_text")
      && typeof part.text === "string"
    ) {
      content.push({ text: part.text, type: "text" });
      continue;
    }
    if (part.type === "input_image") {
      const url = typeof part.image_url === "string"
        ? part.image_url
        : isJsonObject(part.image_url) && typeof part.image_url.url === "string"
          ? part.image_url.url
          : null;
      if (!url) throw invalidRequest();
      content.push({ image_url: { url }, type: "image_url" });
      continue;
    }
    throw invalidRequest();
  }
  return content;
}

function normalizeChatToolChoice(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (value === "auto" || value === "none" || value === "required") {
    return value;
  }
  if (
    isJsonObject(value)
    && value.type === "function"
    && typeof value.name === "string"
  ) {
    return {
      function: { name: requireToolName(value.name) },
      type: "function",
    };
  }
  throw unsupportedTool();
}

function validateNativeResponsesStream(
  source: ReadableStream<Uint8Array>,
  modelAlias: string,
): ReadableStream<Uint8Array> {
  let terminal = false;
  let created = false;
  return transformSseStream(source, (event) => {
    if (event.data === "[DONE]") {
      if (!terminal) throw invalidResponse();
      return "data: [DONE]\n\n";
    }
    const payload = parseSseJson(event.data);
    const type = typeof payload.type === "string" ? payload.type : "";
    if (
      !type
      || (event.event && event.event !== type)
      || (
        type !== "error"
        && !type.startsWith("response.")
      )
      || terminal
    ) {
      throw invalidResponse();
    }
    if (type === "error" || type === "response.failed") {
      throw invalidResponse();
    }
    if (!created && type !== "response.created" && type !== "error") {
      throw invalidResponse();
    }
    if (type === "response.created") {
      if (created) throw invalidResponse();
      created = true;
    }
    if (
      type === "response.completed"
      || type === "response.incomplete"
    ) {
      terminal = true;
    }
    if (payload.error !== undefined && payload.error !== null) {
      throw invalidResponse();
    }
    if (isJsonObject(payload.response)) {
      if (
        payload.response.error !== undefined
        && payload.response.error !== null
      ) {
        throw invalidResponse();
      }
      payload.response.model = modelAlias;
    }
    return formatSseEvent(type, payload);
  }, () => {
    if (!terminal) throw invalidResponse();
  });
}

function translateChatCompletionsStream(
  source: ReadableStream<Uint8Array>,
  modelAlias: string,
): ReadableStream<Uint8Array> {
  const state: ChatTranslationState = {
    completed: false,
    created: false,
    finishReason: null,
    model: null,
    output: [],
    retainedBytes: 0,
    responseId: null,
    text: null,
    toolCalls: new Map(),
    usage: null,
  };
  return transformSseStream(source, (event) => {
    if (state.completed) throw invalidResponse();
    if (event.data === "[DONE]") {
      return completeChatTranslation(state);
    }
    const payload = parseSseJson(event.data);
    if (payload.object !== "chat.completion.chunk") {
      throw invalidResponse();
    }
    let output = initializeChatTranslation(state, payload, modelAlias);
    readChatUsage(state, payload.usage);
    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length > 1) {
      throw invalidResponse();
    }
    for (const choice of choices) {
      if (!isJsonObject(choice) || choice.index !== 0) {
        throw invalidResponse();
      }
      const delta = choice.delta;
      if (!isJsonObject(delta)) throw invalidResponse();
      if (typeof delta.content === "string" && delta.content) {
        output += appendChatTextDelta(state, delta.content);
      }
      if (delta.tool_calls !== undefined) {
        output += appendChatToolCallDeltas(state, delta.tool_calls);
      }
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
        if (
          choice.finish_reason !== "stop"
          && choice.finish_reason !== "tool_calls"
          && choice.finish_reason !== "length"
        ) {
          throw invalidResponse();
        }
        if (
          state.finishReason !== null
          && state.finishReason !== choice.finish_reason
        ) {
          throw invalidResponse();
        }
        state.finishReason = choice.finish_reason;
      }
    }
    return output;
  }, () => {
    if (!state.completed) throw invalidResponse();
  });
}

interface SseEvent {
  data: string;
  event: string | null;
}

function transformSseStream(
  source: ReadableStream<Uint8Array>,
  transform: (event: SseEvent) => string | Iterable<string>,
  finish: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;
  let translatedBytes = 0;
  let cancelled = false;
  let sourceDone = false;
  let readerReleased = false;
  let transformedOutput: Iterator<string> | null = null;
  let pendingCarriageReturn = false;
  const normalizeLineEndings = (value: string, final: boolean): string => {
    let text = pendingCarriageReturn ? `\r${value}` : value;
    pendingCarriageReturn = false;
    if (!final && text.endsWith("\r")) {
      pendingCarriageReturn = true;
      text = text.slice(0, -1);
    }
    return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  };
  const releaseReader = (): void => {
    if (readerReleased) return;
    readerReleased = true;
    reader.releaseLock();
  };
  const enqueue = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    value: string,
  ): boolean => {
    if (!value) return false;
    const encoded = HOSTED_CUSTOM_INFERENCE_TEXT_ENCODER.encode(value);
    translatedBytes += encoded.byteLength;
    if (translatedBytes > HOSTED_CUSTOM_INFERENCE_MAX_TRANSLATED_OUTPUT_BYTES) {
      throw invalidResponse();
    }
    controller.enqueue(encoded);
    return true;
  };

  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      cancelled = true;
      try {
        await reader.cancel(reason);
      } finally {
        releaseReader();
      }
    },
    async pull(controller) {
      try {
        while (!cancelled) {
          if (transformedOutput) {
            const next = transformedOutput.next();
            if (!next.done) {
              if (enqueue(controller, next.value)) return;
              continue;
            }
            transformedOutput = null;
          }

          const separator = buffer.indexOf("\n\n");
          if (separator >= 0) {
            const raw = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            if (raw.trim()) {
              if (
                HOSTED_CUSTOM_INFERENCE_TEXT_ENCODER.encode(raw).byteLength
                > HOSTED_CUSTOM_INFERENCE_MAX_SSE_EVENT_BYTES
              ) {
                throw invalidResponse();
              }
              const output = transform(parseSseEvent(raw));
              transformedOutput = typeof output === "string"
                ? [output][Symbol.iterator]()
                : output[Symbol.iterator]();
            }
            continue;
          }

          if (sourceDone) {
            if (buffer.trim()) throw invalidResponse();
            finish();
            releaseReader();
            controller.close();
            return;
          }

          if (
            HOSTED_CUSTOM_INFERENCE_TEXT_ENCODER.encode(buffer).byteLength
            > HOSTED_CUSTOM_INFERENCE_MAX_SSE_EVENT_BYTES
          ) {
            throw invalidResponse();
          }

          const { done, value } = await reader.read();
          if (done) {
            sourceDone = true;
            buffer += normalizeLineEndings(decoder.decode(), true);
            continue;
          }
          totalBytes += value.byteLength;
          if (totalBytes > HOSTED_CUSTOM_INFERENCE_MAX_STREAM_BYTES) {
            throw invalidResponse();
          }
          buffer += normalizeLineEndings(
            decoder.decode(value, { stream: true }),
            false,
          );
        }
      } catch (error) {
        controller.error(error);
        await reader.cancel(error).catch(() => undefined);
        releaseReader();
      }
    },
  });
}

function parseSseEvent(raw: string): SseEvent {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
      continue;
    }
    throw invalidResponse();
  }
  if (data.length === 0) throw invalidResponse();
  return { data: data.join("\n"), event };
}

function parseSseJson(data: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw invalidResponse();
  }
  if (!isJsonObject(parsed)) throw invalidResponse();
  return parsed;
}

interface ChatToolCallState {
  arguments: string;
  id: string;
  index: number;
  kind: "custom" | "function" | "namespace";
  name: string;
  namespace: string | null;
  outputIndex: number;
}

interface ChatTextState {
  id: string;
  outputIndex: number;
  text: string;
}

interface ChatTranslationState {
  completed: boolean;
  created: boolean;
  finishReason: "length" | "stop" | "tool_calls" | null;
  model: string | null;
  output: Record<string, unknown>[];
  retainedBytes: number;
  responseId: string | null;
  text: ChatTextState | null;
  toolCalls: Map<number, ChatToolCallState>;
  usage: Record<string, unknown> | null;
}

function initializeChatTranslation(
  state: ChatTranslationState,
  payload: Record<string, unknown>,
  modelAlias: string,
): string {
  if (state.created) return "";
  const rawId = typeof payload.id === "string" ? payload.id : "";
  const model = typeof payload.model === "string" ? payload.model : "";
  if (!rawId || !model) throw invalidResponse();
  state.responseId = `resp_murph_${safeIdentifier(rawId)}`;
  state.model = modelAlias;
  state.created = true;
  return formatSseEvent("response.created", {
    response: buildCompletedResponsesRecord(state, "in_progress"),
    type: "response.created",
  });
}

function appendChatTextDelta(
  state: ChatTranslationState,
  delta: string,
): string {
  if (!state.responseId) throw invalidResponse();
  let output = "";
  if (!state.text) {
    const outputIndex = state.toolCalls.size;
    const id = `msg_${safeIdentifier(state.responseId)}`;
    state.text = { id, outputIndex, text: "" };
    output += formatSseEvent("response.output_item.added", {
      item: {
        content: [],
        id,
        role: "assistant",
        status: "in_progress",
        type: "message",
      },
      output_index: outputIndex,
      type: "response.output_item.added",
    });
    output += formatSseEvent("response.content_part.added", {
      content_index: 0,
      item_id: id,
      output_index: outputIndex,
      part: { annotations: [], text: "", type: "output_text" },
      type: "response.content_part.added",
    });
  }
  reserveChatTranslationBytes(state, delta);
  state.text.text += delta;
  output += formatSseEvent("response.output_text.delta", {
    content_index: 0,
    delta,
    item_id: state.text.id,
    output_index: state.text.outputIndex,
    type: "response.output_text.delta",
  });
  return output;
}

function appendChatToolCallDeltas(
  state: ChatTranslationState,
  value: unknown,
): string {
  if (!Array.isArray(value) || value.length > HOSTED_CUSTOM_INFERENCE_MAX_TOOLS) {
    throw invalidResponse();
  }
  let output = "";
  for (const raw of value) {
    if (
      !isJsonObject(raw)
      || typeof raw.index !== "number"
      || !Number.isSafeInteger(raw.index)
      || raw.index < 0
      || !isJsonObject(raw.function)
    ) {
      throw invalidResponse();
    }
    const functionDelta = raw.function;
    let call = state.toolCalls.get(raw.index);
    if (!call) {
      if (state.toolCalls.size >= HOSTED_CUSTOM_INFERENCE_MAX_TOOLS) {
        throw invalidResponse();
      }
      const encodedName = typeof functionDelta.name === "string"
        ? functionDelta.name
        : "";
      const decodedCustomName = decodeCustomToolName(encodedName);
      const decodedNamespaceTool = decodeNamespaceToolName(encodedName);
      const name = decodedCustomName
        ?? decodedNamespaceTool?.name
        ?? requireToolName(encodedName);
      const id = typeof raw.id === "string" && raw.id
        ? requireCallId(raw.id)
        : `call_murph_${raw.index}`;
      call = {
        arguments: "",
        id,
        index: raw.index,
        kind: decodedCustomName !== null
          ? "custom"
          : decodedNamespaceTool
            ? "namespace"
            : "function",
        name,
        namespace: decodedNamespaceTool?.namespace ?? null,
        outputIndex: (state.text ? 1 : 0) + state.toolCalls.size,
      };
      reserveChatTranslationBytes(
        state,
        `${call.id}\u0000${call.name}\u0000${call.namespace ?? ""}`,
      );
      state.toolCalls.set(raw.index, call);
      output += formatSseEvent("response.output_item.added", {
        item: call.kind === "custom"
          ? {
              call_id: call.id,
              id: `ctcall_${safeIdentifier(call.id)}`,
              input: "",
              name: call.name,
              status: "in_progress",
              type: "custom_tool_call",
            }
          : {
              arguments: "",
              call_id: call.id,
              id: `fcall_${safeIdentifier(call.id)}`,
              name: call.name,
              ...(call.namespace ? { namespace: call.namespace } : {}),
              status: "in_progress",
              type: "function_call",
            },
        output_index: call.outputIndex,
        type: "response.output_item.added",
      });
    }
    if (
      functionDelta.name !== undefined
      && functionDelta.name !== encodeToolCallName(call)
    ) {
      throw invalidResponse();
    }
    if (
      raw.id !== undefined
      && requireCallId(raw.id) !== call.id
    ) {
      throw invalidResponse();
    }
    if (functionDelta.arguments !== undefined) {
      if (typeof functionDelta.arguments !== "string") throw invalidResponse();
      reserveChatTranslationBytes(state, functionDelta.arguments);
      call.arguments += functionDelta.arguments;
      if (
        HOSTED_CUSTOM_INFERENCE_TEXT_ENCODER.encode(call.arguments).byteLength
        > HOSTED_CUSTOM_INFERENCE_MAX_SSE_EVENT_BYTES
      ) {
        throw invalidResponse();
      }
      if (call.kind !== "custom" && functionDelta.arguments) {
        output += formatSseEvent("response.function_call_arguments.delta", {
          delta: functionDelta.arguments,
          item_id: `fcall_${safeIdentifier(call.id)}`,
          output_index: call.outputIndex,
          type: "response.function_call_arguments.delta",
        });
      }
    }
  }
  return output;
}

function reserveChatTranslationBytes(
  state: ChatTranslationState,
  value: string,
): void {
  state.retainedBytes += HOSTED_CUSTOM_INFERENCE_TEXT_ENCODER.encode(value)
    .byteLength;
  if (state.retainedBytes > HOSTED_CUSTOM_INFERENCE_MAX_TRANSLATED_STATE_BYTES) {
    throw invalidResponse();
  }
}

function* completeChatTranslation(
  state: ChatTranslationState,
): Generator<string, void, void> {
  if (
    !state.created
    || !state.responseId
    || !state.model
    || state.finishReason === null
  ) {
    throw invalidResponse();
  }
  if (
    (state.finishReason === "tool_calls" && state.toolCalls.size === 0)
    || (state.finishReason !== "tool_calls" && state.toolCalls.size > 0)
  ) {
    throw invalidResponse();
  }
  const entries: Array<
    | {
        content: Record<string, unknown>;
        item: Record<string, unknown>;
        kind: "text";
        outputIndex: number;
        text: ChatTextState;
      }
    | {
        call: ChatToolCallState;
        item: Record<string, unknown>;
        kind: "tool";
        outputIndex: number;
      }
  > = [];
  if (state.text) {
    const content = {
      annotations: [],
      text: state.text.text,
      type: "output_text",
    };
    const item = {
      content: [content],
      id: state.text.id,
      role: "assistant",
      status: "completed",
      type: "message",
    };
    entries.push({
      content,
      item,
      kind: "text",
      outputIndex: state.text.outputIndex,
      text: state.text,
    });
  }
  for (const call of state.toolCalls.values()) {
    entries.push({
      call,
      item: buildCompletedToolCallItem(call),
      kind: "tool",
      outputIndex: call.outputIndex,
    });
  }
  entries.sort((a, b) => a.outputIndex - b.outputIndex);
  state.output = entries.map((entry) => entry.item);

  for (const entry of entries) {
    if (entry.kind === "text") {
      yield formatSseEvent("response.output_text.done", {
        content_index: 0,
        item_id: entry.text.id,
        output_index: entry.outputIndex,
        text: entry.text.text,
        type: "response.output_text.done",
      });
      yield formatSseEvent("response.content_part.done", {
        content_index: 0,
        item_id: entry.text.id,
        output_index: entry.outputIndex,
        part: entry.content,
        type: "response.content_part.done",
      });
    } else if (entry.call.kind !== "custom") {
      yield formatSseEvent("response.function_call_arguments.done", {
        arguments: entry.call.arguments,
        item_id: `fcall_${safeIdentifier(entry.call.id)}`,
        output_index: entry.outputIndex,
        type: "response.function_call_arguments.done",
      });
    }
    yield formatSseEvent("response.output_item.done", {
      item: entry.item,
      output_index: entry.outputIndex,
      type: "response.output_item.done",
    });
  }

  state.completed = true;
  const terminalType = state.finishReason === "length"
    ? "response.incomplete"
    : "response.completed";
  yield formatSseEvent(terminalType, {
    response: buildCompletedResponsesRecord(
      state,
      state.finishReason === "length" ? "incomplete" : "completed",
    ),
    type: terminalType,
  });
  yield "data: [DONE]\n\n";
}

function buildCompletedToolCallItem(
  call: ChatToolCallState,
): Record<string, unknown> {
  if (call.kind === "custom") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.arguments);
    } catch {
      throw invalidResponse();
    }
    if (
      !isJsonObject(parsed)
      || typeof parsed.input !== "string"
      || Object.keys(parsed).some((key) => key !== "input")
    ) {
      throw invalidResponse();
    }
    return {
      call_id: call.id,
      id: `ctcall_${safeIdentifier(call.id)}`,
      input: parsed.input,
      name: call.name,
      status: "completed",
      type: "custom_tool_call",
    };
  }
  try {
    JSON.parse(call.arguments);
  } catch {
    throw invalidResponse();
  }
  return {
    arguments: call.arguments,
    call_id: call.id,
    id: `fcall_${safeIdentifier(call.id)}`,
    name: call.name,
    ...(call.namespace ? { namespace: call.namespace } : {}),
    status: "completed",
    type: "function_call",
  };
}

function buildCompletedResponsesRecord(
  state: ChatTranslationState,
  status: "completed" | "in_progress" | "incomplete",
): Record<string, unknown> {
  return {
    created_at: Math.floor(Date.now() / 1000),
    id: state.responseId,
    model: state.model,
    ...(status === "incomplete"
      ? { incomplete_details: { reason: "max_output_tokens" } }
      : {}),
    output: status === "in_progress" ? [] : state.output,
    status,
    usage: state.usage ?? {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  };
}

function readChatUsage(state: ChatTranslationState, value: unknown): void {
  if (value === undefined || value === null) return;
  if (!isJsonObject(value)) throw invalidResponse();
  const inputTokens = readNonNegativeInteger(value.prompt_tokens);
  const outputTokens = readNonNegativeInteger(value.completion_tokens);
  const totalTokens = readNonNegativeInteger(value.total_tokens);
  state.usage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function formatSseEvent(
  event: string,
  payload: Record<string, unknown>,
): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function safeUpstreamError(status: number): Response {
  const safeStatus = status === 400
      || status === 401
      || status === 403
      || status === 404
      || status === 408
      || status === 409
      || status === 422
      || status === 429
    ? status
    : status === 502 || status === 503 || status === 504
      ? status
      : 502;
  return Response.json(
    {
      error: {
        code: "HOSTED_CUSTOM_INFERENCE_UPSTREAM_FAILED",
        message:
          "The custom inference endpoint rejected or could not complete the request. Murph did not fall back to managed inference.",
      },
    },
    {
      headers: { "cache-control": "no-store" },
      status: safeStatus,
    },
  );
}

function isEventStream(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase()
    === "text/event-stream";
}

function containsImageInput(value: unknown): boolean {
  const stack: unknown[] = [value];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    visited += 1;
    if (visited > 50_000) throw invalidRequest();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (record.type === "input_image" || "image_url" in record) return true;
    stack.push(...Object.values(record));
  }
  return false;
}

function requireChatRole(value: unknown): "assistant" | "developer" | "system" | "user" {
  if (
    value === "assistant"
    || value === "developer"
    || value === "system"
    || value === "user"
  ) {
    return value;
  }
  throw invalidRequest();
}

function requireToolName(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/u.test(value)
  ) {
    throw unsupportedTool();
  }
  return value;
}

function requireCallId(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)
  ) {
    throw unsupportedTool();
  }
  return value;
}

function requireArguments(value: unknown): string {
  if (typeof value !== "string") throw invalidRequest();
  try {
    JSON.parse(value);
  } catch {
    throw invalidRequest();
  }
  return value;
}

function normalizeToolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    throw invalidRequest();
  }
}

function encodeCustomToolName(value: string): string {
  const encoded = bytesToBase64Url(HOSTED_CUSTOM_INFERENCE_TEXT_ENCODER.encode(value));
  const name = `${HOSTED_CUSTOM_INFERENCE_CUSTOM_TOOL_PREFIX}${encoded}`;
  if (name.length > 64) throw unsupportedTool();
  return name;
}

function decodeCustomToolName(value: string): string | null {
  if (!value.startsWith(HOSTED_CUSTOM_INFERENCE_CUSTOM_TOOL_PREFIX)) {
    return null;
  }
  const encoded = value.slice(HOSTED_CUSTOM_INFERENCE_CUSTOM_TOOL_PREFIX.length);
  const bytes = base64UrlToBytes(encoded);
  if (!bytes) throw invalidResponse();
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return requireToolName(decoded);
}

function encodeNamespaceToolName(input: {
  name: string;
  namespace: string;
}): string {
  const encoded = bytesToBase64Url(
    HOSTED_CUSTOM_INFERENCE_TEXT_ENCODER.encode(
      JSON.stringify([input.namespace, input.name]),
    ),
  );
  const name = `${HOSTED_CUSTOM_INFERENCE_NAMESPACE_TOOL_PREFIX}${encoded}`;
  if (name.length > 64) throw unsupportedTool();
  return name;
}

function decodeNamespaceToolName(
  value: string,
): { name: string; namespace: string } | null {
  if (!value.startsWith(HOSTED_CUSTOM_INFERENCE_NAMESPACE_TOOL_PREFIX)) {
    return null;
  }
  const encoded = value.slice(
    HOSTED_CUSTOM_INFERENCE_NAMESPACE_TOOL_PREFIX.length,
  );
  const bytes = base64UrlToBytes(encoded);
  if (!bytes) throw invalidResponse();
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalidResponse();
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) {
    throw invalidResponse();
  }
  return {
    name: requireToolName(decoded[1]),
    namespace: requireToolName(decoded[0]),
  };
}

function encodeToolCallName(call: ChatToolCallState): string {
  if (call.kind === "custom") return encodeCustomToolName(call.name);
  return call.kind === "namespace" && call.namespace
    ? encodeNamespaceToolName({
        name: call.name,
        namespace: call.namespace,
      })
    : call.name;
}

function safeIdentifier(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 128);
  return safe || "custom";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const remainder = value.length % 4;
  if (remainder === 1) return null;
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${
    remainder === 0 ? "" : "=".repeat(4 - remainder)
  }`;
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function readNonNegativeInteger(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    return 0;
  }
  return value;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidRequest(): HostedCustomInferenceRequestError {
  return new HostedCustomInferenceRequestError(
    "REQUEST_INVALID",
    400,
    "The custom inference request was invalid.",
  );
}

function unsupportedTool(): HostedCustomInferenceRequestError {
  return new HostedCustomInferenceRequestError(
    "TOOL_UNSUPPORTED",
    422,
    "The custom inference endpoint cannot represent a required Murph tool.",
  );
}

function invalidResponse(): HostedCustomInferenceRequestError {
  return new HostedCustomInferenceRequestError(
    "RESPONSE_INVALID",
    502,
    "The custom inference endpoint returned an invalid stream.",
  );
}
