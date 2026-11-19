import { HOSTED_ASSISTANT_PRODUCT_MODELS, HOSTED_FLEX_MODELS } from "@murphai/hosted-execution/assistant-model";

// The omitted Responses service_tier is the standard foreground request.
export const DEPLOY_ADMISSION_TIERS = ["default", "flex", "priority"] as const;
export type DeployAdmissionTier = (typeof DEPLOY_ADMISSION_TIERS)[number];
export function isDeployAdmissionTier(value: unknown): value is DeployAdmissionTier {
  return DEPLOY_ADMISSION_TIERS.some(tier => tier === value);
}
export const DEPLOY_MODEL_ADMISSION_PROBES = [
  ...HOSTED_ASSISTANT_PRODUCT_MODELS.flatMap(model =>
    (["default", "priority"] as const).map(serviceTier => ({ model, serviceTier })),
  ),
  ...HOSTED_FLEX_MODELS.map(model => ({ model, serviceTier: "flex" as const })),
];

export function deployAdmissionProbes(reuse: boolean) {
  return reuse ? [{ model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL, serviceTier: "default" as const }] : DEPLOY_MODEL_ADMISSION_PROBES;
}

export function isDeployAdmissionModel(model: unknown, tier: DeployAdmissionTier): model is string {
  return DEPLOY_MODEL_ADMISSION_PROBES.some(probe => probe.model === model && probe.serviceTier === tier);
}

// The serving smoke retains its single, inexpensive Luna turn.
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL = "gpt-6-luna";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_PROMPT = "Reply with exactly: OK";
export const DEPLOY_LIVE_MODEL_TURN_SMOKE_EXPECTED_OUTPUT = "OK";

export function readDeployLiveModelTurnSmokeRequest(
  rawBody: string,
): { model: string; serviceTier: DeployAdmissionTier; web: boolean; image: boolean } | null {
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
  const serviceTier = record.service_tier === undefined ? "default" : record.service_tier;
  if (!isDeployAdmissionTier(serviceTier) || !isDeployAdmissionModel(model, serviceTier)) return null;

  // A successful request with web disabled cannot prove reserved-tool admission.
  // Mixed Code Mode can send namespaces in an additional_tools input item.
  const tools = [
    ...(Array.isArray(record.tools) ? record.tools : []),
    ...(Array.isArray(record.input) ? record.input.flatMap(item =>
      isPlainRecord(item) && item.type === "additional_tools" && Array.isArray(item.tools) ? item.tools : [],
    ) : []),
  ];
  const web = tools.some(tool => isPlainRecord(tool) && tool.type === "namespace" && tool.name === "web"
    && Array.isArray(tool.tools) && tool.tools.some(child =>
      isPlainRecord(child) && child.type === "function" && child.name === "run" && isPlainRecord(child.parameters),
    ));
  if (!web && model !== DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL) return null;
  const image = Array.isArray(record.input) && record.input.some(item =>
    isPlainRecord(item) && item.role === "user" && Array.isArray(item.content) && item.content.some(part =>
      isPlainRecord(part) && part.type === "input_image" && typeof part.image_url === "string"
      && part.image_url.startsWith("data:image/"),
    ));
  return { model, serviceTier, web, image };
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
