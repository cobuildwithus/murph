import {
  assistantPreferenceCausalSeqSchema,
  assistantTonePreferenceValues,
  assistantVoiceOptionIdValues,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";
import { z } from "zod";

import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  type HostedAssistantProductModel,
} from "./assistant-model.ts";

export const HOSTED_RUNTIME_ASSISTANT_PERSONALIZATION_TOOL_PATH =
  "/api/internal/hosted-execution/assistant-personalization/tool";

export const HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION =
  "resolve_preference_causal_seq";

export type HostedRuntimeAssistantPersonalizationToolRequest =
  | { action: "read" }
  | {
      action: "update";
      tone?: AssistantTonePreference;
      voice?: AssistantVoiceOptionId;
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

export type HostedRuntimeAssistantPersonalizationToolResponse =
  | {
      action: "read";
      result: HostedRuntimeAssistantPersonalizationSnapshot;
    }
  | {
      action: "update";
      result: HostedRuntimeAssistantPersonalizationUpdateResult;
    };

export type HostedRuntimeAssistantPreferenceCausalSeqRequest = {
  action: typeof HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION;
};

export interface HostedRuntimeAssistantPreferenceCausalSeqResponse {
  action: typeof HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION;
  result: {
    causalSeq: string;
  };
}

export const hostedRuntimeAssistantPersonalizationToolRequestSchema = z
  .discriminatedUnion("action", [
    z.object({ action: z.literal("read") }).strict(),
    z.object({
      action: z.literal("update"),
      tone: z.enum(assistantTonePreferenceValues).optional(),
      voice: z.enum(assistantVoiceOptionIdValues).optional(),
    }).strict(),
  ])
  .superRefine((request, context) => {
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
  });


const hostedRuntimeAssistantPersonalizationSnapshotSchema = z.object({
  model: z.enum(HOSTED_ASSISTANT_PRODUCT_MODELS),
  solAvailable: z.boolean(),
  tone: z.enum(assistantTonePreferenceValues),
  voice: z.enum(assistantVoiceOptionIdValues),
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
  ]);

const hostedRuntimeAssistantPreferenceCausalSeqRequestSchema = z.object({
  action: z.literal(HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION),
}).strict();

const hostedRuntimeAssistantPreferenceCausalSeqResponseSchema = z.object({
  action: z.literal(HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION),
  result: z.object({
    causalSeq: assistantPreferenceCausalSeqSchema,
  }).strict(),
}).strict();

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

export function parseHostedRuntimeAssistantPreferenceCausalSeqRequest(
  value: unknown,
): HostedRuntimeAssistantPreferenceCausalSeqRequest {
  return hostedRuntimeAssistantPreferenceCausalSeqRequestSchema.parse(value);
}

export function parseHostedRuntimeAssistantPreferenceCausalSeqResponse(
  value: unknown,
): HostedRuntimeAssistantPreferenceCausalSeqResponse {
  return hostedRuntimeAssistantPreferenceCausalSeqResponseSchema.parse(value);
}
