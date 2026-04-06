import {
  resolveAssistantSelfDeliveryTarget,
  saveAssistantSelfDeliveryTarget,
} from "@murphai/operator-config";
import {
  readHostedVerifiedEmailFromEnv,
} from "@murphai/runtime-state";
import { resolveHostedEmailSenderIdentity } from "@murphai/hosted-execution";

type HostedEmailSelfTargetStatus =
  | "missing-sender-identity"
  | "no-verified-email"
  | "saved"
  | "unchanged";

export interface HostedEmailSelfTargetReconciliationResult {
  emailAddress: string | null;
  identityId: string | null;
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
      selfTargetUpdated: false,
      status: "no-verified-email",
    };
  }

  const senderIdentity = resolveHostedEmailSenderIdentity(input.source);
  if (!senderIdentity) {
    return {
      emailAddress: verifiedEmail.address,
      identityId: null,
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

  return {
    emailAddress: verifiedEmail.address,
    identityId: senderIdentity,
    selfTargetUpdated,
    status: selfTargetUpdated ? "saved" : "unchanged",
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
