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

function readDeployLiveModelTurnSmokePrompt(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const last = value[value.length - 1];
  if (!last || typeof last !== "object" || Array.isArray(last)) {
    return null;
  }
  const record = last as Record<string, unknown>;
  if (record.role !== "user") {
    return null;
  }
  const { content } = record;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content) || content.length !== 1) {
    return null;
  }
  const only = content[0];
  if (!only || typeof only !== "object" || Array.isArray(only)) {
    return null;
  }
  const part = only as Record<string, unknown>;
  return part.type === "input_text" ? readString(part.text) : null;
}

function readNestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return readString((value as Record<string, unknown>)[key]);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}
