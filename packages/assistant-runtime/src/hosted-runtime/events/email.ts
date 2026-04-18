import {
  normalizeParsedEmailMessage,
} from "@murphai/inboxd/connectors/email/normalize-parsed";
import {
  parseRawEmailMessage,
} from "@murphai/inboxd/connectors/email/parsed";
import {
  resolveHostedEmailSelfAddresses,
  type HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";

import type {
  HostedRuntimeEffectsPort,
} from "../platform.ts";

export async function buildHostedEmailCapture(
  wake: HostedExecutionConversationMessageWake & {
    message: Extract<HostedExecutionConversationMessageWake["message"], { channel: "email" }>;
  },
  effectsPort: HostedRuntimeEffectsPort,
): Promise<Awaited<ReturnType<typeof normalizeParsedEmailMessage>>> {
  const bytes = await effectsPort.readRawEmailMessage(wake.message.rawMessageKey);

  if (!bytes) {
    throw new Error(
      `Hosted email message fetch failed for ${wake.userId}/${wake.message.rawMessageKey}.`,
    );
  }

  const parsedMessage = parseRawEmailMessage(bytes);

  return normalizeParsedEmailMessage({
    accountAddress: wake.message.identityId,
    accountId: wake.message.identityId,
    message: parsedMessage,
    selfAddresses: resolveHostedEmailSelfAddresses({
      extra: [wake.message.selfAddress],
      senderIdentity: wake.message.identityId,
    }),
    source: "email",
    threadTarget: null,
  });
}
