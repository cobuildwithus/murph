// One real model turn per production deploy; per-PR CI and hosted-local E2E
// never enable the flag.
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL = "gpt-5.4-nano";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT = "Reply with exactly: OK";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT = "OK";

export function readDeployLiveModelTurnSmokeOpenAiModel(
  rawBody: string,
): string | null {
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
  return model;
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
