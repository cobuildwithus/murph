// One cheap real model turn per production deploy; per-PR CI and
// hosted-local E2E never enable the flag.
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL = "gpt-5.4-nano";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT = "Reply with exactly: OK";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT = "OK";

const DEPLOY_LIVE_MODEL_TURN_SMOKE_REQUEST_KEYS = [
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
] as const;
const DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_INSTRUCTIONS_PREFIX =
  "You are Codex, a coding agent based on GPT-5.";
const DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_INSTRUCTIONS_SUFFIX =
  "- Tone of your updates MUST match your personality.";
const DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_PERMISSIONS_TEXT =
  "<permissions instructions>\n"
  + "Filesystem sandboxing defines which files can be read or written. `sandbox_mode` is `danger-full-access`: No filesystem sandboxing - all commands are permitted. Network access is enabled.\n"
  + "Approval policy is currently never. Do not provide the `sandbox_permissions` for any reason, commands will be rejected.\n"
  + "</permissions instructions>";
const DEPLOY_LIVE_MODEL_TURN_SMOKE_TOOL_SIGNATURES = [
  { type: "function", name: "exec_command" },
  { type: "function", name: "write_stdin" },
  { type: "function", name: "update_plan" },
  { type: "function", name: "request_user_input" },
  { type: "custom", name: "apply_patch" },
  { type: "function", name: "view_image" },
  { type: "function", name: "get_goal" },
  { type: "function", name: "create_goal" },
  { type: "function", name: "update_goal" },
  { type: "tool_search" },
  { type: "web_search" },
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
    !hasExactKeys(record, DEPLOY_LIVE_MODEL_TURN_SMOKE_REQUEST_KEYS)
    || !isDeployLiveModelTurnSmokeCodexInstructions(record.instructions)
    || !isPlainRecord(record.client_metadata)
    || readNonEmptyString(record.prompt_cache_key) === null
    || !isExactStringArray(record.include, ["reasoning.encrypted_content"])
    || record.parallel_tool_calls !== true
    || record.tool_choice !== "auto"
    || record.store !== false
    || record.stream !== true
    || !isDeployLiveModelTurnSmokeInput(record.input)
    || !isDeployLiveModelTurnSmokeTools(record.tools)
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

function isDeployLiveModelTurnSmokeCodexInstructions(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return value.startsWith(DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_INSTRUCTIONS_PREFIX)
    && value.trimEnd().endsWith(DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_INSTRUCTIONS_SUFFIX)
    && value.length <= 64 * 1024;
}

function isDeployLiveModelTurnSmokeInput(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 3) {
    return false;
  }
  const [permissions, environment, prompt] = value;
  return readExactDeployLiveModelTurnSmokeTextMessage(permissions, "developer")
      === DEPLOY_LIVE_MODEL_TURN_SMOKE_CODEX_PERMISSIONS_TEXT
    && isDeployLiveModelTurnSmokeEnvironmentContext(
      readExactDeployLiveModelTurnSmokeTextMessage(environment, "user"),
    )
    && readExactDeployLiveModelTurnSmokeTextMessage(prompt, "user")
      === DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT;
}

function readExactDeployLiveModelTurnSmokeTextMessage(
  value: unknown,
  role: string,
): string | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["content", "role", "type"])) {
    return null;
  }
  if (value.type !== "message" || value.role !== role) {
    return null;
  }
  const { content } = value;
  if (!Array.isArray(content) || content.length !== 1) {
    return null;
  }
  const [part] = content;
  if (!isPlainRecord(part) || !hasExactKeys(part, ["text", "type"])) {
    return null;
  }
  return part.type === "input_text" ? readExactString(part.text) : null;
}

function isDeployLiveModelTurnSmokeEnvironmentContext(value: string | null): boolean {
  return value !== null
    && /^<environment_context>\n  <cwd>[^<\n]+<\/cwd>\n  <shell>[^<\n]+<\/shell>\n  <current_date>\d{4}-\d{2}-\d{2}<\/current_date>\n  <timezone>[^<\n]+<\/timezone>\n  <filesystem><workspace_roots><root>[^<\n]+<\/root><\/workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" \/><\/permission_profile><\/filesystem>\n<\/environment_context>$/u.test(value);
}

function isDeployLiveModelTurnSmokeTools(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== DEPLOY_LIVE_MODEL_TURN_SMOKE_TOOL_SIGNATURES.length) {
    return false;
  }
  return value.every((tool, index) => {
    if (!isPlainRecord(tool)) {
      return false;
    }
    const expected = DEPLOY_LIVE_MODEL_TURN_SMOKE_TOOL_SIGNATURES[index];
    if (tool.type !== expected.type) {
      return false;
    }
    if ("name" in expected && tool.name !== expected.name) {
      return false;
    }
    if (expected.type === "function") {
      return hasExactKeys(tool, ["description", "name", "parameters", "strict", "type"]);
    }
    if (expected.type === "custom") {
      return hasExactKeys(tool, ["description", "format", "name", "type"]);
    }
    if (expected.type === "tool_search") {
      return hasExactKeys(tool, ["description", "execution", "parameters", "type"]);
    }
    return hasExactKeys(tool, ["external_web_access", "search_content_types", "type"]);
  });
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

function readExactString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  const stringValue = readString(value);
  return stringValue === "" ? null : stringValue;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && expectedKeys.every((key, index) => keys[index] === key);
}

function isExactStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((item, index) => value[index] === item);
}
