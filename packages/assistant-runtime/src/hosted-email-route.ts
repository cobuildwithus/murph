import {
  resolveAssistantSelfDeliveryTarget,
  readAssistantAutomationState,
  saveAssistantAutomationState,
  saveAssistantSelfDeliveryTarget,
} from "murph/assistant-core";
import {
  readHostedVerifiedEmailFromEnv,
} from "@murph/runtime-state";
import { resolveHostedEmailSenderIdentity } from "@murph/hosted-execution";

type HostedEmailSelfTargetStatus =
  | "missing-sender-identity"
  | "no-verified-email"
  | "saved"
  | "unchanged";

export interface HostedEmailSelfTargetReconciliationResult {
  emailAddress: string | null;
  identityId: string | null;
  preferredChannelsUpdated: boolean;
  selfTargetUpdated: boolean;
  status: HostedEmailSelfTargetStatus;
}

export async function reconcileHostedVerifiedEmailSelfTarget(input: {
  operatorHomeRoot: string;
  source?: Readonly<Record<string, string | undefined>>;
  vaultRoot: string;
}): Promise<HostedEmailSelfTargetReconciliationResult> {
  const verifiedEmail = readHostedVerifiedEmailFromEnv(input.source);

  if (!verifiedEmail) {
    return {
      emailAddress: null,
      identityId: null,
      preferredChannelsUpdated: false,
      selfTargetUpdated: false,
      status: "no-verified-email",
    };
  }

  const senderIdentity = resolveHostedEmailSenderIdentity(input.source);
  if (!senderIdentity) {
    return {
      emailAddress: verifiedEmail.address,
      identityId: null,
      preferredChannelsUpdated: false,
      selfTargetUpdated: false,
      status: "missing-sender-identity",
    };
  }

  const nextTarget = {
    channel: "email",
    deliveryTarget: verifiedEmail.address,
    identityId: senderIdentity,
    participantId: verifiedEmail.address,
    sourceThreadId: null,
  };
  const existingTarget = await resolveAssistantSelfDeliveryTarget("email", input.operatorHomeRoot);
  const selfTargetUpdated = !isAssistantSelfDeliveryTargetEqual(existingTarget, nextTarget);

  if (selfTargetUpdated) {
    await saveAssistantSelfDeliveryTarget(nextTarget, input.operatorHomeRoot);
  }

  const automationState = await readAssistantAutomationState(input.vaultRoot);
  const preferredChannels = automationState.preferredChannels.includes("email")
    ? automationState.preferredChannels
    : [...automationState.preferredChannels, "email"];
  const preferredChannelsUpdated = preferredChannels.length !== automationState.preferredChannels.length;

  if (preferredChannelsUpdated) {
    await saveAssistantAutomationState(input.vaultRoot, {
      ...automationState,
      preferredChannels,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    emailAddress: verifiedEmail.address,
    identityId: senderIdentity,
    preferredChannelsUpdated,
    selfTargetUpdated,
    status: selfTargetUpdated || preferredChannelsUpdated ? "saved" : "unchanged",
  };
}

function isAssistantSelfDeliveryTargetEqual(
  left: {
    channel: string;
    deliveryTarget: string | null;
    identityId: string | null;
    participantId: string | null;
    sourceThreadId: string | null;
  } | null,
  right: {
    channel: string;
    deliveryTarget: string | null;
    identityId: string | null;
    participantId: string | null;
    sourceThreadId: string | null;
  },
): boolean {
  return (
    left?.channel === right.channel
    && left?.deliveryTarget === right.deliveryTarget
    && left?.identityId === right.identityId
    && left?.participantId === right.participantId
    && left?.sourceThreadId === right.sourceThreadId
  );
}
