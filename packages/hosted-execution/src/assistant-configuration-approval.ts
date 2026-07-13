import { createHash } from "node:crypto";

import {
  serializeHostedActionApprovalRequest,
  type HostedActionApprovalRequest,
  type HostedActionApprovalReturnContactKind,
} from "./action-approval.ts";
import {
  isHostedAssistantProductModel,
  isHostedAssistantReasoningEffort,
  type HostedAssistantProductModel,
  type HostedAssistantReasoningEffort,
} from "./assistant-model.ts";
import { parseHostedReturnContactKind } from "./return-contact.ts";

const HOSTED_ASSISTANT_CONFIGURATION_ACTION_ID_DOMAIN =
  "murph.hosted-assistant-configuration-action.v1";
const HOSTED_ASSISTANT_CONFIGURATION_APPROVAL_FINGERPRINT_DOMAIN =
  "murph.hosted-assistant-configuration-approval.v1";
const HOSTED_ASSISTANT_CONFIGURATION_APPROVAL_CONSUMER_DOMAIN =
  "murph.hosted-assistant-configuration-approval-consumer.v1";

export const HOSTED_ASSISTANT_CONFIGURATION_ACTION_KIND =
  "assistant_configuration_update" as const;

const HOSTED_ASSISTANT_MODEL_PRESENTATION_LABELS = {
  "gpt-5.6-luna": "Luna",
  "gpt-5.6-sol": "Sol",
  "gpt-5.6-terra": "Terra",
} as const satisfies Record<HostedAssistantProductModel, string>;

const HOSTED_ASSISTANT_REASONING_PRESENTATION_LABELS = {
  high: "high",
  low: "low",
  medium: "medium",
  xhigh: "extra-high",
} as const satisfies Record<HostedAssistantReasoningEffort, string>;

export interface HostedAssistantConfigurationApprovalTarget {
  model: HostedAssistantProductModel;
  reasoningEffort: HostedAssistantReasoningEffort;
}

export type HostedAssistantConfigurationApprovalChanges =
  | {
      model: HostedAssistantProductModel;
      reasoningEffort?: HostedAssistantReasoningEffort;
    }
  | {
      model?: never;
      reasoningEffort: HostedAssistantReasoningEffort;
    };

export function buildHostedAssistantConfigurationApprovalRequest(input: {
  changes: HostedAssistantConfigurationApprovalChanges;
  returnContactKind: HostedActionApprovalReturnContactKind | null;
  target: HostedAssistantConfigurationApprovalTarget;
}): HostedActionApprovalRequest {
  const changes = requireHostedAssistantConfigurationApprovalChanges(
    input.changes,
    "changes",
  );
  const target = requireHostedAssistantConfigurationApprovalTarget(
    input.target,
    "target",
  );
  const returnContactKind = parseHostedReturnContactKind(
    input.returnContactKind,
    "Hosted assistant configuration approval returnContactKind",
  );
  const exactChanges = [
    changes.model ?? null,
    changes.reasoningEffort ?? null,
  ] as const;
  const exactTarget = [
    target.model,
    target.reasoningEffort,
    returnContactKind,
  ] as const;
  const actionIdentity = sha256Hex(JSON.stringify([
    HOSTED_ASSISTANT_CONFIGURATION_ACTION_ID_DOMAIN,
    ...exactChanges,
    ...exactTarget,
  ]));
  const presentation = {
    body: formatHostedAssistantConfigurationApprovalBody(changes, target),
    title: "Change Murph's model settings?",
  };

  return {
    actionFingerprint: sha256Hex(JSON.stringify([
      HOSTED_ASSISTANT_CONFIGURATION_APPROVAL_FINGERPRINT_DOMAIN,
      actionIdentity,
      ...exactChanges,
      ...exactTarget,
      presentation.title,
      presentation.body,
    ])),
    actionId: `assistant-configuration-update:${actionIdentity}`,
    actionKind: HOSTED_ASSISTANT_CONFIGURATION_ACTION_KIND,
    presentation,
    returnContactKind,
  };
}

function requireHostedAssistantConfigurationApprovalChanges(
  value: HostedAssistantConfigurationApprovalChanges,
  label: string,
): HostedAssistantConfigurationApprovalChanges {
  const model = value?.model;
  const reasoningEffort = value?.reasoningEffort;
  if (model === undefined) {
    if (reasoningEffort === undefined) {
      throw new TypeError(
        `Hosted assistant configuration approval ${label} requires a model or reasoning effort.`,
      );
    }
    if (!isHostedAssistantReasoningEffort(reasoningEffort)) {
      throw new TypeError(
        `Hosted assistant configuration approval ${label} reasoning effort is not supported.`,
      );
    }
    return { reasoningEffort };
  }
  if (!isHostedAssistantProductModel(model)) {
    throw new TypeError(
      `Hosted assistant configuration approval ${label} model is not supported.`,
    );
  }
  if (
    reasoningEffort !== undefined &&
    !isHostedAssistantReasoningEffort(reasoningEffort)
  ) {
    throw new TypeError(
      `Hosted assistant configuration approval ${label} reasoning effort is not supported.`,
    );
  }

  return reasoningEffort === undefined
    ? { model }
    : { model, reasoningEffort };
}

export function buildHostedAssistantConfigurationApprovalConsumerId(
  request: HostedActionApprovalRequest,
): string {
  return `assistant-configuration-update:${sha256Hex(JSON.stringify([
    HOSTED_ASSISTANT_CONFIGURATION_APPROVAL_CONSUMER_DOMAIN,
    serializeHostedActionApprovalRequest(request),
  ]))}`;
}

function requireHostedAssistantConfigurationApprovalTarget(
  value: HostedAssistantConfigurationApprovalTarget,
  label: string,
): HostedAssistantConfigurationApprovalTarget {
  if (!isHostedAssistantProductModel(value?.model)) {
    throw new TypeError(
      `Hosted assistant configuration approval ${label} model is not supported.`,
    );
  }
  if (!isHostedAssistantReasoningEffort(value.reasoningEffort)) {
    throw new TypeError(
      `Hosted assistant configuration approval ${label} reasoning effort is not supported.`,
    );
  }

  return {
    model: value.model,
    reasoningEffort: value.reasoningEffort,
  };
}

function formatHostedAssistantConfigurationApprovalBody(
  changes: HostedAssistantConfigurationApprovalChanges,
  target: HostedAssistantConfigurationApprovalTarget,
): string {
  const modelLabel = HOSTED_ASSISTANT_MODEL_PRESENTATION_LABELS[target.model];
  const reasoningLabel =
    HOSTED_ASSISTANT_REASONING_PRESENTATION_LABELS[target.reasoningEffort];
  if (changes.model !== undefined && changes.reasoningEffort !== undefined) {
    return `Set Murph's next-turn model settings to ${modelLabel} with ${reasoningLabel} reasoning. This approval applies only to this exact change and resolved setting.`;
  }
  if (changes.model !== undefined) {
    return `Set Murph's next-turn model to ${modelLabel}. Reasoning stays ${reasoningLabel}. This approval applies only to this exact change and resolved setting.`;
  }
  return `Set Murph's next-turn reasoning to ${reasoningLabel}. Model stays ${modelLabel}. This approval applies only to this exact change and resolved setting.`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
