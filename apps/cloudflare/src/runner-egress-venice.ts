import {
  HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS,
  isHostedAssistantProductModel,
} from "@murphai/hosted-execution/assistant-model";

export const DEFAULT_VENICE_API_BASE_URL = "https://api.venice.ai/api/v1";
// Venice requests are buffered once for product-model validation and the final
// provider-compatibility rewrite. Keep the ceiling below the Worker memory
// budget while still allowing ordinary multimodal Murph turns.
export const HOSTED_VENICE_RESPONSES_MAX_BODY_BYTES = 20 * 1024 * 1024;

const HOSTED_VENICE_REQUIRED_MODEL_SUFFIX = [
  "include_venice_system_prompt=false",
  "enable_web_search=off",
  "enable_web_scraping=false",
].join("&");

export function isAllowedHostedVeniceRequest(
  method: string,
  pathnameSuffix: string,
): boolean {
  return method.toUpperCase() === "POST"
    && (
      pathnameSuffix === "/responses"
      || pathnameSuffix === "/responses/compact"
    );
}

export function buildHostedVeniceResponsesRequestBody(input: {
  body: ArrayBuffer;
  pathnameSuffix: string;
}): string | null {
  if (
    input.pathnameSuffix !== "/responses"
    && input.pathnameSuffix !== "/responses/compact"
  ) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(input.body));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  // Keep Luna/Terra/Sol canonical everywhere inside Murph. Only the provider
  // boundary translates the selected product model into a Venice model id.
  if (!isHostedAssistantProductModel(record.model)) {
    return null;
  }
  const upstreamModel = HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS[record.model];
  const providerRecord = adaptHostedVeniceResponsesLiteRequest(
    record,
    input.pathnameSuffix,
  );
  if (!providerRecord) {
    return null;
  }

  return JSON.stringify({
    ...providerRecord,
    model: `${upstreamModel}:${HOSTED_VENICE_REQUIRED_MODEL_SUFFIX}`,
  });
}

function addHostedVenicePromptCacheBreakpoint(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(record.input) || hasPromptCacheBreakpoint(record.input)) {
    return record;
  }

  // Codex supplies a stable cache key but currently leaves GPT-5.6's cache
  // boundary implicit. Mark only the final cacheable block in its contiguous
  // leading developer prefix, before conversation and tool-result content.
  let messageIndex = -1;
  let contentIndex = -1;
  for (let inputIndex = 0; inputIndex < record.input.length; inputIndex += 1) {
    const item = record.input[inputIndex];
    if (
      !isJsonObject(item)
      || item.type !== "message"
      || item.role !== "developer"
    ) {
      break;
    }
    if (!Array.isArray(item.content)) {
      continue;
    }
    for (
      let itemContentIndex = 0;
      itemContentIndex < item.content.length;
      itemContentIndex += 1
    ) {
      const content = item.content[itemContentIndex];
      if (
        isJsonObject(content)
        && (
          content.type === "input_text"
          || content.type === "input_image"
          || content.type === "input_file"
        )
      ) {
        messageIndex = inputIndex;
        contentIndex = itemContentIndex;
      }
    }
  }

  if (messageIndex < 0 || contentIndex < 0) {
    return record;
  }

  const message = record.input[messageIndex];
  if (!isJsonObject(message) || !Array.isArray(message.content)) {
    return record;
  }
  const content = message.content[contentIndex];
  if (!isJsonObject(content)) {
    return record;
  }

  const providerInput = [...record.input];
  const providerContent = [...message.content];
  providerContent[contentIndex] = {
    ...content,
    prompt_cache_breakpoint: { mode: "explicit" },
  };
  providerInput[messageIndex] = {
    ...message,
    content: providerContent,
  };
  return {
    ...record,
    input: providerInput,
  };
}

function hasPromptCacheBreakpoint(input: unknown[]): boolean {
  return input.some((item) =>
    isJsonObject(item)
    && Array.isArray(item.content)
    && item.content.some((content) =>
      isJsonObject(content) && content.prompt_cache_breakpoint !== undefined
    )
  );
}

function adaptHostedVeniceResponsesLiteRequest(
  record: Record<string, unknown>,
  pathnameSuffix: string,
): Record<string, unknown> | null {
  if (!Array.isArray(record.input)) {
    return record;
  }

  let responsesLiteTools: unknown[] | undefined;
  const providerInput: unknown[] = [];
  for (const item of record.input) {
    if (!isJsonObject(item) || item.type !== "additional_tools") {
      providerInput.push(item);
      continue;
    }

    // Codex Responses Lite relocates request-wide tool definitions into one
    // developer input item. Venice accepts those definitions at top level but
    // rejects the extension item, so invert only the exact lossless shape.
    if (
      responsesLiteTools
      || item.role !== "developer"
      || (item.id !== undefined && item.id !== null)
      || !Array.isArray(item.tools)
      || item.tools.some((tool) =>
        !isJsonObject(tool) || typeof tool.type !== "string"
      )
      || Object.keys(item).some((key) =>
        key !== "id"
        && key !== "role"
        && key !== "tools"
        && key !== "type"
      )
    ) {
      return null;
    }
    responsesLiteTools = item.tools;
  }

  if (!responsesLiteTools) {
    return record;
  }
  if (record.tools !== undefined && record.tools !== null) {
    return null;
  }

  const providerRecord = {
    ...record,
    input: providerInput,
    tools: responsesLiteTools,
  };
  return pathnameSuffix === "/responses"
    ? addHostedVenicePromptCacheBreakpoint(providerRecord)
    : providerRecord;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
