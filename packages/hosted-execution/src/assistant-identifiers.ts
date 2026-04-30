import { createHash, createHmac } from "node:crypto";

const HOSTED_ASSISTANT_IDENTIFIER_BLIND_NAMESPACE =
  "murph.hosted-assistant-input.identifier-blind.v1";

export interface HostedAssistantConversationIdentifierBlind {
  key: string;
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
