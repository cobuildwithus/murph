import {
  assistantPersonaIdSchema,
  assistantPersonalityScoreSchema,
  assistantTonePreferenceSchema,
  assistantVoiceOptionIdSchema,
} from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";

export const HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION = 1;
export const HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES =
  2 * 1_024;
export const HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_CODE_POINTS =
  Math.floor(HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES / 4);
export const HOSTED_EXECUTION_INITIAL_GROUP_ROOM_MODEL_MAX_BYTES = 3 * 1_024;

const hostedRuntimePendingGroupSetupRoomContextSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength
        <= HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES,
    { message: "room context exceeds the UTF-8 byte limit" },
  )
  .refine(
    (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value),
    { message: "room context contains unsupported control characters" },
  )
  .refine(
    (value) => !containsHostedRuntimeRawParticipantHandle(value),
    { message: "room context must not contain raw participant handles" },
  );

export const hostedExecutionInitialGroupRoomModelMarkdownSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength
        <= HOSTED_EXECUTION_INITIAL_GROUP_ROOM_MODEL_MAX_BYTES,
    { message: "initial group room model exceeds the UTF-8 byte limit" },
  )
  .refine(
    (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value),
    { message: "initial group room model contains unsupported control characters" },
  )
  .refine(
    (value) => !containsHostedRuntimeRawParticipantHandle(value),
    { message: "initial group room model must not contain raw participant handles" },
  );

const hostedRuntimePendingGroupSetupPersonalitySchema = z
  .object({
    detail: assistantPersonalityScoreSchema.nullable().optional(),
    humor: assistantPersonalityScoreSchema.nullable().optional(),
    push: assistantPersonalityScoreSchema.nullable().optional(),
    unhinged: assistantPersonalityScoreSchema.nullable().optional(),
  })
  .strict()
  .superRefine((personality, context) => {
    if (Object.keys(personality).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "personality requires at least one setting",
      });
    }
  });

export const hostedRuntimePendingGroupSetupStyleSchema = z
  .object({
    persona: assistantPersonaIdSchema.optional(),
    personality: hostedRuntimePendingGroupSetupPersonalitySchema.optional(),
    tone: assistantTonePreferenceSchema.optional(),
    voice: assistantVoiceOptionIdSchema.optional(),
  })
  .strict()
  .superRefine((style, context) => {
    if (Object.keys(style).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "style requires at least one setting",
      });
    }
  });

/**
 * An empty setup is intentional: preparing canonical ownership must remain
 * useful when the member does not request any room-specific personalization.
 */
export const hostedRuntimePendingGroupSetupInputSchema = z
  .object({
    roomContextMarkdown:
      hostedRuntimePendingGroupSetupRoomContextSchema.optional(),
    style: hostedRuntimePendingGroupSetupStyleSchema.optional(),
  })
  .strict();

const canonicalTimestampSchema = z.string().superRefine((value, context) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "timestamp must be canonical ISO-8601",
    });
  }
});

export const hostedRuntimePendingGroupSetupSnapshotSchema =
  hostedRuntimePendingGroupSetupInputSchema.extend({
    armedAt: canonicalTimestampSchema,
    expiresAt: canonicalTimestampSchema,
  });

export type HostedRuntimePendingGroupSetupStyle = z.infer<
  typeof hostedRuntimePendingGroupSetupStyleSchema
>;
export type HostedRuntimePendingGroupSetupInput = z.infer<
  typeof hostedRuntimePendingGroupSetupInputSchema
>;
export type HostedRuntimePendingGroupSetupSnapshot = z.infer<
  typeof hostedRuntimePendingGroupSetupSnapshotSchema
>;

export function parseHostedRuntimePendingGroupSetupInput(
  value: unknown,
): HostedRuntimePendingGroupSetupInput {
  return hostedRuntimePendingGroupSetupInputSchema.parse(value);
}

export function parseHostedRuntimePendingGroupSetupSnapshot(
  value: unknown,
): HostedRuntimePendingGroupSetupSnapshot {
  return hostedRuntimePendingGroupSetupSnapshotSchema.parse(value);
}

export function parseHostedExecutionInitialGroupRoomModelMarkdown(
  value: unknown,
): string {
  return hostedExecutionInitialGroupRoomModelMarkdownSchema.parse(value);
}

export function containsHostedRuntimeRawParticipantHandle(
  value: string,
): boolean {
  return (
    /(?:^|[^\p{L}\p{N}])\+\d{7,15}(?!\d)/u.test(value)
    || containsFormattedPhoneLikeValue(value)
    || /(?:^|[^\p{L}\p{N}])Sender(?![\p{L}\p{N}])[^\p{L}\p{N}\r\n]{0,16}\d{1,16}(?![\p{L}\p{N}])/iu.test(
      value,
    )
    || /(?:^|[^\p{L}\p{N}])\d{5,16}(?!\d)/u.test(value)
    || /\btelegram:[^\s`()[\]{}<>]+/iu.test(value)
    || /\bparticipant:[^\s`()[\]{}<>]+/iu.test(value)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(value)
  );
}

function containsFormattedPhoneLikeValue(value: string): boolean {
  const candidates = value.matchAll(
    /(?:^|[^\p{L}\p{N}])(?<candidate>\+?(?:\(\d{1,4}\)|\d)[\d\t .()-]{5,30}\d)(?![\p{L}\p{N}])/gu,
  );
  for (const match of candidates) {
    const candidate = match.groups?.candidate;
    if (!candidate || isCalendarDate(candidate)) {
      continue;
    }
    const digitCount = candidate.match(/\d/gu)?.length ?? 0;
    if (digitCount >= 7 && digitCount <= 15) {
      return true;
    }
  }
  return false;
}

function isCalendarDate(value: string): boolean {
  const normalized = value.trim();
  return (
    /^\d{4}[-.]\d{1,2}[-.]\d{1,2}$/u.test(normalized)
    || /^\d{1,2}[-.]\d{1,2}[-.]\d{2,4}$/u.test(normalized)
  );
}
