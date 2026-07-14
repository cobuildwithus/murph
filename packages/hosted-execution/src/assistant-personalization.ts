import {
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

export type HostedRuntimeAssistantPersonalizationToolRequest =
  | { action: "read" }
  | {
      action: "update";
      tone?: AssistantTonePreference;
      voice?: AssistantVoiceOptionId;
    };

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

export function parseHostedRuntimeAssistantPersonalizationToolRequest(
  value: unknown,
): HostedRuntimeAssistantPersonalizationToolRequest {
  return hostedRuntimeAssistantPersonalizationToolRequestSchema.parse(value);
}

export function parseHostedRuntimeAssistantPersonalizationToolResponse(
  value: unknown,
): HostedRuntimeAssistantPersonalizationToolResponse {
  return hostedRuntimeAssistantPersonalizationToolResponseSchema.parse(value);
}
