// One cheap real model turn per production deploy; per-PR CI and
// hosted-local E2E never enable the flag.
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL = "gpt-5.4-nano";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT = "Reply with exactly: OK";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT = "OK";

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
    || record.store !== false
    || record.stream !== true
    || readDeployLiveModelTurnSmokePrompt(record.input) !== DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT
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

function readDeployLiveModelTurnSmokePrompt(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const last = value[value.length - 1];
  if (!isPlainRecord(last) || last.role !== "user") {
    return null;
  }
  const { content } = last;
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
