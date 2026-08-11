export const DEFAULT_XAI_API_BASE_URL = "https://api.x.ai";
// The engine-built request is a fixed-shape developer prompt plus filter
// arguments, so a well-formed body stays far below this cap.
export const HOSTED_XAI_MAX_BODY_BYTES = 32 * 1024;
// The billing basis (usage.cost_in_usd_ticks) lives in the response body, so
// the interceptor buffers completed responses. Bounded output
// (max_output_tokens) keeps real payloads far below this cap.
export const HOSTED_XAI_MAX_RESPONSE_BODY_BYTES = 1024 * 1024;

const HOSTED_XAI_ALLOWED_REQUEST_KEYS = new Set([
  "input",
  "max_output_tokens",
  "model",
  "store",
  "tools",
]);
const HOSTED_XAI_ALLOWED_X_SEARCH_TOOL_KEYS = new Set([
  "allowed_x_handles",
  "enable_image_understanding",
  "enable_video_understanding",
  "excluded_x_handles",
  "from_date",
  "to_date",
  "type",
]);
const HOSTED_XAI_MAX_TOOL_HANDLES = 20;
const HOSTED_XAI_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface HostedXaiRequestBody {
  model: string;
}

// Structural gate for the fixed-shape x_search Responses request the
// assistant engine builds. It pins the tool surface (exactly one x_search
// entry with only the documented filters and media-understanding flags) and
// store: false, and reads the requested model for usage recording. Prompt text
// is deliberately not re-validated here.
export function parseHostedXaiRequestBody(input: {
  body: ArrayBuffer;
  contentType: string | null;
}): HostedXaiRequestBody | null {
  if (!isJsonContentType(input.contentType)) {
    return null;
  }

  const record = parseJsonRecord(input.body);
  if (!record) {
    return null;
  }
  if (!Object.keys(record).every((key) => HOSTED_XAI_ALLOWED_REQUEST_KEYS.has(key))) {
    return null;
  }

  const model = typeof record.model === "string" ? record.model.trim() : "";
  if (!model) {
    return null;
  }
  if (!hasHostedXaiInput(record.input)) {
    return null;
  }
  if (record.store !== false) {
    return null;
  }
  if (
    record.max_output_tokens !== undefined
    && !isPositiveSafeInteger(record.max_output_tokens)
  ) {
    return null;
  }
  if (
    !Array.isArray(record.tools)
    || record.tools.length !== 1
    || !isAllowedXaiSearchToolEntry(record.tools[0])
  ) {
    return null;
  }

  return { model };
}

// Reads the provider request id and usage object from a buffered completed
// response. Fail-open: a malformed body yields nulls and the usage record is
// still posted with whatever is present (the call was billed either way).
export function readHostedXaiResponseMetadata(body: ArrayBuffer): {
  providerRequestId: string | null;
  usage: Record<string, unknown> | null;
} {
  const record = parseJsonRecord(body);
  const id = typeof record?.id === "string" && record.id.trim().length > 0
    ? record.id.trim()
    : null;
  const usage = record?.usage;
  return {
    providerRequestId: id,
    usage: usage && typeof usage === "object" && !Array.isArray(usage)
      ? usage as Record<string, unknown>
      : null,
  };
}

function isAllowedXaiSearchToolEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const record = entry as Record<string, unknown>;
  if (record.type !== "x_search") {
    return false;
  }
  if (!Object.keys(record).every((key) => HOSTED_XAI_ALLOWED_X_SEARCH_TOOL_KEYS.has(key))) {
    return false;
  }
  if (
    !isOptionalXaiHandleList(record.allowed_x_handles)
    || !isOptionalXaiHandleList(record.excluded_x_handles)
    || !isOptionalBoolean(record.enable_image_understanding)
    || !isOptionalBoolean(record.enable_video_understanding)
  ) {
    return false;
  }
  return isOptionalXaiDate(record.from_date) && isOptionalXaiDate(record.to_date);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalXaiHandleList(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  return Array.isArray(value)
    && value.length <= HOSTED_XAI_MAX_TOOL_HANDLES
    && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function isOptionalXaiDate(value: unknown): boolean {
  return value === undefined
    || (typeof value === "string" && HOSTED_XAI_DATE_PATTERN.test(value));
}

function hasHostedXaiInput(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return Array.isArray(value) && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseJsonRecord(body: ArrayBuffer): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";")[0]?.trim().toLowerCase() === "application/json";
}
