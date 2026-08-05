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
}): string | null {
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
  const providerRecord = normalizeHostedVeniceResponsesLiteTools(record);
  if (!providerRecord) {
    return null;
  }

  return JSON.stringify({
    ...providerRecord,
    model: `${upstreamModel}:${HOSTED_VENICE_REQUIRED_MODEL_SUFFIX}`,
  });
}

function normalizeHostedVeniceResponsesLiteTools(
  record: Record<string, unknown>,
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

  return {
    ...record,
    input: providerInput,
    tools: responsesLiteTools,
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
