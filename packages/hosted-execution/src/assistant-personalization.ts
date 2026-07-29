import {
  assistantPersonalityScoreSchema,
  assistantTonePreferenceValues,
  assistantVoiceOptionIdValues,
  type AssistantPersonalitySettingId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";
import { z } from "zod";

import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  type HostedAssistantProductModel,
} from "./assistant-model.ts";
import {
  hostedRuntimePendingGroupSetupInputSchema,
  hostedRuntimePendingGroupSetupSnapshotSchema,
  type HostedRuntimePendingGroupSetupInput,
  type HostedRuntimePendingGroupSetupSnapshot,
} from "./pending-group-setup.ts";

export const HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH =
  "/api/internal/hosted-execution/assistant-personalization/tool";

export const HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION =
  "update_personality";
export const HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION = "prepare_next_group";
export const HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION =
  "read_pending_group_setup";
export const HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION =
  "cancel_pending_group_setup";

export const hostedRuntimePendingGroupSetupUnavailableReasonValues = [
  "direct_member_required",
  "imessage_line_unavailable",
] as const;
export type HostedRuntimePendingGroupSetupUnavailableReason =
  (typeof hostedRuntimePendingGroupSetupUnavailableReasonValues)[number];

export type HostedRuntimeAssistantPersonalizationModelToolRequest =
  | { action: "read" }
  | {
      action: "update";
      tone?: AssistantTonePreference;
      voice?: AssistantVoiceOptionId;
    }
  | {
      action: typeof HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION;
      setup: HostedRuntimePendingGroupSetupInput;
    }
  | { action: typeof HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION }
  | { action: typeof HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION };

export type HostedRuntimeAssistantPersonalityUpdate = Partial<
  Record<AssistantPersonalitySettingId, number | null>
>;

export type HostedRuntimeAssistantPersonalizationToolRequest =
  | HostedRuntimeAssistantPersonalizationModelToolRequest
  | {
      action: typeof HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION;
      personality: HostedRuntimeAssistantPersonalityUpdate;
    };

const hostedRuntimeAssistantPersonalizationToolAuthoritySchema = z.object({
  assistantInputId: z.string().regex(/^ain_[0-9a-f]{32}$/u),
}).strict();

export type HostedRuntimeAssistantPersonalizationToolAuthority = z.infer<
  typeof hostedRuntimeAssistantPersonalizationToolAuthoritySchema
>;

export interface HostedRuntimeAssistantPersonalizationSnapshot {
  model: HostedAssistantProductModel;
  solAvailable: boolean;
  tone: AssistantTonePreference;
  voice: AssistantVoiceOptionId;
}

export interface HostedRuntimeAssistantPersonalizationUpdateResult
  extends HostedRuntimeAssistantPersonalizationSnapshot {
  modelChangeAppliesNextRun: false;
  modelUpdated: false;
  status: "saved" | "unchanged";
}

export const hostedRuntimeAssistantPersonalityUpdateOutcomeValues = [
  "saved",
  "unchanged",
  "superseded",
] as const;

export type HostedRuntimeAssistantPersonalityUpdateOutcome =
  (typeof hostedRuntimeAssistantPersonalityUpdateOutcomeValues)[number];

export interface HostedRuntimeAssistantPersonalitySettingSnapshot {
  source: "custom" | "default";
  value: number;
}

export type HostedRuntimeAssistantPersonalitySettings = Record<
  AssistantPersonalitySettingId,
  HostedRuntimeAssistantPersonalitySettingSnapshot
>;

export type HostedRuntimeAssistantPersonalityUpdateOutcomes = Partial<
  Record<AssistantPersonalitySettingId, HostedRuntimeAssistantPersonalityUpdateOutcome>
>;

export type HostedRuntimePendingGroupSetupReadResult =
  | {
      setup: HostedRuntimePendingGroupSetupSnapshot;
      status: "ok";
    }
  | {
      setup: null;
      status: "none";
    }
  | {
      setup: null;
      status: "unavailable";
      unavailableReason: HostedRuntimePendingGroupSetupUnavailableReason;
    };

export type HostedRuntimeAssistantPersonalizationToolResponse =
  | {
      action: "read";
      result: HostedRuntimeAssistantPersonalizationSnapshot;
    }
  | {
      action: "update";
      result: HostedRuntimeAssistantPersonalizationUpdateResult;
    }
  | {
      action: typeof HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION;
      result: {
        outcomes: HostedRuntimeAssistantPersonalityUpdateOutcomes;
        settings: HostedRuntimeAssistantPersonalitySettings;
      };
    }
  | {
      action: typeof HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION;
      result:
        | {
            setup: HostedRuntimePendingGroupSetupSnapshot;
            status: "armed";
          }
        | {
            setup: null;
            status: "unavailable";
            unavailableReason: HostedRuntimePendingGroupSetupUnavailableReason;
          };
    }
  | {
      action: typeof HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION;
      result: HostedRuntimePendingGroupSetupReadResult;
    }
  | {
      action: typeof HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION;
      result:
        | { status: "canceled" | "none" }
        | {
            status: "unavailable";
            unavailableReason: HostedRuntimePendingGroupSetupUnavailableReason;
          };
    };

const hostedRuntimeAssistantPersonalizationReadRequestSchema = z
  .object({ action: z.literal("read") })
  .strict();

const hostedRuntimeAssistantPersonalizationUpdateRequestSchema = z.object({
  action: z.literal("update"),
  tone: z.enum(assistantTonePreferenceValues).optional(),
  voice: z.enum(assistantVoiceOptionIdValues).optional(),
}).strict();

function requireNonEmptyAssistantPersonalizationUpdate(
  request: { action: string; tone?: unknown; voice?: unknown },
  context: z.RefinementCtx,
): void {
  if (
    request.action === "update"
    && request.tone === undefined
    && request.voice === undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Assistant personalization update requires a tone or voice.",
    });
  }
}

export const hostedRuntimeAssistantPersonalizationModelToolRequestSchema = z
  .discriminatedUnion("action", [
    hostedRuntimeAssistantPersonalizationReadRequestSchema,
    hostedRuntimeAssistantPersonalizationUpdateRequestSchema,
    z.object({
      action: z.literal(HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION),
      setup: hostedRuntimePendingGroupSetupInputSchema,
    }).strict(),
    z.object({
      action: z.literal(HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION),
    }).strict(),
    z.object({
      action: z.literal(HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION),
    }).strict(),
  ])
  .superRefine(requireNonEmptyAssistantPersonalizationUpdate);

const hostedRuntimeAssistantPersonalityUpdateSchema = z
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
        message: "Assistant personality update requires at least one setting.",
      });
    }
  });

export const hostedRuntimeAssistantPersonalizationToolRequestSchema = z
  .discriminatedUnion("action", [
    hostedRuntimeAssistantPersonalizationReadRequestSchema,
    hostedRuntimeAssistantPersonalizationUpdateRequestSchema,
    z.object({
      action: z.literal(HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION),
      personality: hostedRuntimeAssistantPersonalityUpdateSchema,
    }).strict(),
    z.object({
      action: z.literal(HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION),
      setup: hostedRuntimePendingGroupSetupInputSchema,
    }).strict(),
    z.object({
      action: z.literal(HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION),
    }).strict(),
    z.object({
      action: z.literal(HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION),
    }).strict(),
  ])
  .superRefine(requireNonEmptyAssistantPersonalizationUpdate);

const hostedRuntimeAssistantPersonalizationSnapshotSchema = z.object({
  model: z.enum(HOSTED_ASSISTANT_PRODUCT_MODELS),
  solAvailable: z.boolean(),
  tone: z.enum(assistantTonePreferenceValues),
  voice: z.enum(assistantVoiceOptionIdValues),
}).strict();

const hostedRuntimeAssistantPersonalitySettingSnapshotSchema = z.object({
  source: z.enum(["custom", "default"]),
  value: assistantPersonalityScoreSchema,
}).strict();

const hostedRuntimeAssistantPersonalitySettingsSchema = z.object({
  detail: hostedRuntimeAssistantPersonalitySettingSnapshotSchema,
  humor: hostedRuntimeAssistantPersonalitySettingSnapshotSchema,
  push: hostedRuntimeAssistantPersonalitySettingSnapshotSchema,
  unhinged: hostedRuntimeAssistantPersonalitySettingSnapshotSchema,
}).strict();

const hostedRuntimeAssistantPersonalityUpdateOutcomesSchema = z
  .object({
    detail: z.enum(hostedRuntimeAssistantPersonalityUpdateOutcomeValues).optional(),
    humor: z.enum(hostedRuntimeAssistantPersonalityUpdateOutcomeValues).optional(),
    push: z.enum(hostedRuntimeAssistantPersonalityUpdateOutcomeValues).optional(),
    unhinged: z.enum(hostedRuntimeAssistantPersonalityUpdateOutcomeValues).optional(),
  })
  .strict()
  .superRefine((outcomes, context) => {
    if (Object.keys(outcomes).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assistant personality update requires at least one outcome.",
      });
    }
  });

const pendingGroupSetupUnavailableReasonSchema = z.enum(
  hostedRuntimePendingGroupSetupUnavailableReasonValues,
);

const pendingGroupSetupUnavailableResultSchema = z.object({
  setup: z.null(),
  status: z.literal("unavailable"),
  unavailableReason: pendingGroupSetupUnavailableReasonSchema,
}).strict();

export const hostedRuntimeAssistantPersonalizationToolResponseSchema =
  z.discriminatedUnion("action", [
    z.object({
      action: z.literal("read"),
      result: hostedRuntimeAssistantPersonalizationSnapshotSchema,
    }).strict(),
    z.object({
      action: z.literal("update"),
      result: hostedRuntimeAssistantPersonalizationSnapshotSchema.extend({
        modelChangeAppliesNextRun: z.literal(false),
        modelUpdated: z.literal(false),
        status: z.enum(["saved", "unchanged"]),
      }).strict(),
    }).strict(),
    z.object({
      action: z.literal(HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION),
      result: z.object({
        outcomes: hostedRuntimeAssistantPersonalityUpdateOutcomesSchema,
        settings: hostedRuntimeAssistantPersonalitySettingsSchema,
      }).strict(),
    }).strict(),
    z.object({
      action: z.literal(HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION),
      result: z.union([
        z.object({
          setup: hostedRuntimePendingGroupSetupSnapshotSchema,
          status: z.literal("armed"),
        }).strict(),
        pendingGroupSetupUnavailableResultSchema,
      ]),
    }).strict(),
    z.object({
      action: z.literal(HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION),
      result: z.union([
        z.object({
          setup: hostedRuntimePendingGroupSetupSnapshotSchema,
          status: z.literal("ok"),
        }).strict(),
        z.object({ setup: z.null(), status: z.literal("none") }).strict(),
        pendingGroupSetupUnavailableResultSchema,
      ]),
    }).strict(),
    z.object({
      action: z.literal(HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION),
      result: z.union([
        z.object({ status: z.enum(["canceled", "none"]) }).strict(),
        z.object({
          status: z.literal("unavailable"),
          unavailableReason: pendingGroupSetupUnavailableReasonSchema,
        }).strict(),
      ]),
    }).strict(),
  ]);

export function parseHostedRuntimeAssistantPersonalizationToolRequest(
  value: unknown,
): HostedRuntimeAssistantPersonalizationToolRequest {
  return hostedRuntimeAssistantPersonalizationToolRequestSchema.parse(value);
}

export function parseHostedRuntimeAssistantPersonalizationToolAuthority(
  value: unknown,
): HostedRuntimeAssistantPersonalizationToolAuthority {
  const parsed = hostedRuntimeAssistantPersonalizationToolAuthoritySchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("Hosted assistant personalization input authority is invalid.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function parseHostedRuntimeAssistantPersonalizationToolResponse(
  value: unknown,
): HostedRuntimeAssistantPersonalizationToolResponse {
  return hostedRuntimeAssistantPersonalizationToolResponseSchema.parse(value);
}
