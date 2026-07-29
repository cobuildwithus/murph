import {
  assistantPersonaIdSchema,
  assistantPersonalityScoreSchema,
  assistantPersonalitySettingIds,
  assistantTonePreferenceSchema,
  assistantVoiceOptionIdSchema,
  type AssistantPersonaId,
  type AssistantPersonalitySettingId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";

export const HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION = 1;
export const HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES = 4 * 1_024;

export interface HostedRuntimePendingGroupSetupStyle {
  persona?: AssistantPersonaId;
  personality?: Partial<Record<AssistantPersonalitySettingId, number | null>>;
  tone?: AssistantTonePreference;
  voice?: AssistantVoiceOptionId;
}

export interface HostedRuntimePendingGroupSetupInput {
  roomContextMarkdown?: string;
  style?: HostedRuntimePendingGroupSetupStyle;
}

export interface HostedRuntimePendingGroupSetupSnapshot
  extends HostedRuntimePendingGroupSetupInput {
  armedAt: string;
  expiresAt: string;
}

export function parseHostedRuntimePendingGroupSetupInput(
  value: unknown,
): HostedRuntimePendingGroupSetupInput {
  const record = requireStrictObject(value, "Pending group setup");
  assertOnlyKeys(record, ["roomContextMarkdown", "style"]);
  const roomContextMarkdown = Object.hasOwn(record, "roomContextMarkdown")
    ? parseRoomContext(record.roomContextMarkdown)
    : undefined;
  const style = Object.hasOwn(record, "style")
    ? parseStyle(record.style)
    : undefined;
  if (roomContextMarkdown === undefined && style === undefined) {
    throw new TypeError("Pending group setup requires style or room context.");
  }
  return {
    ...(roomContextMarkdown === undefined ? {} : { roomContextMarkdown }),
    ...(style === undefined ? {} : { style }),
  };
}

export function parseHostedRuntimePendingGroupSetupSnapshot(
  value: unknown,
): HostedRuntimePendingGroupSetupSnapshot {
  const record = requireStrictObject(value, "Pending group setup snapshot");
  assertOnlyKeys(record, ["armedAt", "expiresAt", "roomContextMarkdown", "style"]);
  const input = parseHostedRuntimePendingGroupSetupInput({
    ...(Object.hasOwn(record, "roomContextMarkdown")
      ? { roomContextMarkdown: record.roomContextMarkdown }
      : {}),
    ...(Object.hasOwn(record, "style") ? { style: record.style } : {}),
  });
  return {
    armedAt: parseCanonicalTimestamp(record.armedAt, "Pending group setup armedAt"),
    expiresAt: parseCanonicalTimestamp(
      record.expiresAt,
      "Pending group setup expiresAt",
    ),
    ...input,
  };
}

function parseStyle(value: unknown): HostedRuntimePendingGroupSetupStyle {
  const record = requireStrictObject(value, "Pending group setup style");
  assertOnlyKeys(record, ["persona", "personality", "tone", "voice"]);
  const style: HostedRuntimePendingGroupSetupStyle = {};
  if (Object.hasOwn(record, "persona")) {
    style.persona = parseContractValue(
      assistantPersonaIdSchema,
      record.persona,
      "Pending group setup persona is invalid.",
    );
  }
  if (Object.hasOwn(record, "tone")) {
    style.tone = parseContractValue(
      assistantTonePreferenceSchema,
      record.tone,
      "Pending group setup tone is invalid.",
    );
  }
  if (Object.hasOwn(record, "voice")) {
    style.voice = parseContractValue(
      assistantVoiceOptionIdSchema,
      record.voice,
      "Pending group setup voice is invalid.",
    );
  }
  if (Object.hasOwn(record, "personality")) {
    const personalityRecord = requireStrictObject(
      record.personality,
      "Pending group setup personality",
    );
    assertOnlyKeys(personalityRecord, assistantPersonalitySettingIds);
    if (Object.keys(personalityRecord).length === 0) {
      throw new TypeError(
        "Pending group setup personality requires at least one setting.",
      );
    }
    const personality: HostedRuntimePendingGroupSetupStyle["personality"] = {};
    for (const setting of assistantPersonalitySettingIds) {
      if (!Object.hasOwn(personalityRecord, setting)) {
        continue;
      }
      const settingValue = personalityRecord[setting];
      personality[setting] = settingValue === null
        ? null
        : parseContractValue(
            assistantPersonalityScoreSchema,
            settingValue,
            `Pending group setup ${setting} is invalid.`,
          );
    }
    style.personality = personality;
  }
  if (Object.keys(style).length === 0) {
    throw new TypeError("Pending group setup style requires at least one setting.");
  }
  return style;
}

function parseRoomContext(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Pending group setup room context must be text.");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("Pending group setup room context must not be empty.");
  }
  if (
    new TextEncoder().encode(normalized).byteLength
      > HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES
  ) {
    throw new TypeError("Pending group setup room context is too large.");
  }
  return normalized;
}

function parseCanonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a timestamp.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function parseContractValue<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(message);
  }
  return parsed.data;
}

function requireStrictObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) {
    throw new TypeError(`Pending group setup field ${unknown} is not supported.`);
  }
}
