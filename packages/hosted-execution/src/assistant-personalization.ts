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
      model?: HostedAssistantProductModel;
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
  modelChangeAppliesNextRun: boolean;
  modelUpdated: boolean;
  rejectionReason: "sol_requires_edge" | null;
  status: "rejected" | "saved" | "unchanged";
  styleUpdated: boolean;
  updated: boolean;
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
      model: z.enum(HOSTED_ASSISTANT_PRODUCT_MODELS).optional(),
      tone: z.enum(assistantTonePreferenceValues).optional(),
      voice: z.enum(assistantVoiceOptionIdValues).optional(),
    }).strict(),
  ])
  .superRefine((request, context) => {
    if (
      request.action === "update"
      && request.model === undefined
      && request.tone === undefined
      && request.voice === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assistant personalization update requires a model, tone, or voice.",
      });
    }
  });

const hostedRuntimeAssistantPersonalizationSnapshotSchema = z.object({
  model: z.enum(HOSTED_ASSISTANT_PRODUCT_MODELS),
  solAvailable: z.boolean(),
  tone: z.enum(assistantTonePreferenceValues),
  voice: z.enum(assistantVoiceOptionIdValues),
}).strict();

const hostedRuntimeAssistantPersonalizationToolResponseSchema =
  z.discriminatedUnion("action", [
    z.object({
      action: z.literal("read"),
      result: hostedRuntimeAssistantPersonalizationSnapshotSchema,
    }).strict(),
    z.object({
      action: z.literal("update"),
      result: hostedRuntimeAssistantPersonalizationSnapshotSchema.extend({
        modelChangeAppliesNextRun: z.boolean(),
        modelUpdated: z.boolean(),
        rejectionReason: z.enum(["sol_requires_edge"]).nullable(),
        status: z.enum(["rejected", "saved", "unchanged"]),
        styleUpdated: z.boolean(),
        updated: z.boolean(),
      }).strict(),
    }).strict(),
  ]).superRefine((response, context) => {
    if (response.action !== "update") {
      return;
    }

    const result = response.result;
    const updated = result.modelUpdated || result.styleUpdated;
    if (result.updated !== updated) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assistant personalization updated state must match its field changes.",
        path: ["result", "updated"],
      });
    }
    if (result.modelChangeAppliesNextRun !== result.modelUpdated) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assistant model next-run state must match its effective change.",
        path: ["result", "modelChangeAppliesNextRun"],
      });
    }

    if (result.status === "rejected") {
      if (result.rejectionReason !== "sol_requires_edge" || result.updated) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Rejected assistant personalization results cannot apply changes.",
          path: ["result", "status"],
        });
      }
      return;
    }

    if (result.rejectionReason !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Successful assistant personalization results cannot include a rejection.",
        path: ["result", "rejectionReason"],
      });
    }
    if (
      (result.status === "saved" && !result.updated)
      || (result.status === "unchanged" && result.updated)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assistant personalization status must match whether a change was saved.",
        path: ["result", "status"],
      });
    }
  });

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
