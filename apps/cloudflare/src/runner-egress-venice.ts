import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  isHostedAssistantProductModel,
  type HostedAssistantProductModel,
} from "@murphai/hosted-execution/assistant-model";

export const DEFAULT_VENICE_API_BASE_URL = "https://api.venice.ai/api/v1";
// Venice requests are buffered once for product-model validation and upstream
// model rewriting. Keep the ceiling below the Worker memory budget while still
// allowing ordinary multimodal Murph turns.
export const HOSTED_VENICE_RESPONSES_MAX_BODY_BYTES = 20 * 1024 * 1024;

const HOSTED_VENICE_MODEL_ENV_BY_PRODUCT_MODEL = {
  [HOSTED_ASSISTANT_LUNA_MODEL]: "HOSTED_VENICE_LUNA_MODEL",
  [HOSTED_ASSISTANT_TERRA_MODEL]: "HOSTED_VENICE_TERRA_MODEL",
  [HOSTED_ASSISTANT_SOL_MODEL]: "HOSTED_VENICE_SOL_MODEL",
} as const satisfies Record<HostedAssistantProductModel, string>;

const HOSTED_VENICE_MODEL_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
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
  env: Readonly<Record<string, unknown>>;
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
  const upstreamModel = readHostedVeniceModel({
    env: input.env,
    productModel: record.model,
  });

  return JSON.stringify({
    ...record,
    model: `${upstreamModel}:${HOSTED_VENICE_REQUIRED_MODEL_SUFFIX}`,
  });
}

function readHostedVeniceModel(input: {
  env: Readonly<Record<string, unknown>>;
  productModel: HostedAssistantProductModel;
}): string {
  const envName = HOSTED_VENICE_MODEL_ENV_BY_PRODUCT_MODEL[input.productModel];
  const value = input.env[envName];
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!HOSTED_VENICE_MODEL_ID_PATTERN.test(normalized)) {
    throw new Error(
      `${envName} must name one fixed Venice model before Venice inference is enabled.`,
    );
  }
  return normalized;
}
