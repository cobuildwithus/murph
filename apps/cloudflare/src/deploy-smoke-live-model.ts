// One cheap real model turn per production deploy; per-PR CI and
// hosted-local E2E never enable the flag.
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL = "gpt-5.4-nano";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT = "Reply with exactly: OK";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT = "OK";

const DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_PERMISSIONS_TEXT =
  "<permissions instructions>\n"
  + "Filesystem sandboxing defines which files can be read or written. `sandbox_mode` is `danger-full-access`: No filesystem sandboxing - all commands are permitted. Network access is enabled.\n"
  + "Approval policy is currently never. Do not provide the `sandbox_permissions` for any reason, commands will be rejected.\n"
  + "</permissions instructions>";
const DEPLOY_LIVE_MODEL_TURN_SMOKE_ENVIRONMENT_CONTEXT_PREFIX =
  "<environment_context>";
const DEPLOY_LIVE_MODEL_TURN_SMOKE_ENVIRONMENT_CONTEXT_SUFFIX =
  "</environment_context>";
const DEPLOY_LIVE_MODEL_TURN_SMOKE_MAX_OUTPUT_TOKENS = 64;

export interface DeployLiveModelTurnSmokeOpenAiRequest {
  model: string;
}

export function readDeployLiveModelTurnSmokeOpenAiRequest(
  rawBody: string,
): DeployLiveModelTurnSmokeOpenAiRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const model = readString(record.model);
  if (model !== DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL) {
    return null;
  }
  if (
    (record.background !== undefined && record.background !== false)
    || !isDeployLiveModelTurnSmokeMaxOutputTokens(record.max_output_tokens)
    || record.previous_response_id !== undefined
    || record.store !== false
    || record.stream !== true
    || !isDeployLiveModelTurnSmokeInput(record.input)
    || readNestedString(record.reasoning, "effort") !== "low"
    || readNestedString(record.text, "verbosity") !== "low"
  ) {
    return null;
  }
  return { model };
}

export function readDeployLiveModelTurnSmokeCodexOutputText(stdout: string): string | null {
  let outputText: string | null = null;
  for (const line of stdout.split(/\r?\n/gu)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const assistantText = readDeployLiveModelTurnSmokeCompletedAssistantText(record);
    if (assistantText !== null) {
      outputText = assistantText;
    }
  }
  return outputText;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readNestedString(value: unknown, key: string): string | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  return readString(value[key]);
}

function isDeployLiveModelTurnSmokeMaxOutputTokens(value: unknown): boolean {
  return value === undefined
    || (
      typeof value === "number"
      && Number.isInteger(value)
      && value > 0
      && value <= DEPLOY_LIVE_MODEL_TURN_SMOKE_MAX_OUTPUT_TOKENS
    );
}

function isDeployLiveModelTurnSmokeInput(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  const messages = value.map(readDeployLiveModelTurnSmokeMessage);
  if (messages.some((message) => message === null)) {
    return false;
  }
  const promptMessage = messages.at(-1);
  if (
    !promptMessage
    || promptMessage.role !== "user"
    || promptMessage.text !== DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT
  ) {
    return false;
  }
  return messages.slice(0, -1).every((message) =>
    message !== null && isDeployLiveModelTurnSmokeContextMessage(message)
  );
}

function isDeployLiveModelTurnSmokeContextMessage(input: {
  role: string;
  text: string;
}): boolean {
  if (input.role === "developer") {
    return input.text === DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_PERMISSIONS_TEXT;
  }
  if (input.role === "user") {
    return isDeployLiveModelTurnSmokeEnvironmentContext(input.text);
  }
  return false;
}

function readDeployLiveModelTurnSmokeMessage(
  value: unknown,
): { role: string; text: string } | null {
  if (!isPlainRecord(value) || typeof value.role !== "string") {
    return null;
  }
  const { content } = value;
  if (typeof content === "string") {
    return { role: value.role, text: content };
  }
  if (!Array.isArray(content) || content.length !== 1) {
    return null;
  }
  const [part] = content;
  if (!isPlainRecord(part) || part.type !== "input_text") {
    return null;
  }
  return typeof part.text === "string"
    ? { role: value.role, text: part.text }
    : null;
}

function isDeployLiveModelTurnSmokeEnvironmentContext(value: string): boolean {
  return value.startsWith(DEPLOY_LIVE_MODEL_TURN_SMOKE_ENVIRONMENT_CONTEXT_PREFIX)
    && value.endsWith(DEPLOY_LIVE_MODEL_TURN_SMOKE_ENVIRONMENT_CONTEXT_SUFFIX);
}

function readDeployLiveModelTurnSmokeCompletedAssistantText(
  record: Record<string, unknown>,
): string | null {
  if (normalizeDeployLiveModelTurnSmokeIdentifier(
    readString(record.type) ?? readString(record.method) ?? readString(record.event),
  ) !== "item.completed") {
    return null;
  }
  const item = readDeployLiveModelTurnSmokeCodexItem(record);
  if (!item) {
    return null;
  }
  const itemType = normalizeDeployLiveModelTurnSmokeIdentifier(readString(item.type));
  if (itemType !== "agent.message" && itemType !== "assistant.message") {
    return null;
  }
  return readDeployLiveModelTurnSmokeAssistantItemText(item);
}

function readDeployLiveModelTurnSmokeCodexItem(
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  if (isPlainRecord(record.item)) {
    return record.item;
  }
  if (isPlainRecord(record.params) && isPlainRecord(record.params.item)) {
    return record.params.item;
  }
  if (isPlainRecord(record.data) && isPlainRecord(record.data.item)) {
    return record.data.item;
  }
  return null;
}

function readDeployLiveModelTurnSmokeAssistantItemText(
  item: Record<string, unknown>,
): string | null {
  const directText = readString(item.text) ?? readString(item.message);
  if (directText !== null) {
    return directText;
  }
  if (typeof item.content === "string") {
    return item.content.trim();
  }
  if (!Array.isArray(item.content)) {
    return null;
  }
  const text = item.content
    .map((part) => isPlainRecord(part)
      ? readString(part.text) ?? readString(part.output_text) ?? ""
      : "")
    .join("");
  return text.trim() || null;
}

function normalizeDeployLiveModelTurnSmokeIdentifier(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1.$2")
    .replace(/[^A-Za-z0-9]+/gu, ".")
    .replace(/\.+/gu, ".")
    .replace(/^\.|\.$/gu, "")
    .toLowerCase();
  return normalized || null;
}
