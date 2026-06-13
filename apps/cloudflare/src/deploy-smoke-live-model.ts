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
const DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_INSTRUCTIONS_PREFIX =
  "You are Codex, a coding agent based on GPT-5.";
const DEPLOY_LIVE_MODEL_TURN_SMOKE_MAX_INSTRUCTIONS_CHARS = 128 * 1024;
const DEPLOY_LIVE_MODEL_TURN_SMOKE_MAX_TOOL_TEXT_CHARS = 16 * 1024;
const DEPLOY_LIVE_MODEL_TURN_SMOKE_ALLOWED_TOP_LEVEL_KEYS = new Set([
  "background",
  "client_metadata",
  "include",
  "input",
  "instructions",
  "model",
  "parallel_tool_calls",
  "prompt_cache_key",
  "reasoning",
  "store",
  "stream",
  "text",
  "tool_choice",
  "tools",
]);
const DEPLOY_LIVE_MODEL_TURN_SMOKE_INCLUDE = ["reasoning.encrypted_content"] as const;
const DEPLOY_LIVE_MODEL_TURN_SMOKE_TOOL_IDENTITIES = [
  "custom:apply_patch",
  "function:create_goal",
  "function:exec_command",
  "function:get_goal",
  "function:request_user_input",
  "function:update_goal",
  "function:update_plan",
  "function:view_image",
  "function:write_stdin",
  "tool_search",
  "web_search",
] as const;

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
    !hasOnlyKeys(record, DEPLOY_LIVE_MODEL_TURN_SMOKE_ALLOWED_TOP_LEVEL_KEYS)
    || (record.background !== undefined && record.background !== false)
    || !isEmptyPlainRecord(record.client_metadata)
    || !isExactStringList(record.include, DEPLOY_LIVE_MODEL_TURN_SMOKE_INCLUDE)
    || !isDeployLiveModelTurnSmokeCodexInstructions(record.instructions)
    || record.parallel_tool_calls !== true
    || !isDeployLiveModelTurnSmokePromptCacheKey(record.prompt_cache_key)
    || record.store !== false
    || record.stream !== true
    || record.tool_choice !== "auto"
    || !isDeployLiveModelTurnSmokeInput(record.input)
    || !isDeployLiveModelTurnSmokeToolSurface(record.tools)
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
    const item = record.item;
    if (
      record.type === "item.completed"
      && item
      && typeof item === "object"
      && !Array.isArray(item)
    ) {
      const itemRecord = item as Record<string, unknown>;
      if (itemRecord.type === "agent_message") {
        outputText = readString(itemRecord.text);
      }
    }
  }
  return outputText;
}

function readNestedString(value: unknown, key: string): string | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  return readString(value[key]);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && expected.every((key, index) => keys[index] === key);
}

function isEmptyPlainRecord(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).length === 0;
}

function isExactStringList(
  value: unknown,
  expected: readonly string[],
): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((item, index) => value[index] === item);
}

function isDeployLiveModelTurnSmokeCodexInstructions(value: unknown): boolean {
  return typeof value === "string"
    && value.length <= DEPLOY_LIVE_MODEL_TURN_SMOKE_MAX_INSTRUCTIONS_CHARS
    && value.startsWith(DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_INSTRUCTIONS_PREFIX);
}

function isDeployLiveModelTurnSmokePromptCacheKey(value: unknown): boolean {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function isDeployLiveModelTurnSmokeInput(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 3) {
    return false;
  }
  const [permissions, environment, prompt] = value;
  return readDeployLiveModelTurnSmokeTextMessage(permissions, "developer")
      === DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_PERMISSIONS_TEXT
    && isDeployLiveModelTurnSmokeEnvironmentContext(
      readDeployLiveModelTurnSmokeTextMessage(environment, "user"),
    )
    && readDeployLiveModelTurnSmokeTextMessage(prompt, "user")
      === DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT;
}

function readDeployLiveModelTurnSmokeTextMessage(
  value: unknown,
  role: string,
): string | null {
  if (!isPlainRecord(value) || value.role !== role) {
    return null;
  }
  const { content } = value;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content) || content.length !== 1) {
    return null;
  }
  const [part] = content;
  if (!isPlainRecord(part) || part.type !== "input_text") {
    return null;
  }
  return typeof part.text === "string" ? part.text : null;
}

function isDeployLiveModelTurnSmokeEnvironmentContext(value: string | null): boolean {
  return value !== null
    && /^<environment_context>\n  <cwd>[^<\n]+<\/cwd>\n  <shell>[^<\n]+<\/shell>\n  <current_date>\d{4}-\d{2}-\d{2}<\/current_date>\n  <timezone>[^<\n]+<\/timezone>\n  <filesystem><workspace_roots><root>[^<\n]+<\/root><\/workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" \/><\/permission_profile><\/filesystem>\n<\/environment_context>$/u.test(value);
}

function isDeployLiveModelTurnSmokeToolSurface(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== DEPLOY_LIVE_MODEL_TURN_SMOKE_TOOL_IDENTITIES.length) {
    return false;
  }
  const identities = value
    .map(readDeployLiveModelTurnSmokeToolIdentity)
    .sort();
  return DEPLOY_LIVE_MODEL_TURN_SMOKE_TOOL_IDENTITIES.every((expected, index) =>
    identities[index] === expected
  );
}

function readDeployLiveModelTurnSmokeToolIdentity(value: unknown): string {
  if (!isPlainRecord(value) || typeof value.type !== "string") {
    return "";
  }
  if (
    (value.type === "function" || value.type === "custom")
    && typeof value.name === "string"
    && isDeployLiveModelTurnSmokeToolShape(value)
  ) {
    return `${value.type}:${value.name}`;
  }
  if (
    (value.type === "tool_search" || value.type === "web_search")
    && isDeployLiveModelTurnSmokeToolShape(value)
  ) {
    return value.type;
  }
  return "";
}

function isDeployLiveModelTurnSmokeToolShape(value: Record<string, unknown>): boolean {
  if (value.type === "function") {
    return hasExactKeys(value, ["description", "name", "parameters", "strict", "type"])
      && isDeployLiveModelTurnSmokeToolText(value.description)
      && isPlainRecord(value.parameters)
      && value.strict === false;
  }
  if (value.type === "custom") {
    return hasExactKeys(value, ["description", "format", "name", "type"])
      && value.name === "apply_patch"
      && isDeployLiveModelTurnSmokeToolText(value.description)
      && isPlainRecord(value.format);
  }
  if (value.type === "tool_search") {
    return hasExactKeys(value, ["description", "execution", "parameters", "type"])
      && isDeployLiveModelTurnSmokeToolText(value.description)
      && isPlainRecord(value.execution)
      && isPlainRecord(value.parameters);
  }
  if (value.type === "web_search") {
    return hasExactKeys(value, ["external_web_access", "search_content_types", "type"])
      && value.external_web_access === true
      && isExactStringList(value.search_content_types, ["webpage"]);
  }
  return false;
}

function isDeployLiveModelTurnSmokeToolText(value: unknown): boolean {
  return typeof value === "string"
    && value.length > 0
    && value.length <= DEPLOY_LIVE_MODEL_TURN_SMOKE_MAX_TOOL_TEXT_CHARS;
}
