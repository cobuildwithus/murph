import {
  assistantPersonaIdSchema,
  assistantPersonalityScoreSchema,
  assistantTonePreferenceSchema,
  assistantVoiceOptionIdSchema,
} from "@murphai/contracts";
import { z } from "zod";

export const HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION = 1;
export const HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES = 4 * 1_024;

const hostedRuntimePendingGroupSetupRoomContextSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength
        <= HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES,
    { message: "room context exceeds the UTF-8 byte limit" },
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

export const hostedRuntimePendingGroupSetupInputSchema = z
  .object({
    roomContextMarkdown: hostedRuntimePendingGroupSetupRoomContextSchema.optional(),
    style: hostedRuntimePendingGroupSetupStyleSchema.optional(),
  })
  .strict()
  .superRefine((setup, context) => {
    if (setup.roomContextMarkdown === undefined && setup.style === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "setup requires style or room context",
      });
    }
  });

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
  hostedRuntimePendingGroupSetupInputSchema.safeExtend({
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
