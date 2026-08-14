import { createHash, createHmac } from "node:crypto";

import { parseHostedEmailThreadTarget } from "@murphai/runtime-state";

import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  readHostedLinqConversationMessageAccountLookupKey,
  type HostedExecutionConversationMessageWake,
  type HostedExecutionEmailConversationMessagePayload,
} from "./contracts.ts";

const HOSTED_ASSISTANT_IDENTIFIER_BLIND_NAMESPACE =
  "murph.hosted-assistant-input.identifier-blind.v1";
const HOSTED_ASSISTANT_ASK_COMPLETION_ID_NAMESPACE =
  "murph.hosted-assistant-ask.completion.v1";
export const HOSTED_EXECUTION_REVIEWED_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX =
  "reviewed-assistant-ask-completion:";
export const HOSTED_EXECUTION_PRIVATE_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX =
  "assistant-ask-private:";
export const HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE =
  "I couldn't answer that from the information available to this group.";

export type HostedMailboxAssistantInputLane = "conversation" | "system";

export interface HostedAssistantConversationIdentifierBlind {
  key: string;
}

export function createHostedExecutionAssistantAskCompletionId(
  requestId: string,
): string {
  return `aask_done_${createHash("sha256")
    .update(HOSTED_ASSISTANT_ASK_COMPLETION_ID_NAMESPACE)
    .update("\0")
    .update(requestId)
    .digest("hex")}`;
}

export function createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
  completionId: string,
): string {
  const digest = createHash("sha256")
    .update(completionId)
    .digest("hex")
    .slice(0, 48);
  return `${HOSTED_EXECUTION_REVIEWED_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX}${digest}`;
}

export function createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
  completionId: string,
): string {
  const normalized = completionId.trim();
  if (!normalized || [...normalized].length > 256) {
    throw new TypeError(
      "Hosted private Assistant Ask completion ID is invalid.",
    );
  }
  return `${HOSTED_EXECUTION_PRIVATE_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX}${normalized}`;
}

export function createHostedAssistantConversationIdentifierBlind(input: {
  secret: string;
  userId: string;
}): HostedAssistantConversationIdentifierBlind {
  const secret = normalizeHostedAssistantIdentifierSecret(input.secret);
  const key = createHmac("sha256", secret)
    .update(HOSTED_ASSISTANT_IDENTIFIER_BLIND_NAMESPACE)
    .update("\0")
    .update(input.userId)
    .digest("hex");
  return { key };
}

export function hashHostedAssistantConversationIdentifier(
  blind: HostedAssistantConversationIdentifierBlind,
  value: string | null | undefined,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return `hid_${createHmac("sha256", blind.key)
    .update(normalized || "empty")
    .digest("hex")
    .slice(0, 32)}`;
}

export function hashNullableHostedAssistantConversationIdentifier(
  blind: HostedAssistantConversationIdentifierBlind,
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized
    ? hashHostedAssistantConversationIdentifier(blind, normalized)
    : null;
}

export function readHostedConversationAssistantIdentifierSecret(
  wake: HostedExecutionConversationMessageWake,
): string {
  if (isHostedLinqConversationMessageWake(wake)) {
    return readHostedLinqConversationMessageAccountLookupKey(wake.message);
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return wake.message.telegramMessage.threadId;
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    const threadTarget = parseHostedEmailThreadTarget(wake.message.threadTarget);
    if (threadTarget?.targetKind === "group") {
      return resolveHostedEmailConversationThreadIdentity({
        message: wake.message,
        threadTarget,
      });
    }

    return (
      wake.message.identityId
      ?? wake.message.selfAddress
      ?? wake.message.threadKey
      ?? wake.message.threadTarget
      ?? wake.message.rawMessageKey
    );
  }

  return wake.eventId;
}

export function createHostedMailboxAssistantInputId(input: {
  dedupeKey: string | null | undefined;
  eventId: string;
  lane: HostedMailboxAssistantInputLane;
  secret: string;
  userId: string;
}): string {
  const blind = createHostedAssistantConversationIdentifierBlind({
    secret: input.secret,
    userId: input.userId,
  });
  return createHostedMailboxAssistantInputIdFromBlindedIdentity({
    dedupeKey: hashNullableHostedAssistantConversationIdentifier(
      blind,
      input.dedupeKey,
    ),
    eventId: hashHostedAssistantConversationIdentifier(blind, input.eventId),
    lane: input.lane,
  });
}

export function createHostedMailboxAssistantInputIdFromBlindedIdentity(input: {
  dedupeKey: string | null | undefined;
  eventId: string;
  lane: HostedMailboxAssistantInputLane;
}): string {
  const identity = input.dedupeKey ?? input.eventId;
  const serializedIdentity = JSON.stringify({
    identity,
    kind: "hosted-mailbox",
    lane: input.lane,
  });
  return `ain_${createHash("sha256")
    .update(serializedIdentity)
    .digest("hex")
    .slice(0, 32)}`;
}

export function resolveHostedEmailConversationThreadIdentity(input: {
  message: HostedExecutionEmailConversationMessagePayload;
  threadTarget: ReturnType<typeof parseHostedEmailThreadTarget>;
}): string {
  const { message, threadTarget } = input;
  if (threadTarget?.targetKind !== "group" || !threadTarget.groupId) {
    return message.threadKey ?? message.threadTarget ?? message.rawMessageKey;
  }

  const threadKey = message.threadKey?.trim() ?? "";
  if (threadKey) {
    return `group:${threadTarget.groupId}\0thread:${threadKey}`;
  }

  const legacyRoot = threadTarget.references[0]?.trim() ?? "";
  return legacyRoot
    ? `group:${threadTarget.groupId}\0root:${legacyRoot}`
    : message.rawMessageKey;
}

function normalizeHostedAssistantIdentifierSecret(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(
      "Hosted assistant conversation identifier blinds require secret material.",
    );
  }

  return createHash("sha256")
    .update(HOSTED_ASSISTANT_IDENTIFIER_BLIND_NAMESPACE)
    .update("\0secret\0")
    .update(normalized)
    .digest("hex");
}
