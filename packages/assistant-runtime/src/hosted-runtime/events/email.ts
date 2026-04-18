import {
  normalizeParsedEmailMessage,
} from "@murphai/inboxd/connectors/email/normalize-parsed";
import {
  parseRawEmailMessage,
} from "@murphai/inboxd/connectors/email/parsed";
import {
  resolveHostedEmailSelfAddresses,
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

import type {
  HostedRuntimeEffectsPort,
} from "../platform.ts";

export async function buildHostedEmailCapture(
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "email.message.received" }>;
  },
  effectsPort: HostedRuntimeEffectsPort,
): Promise<Awaited<ReturnType<typeof normalizeParsedEmailMessage>>> {
  const bytes = await effectsPort.readRawEmailMessage(dispatch.event.rawMessageKey);

  if (!bytes) {
    throw new Error(
      `Hosted email message fetch failed for ${dispatch.event.userId}/${dispatch.event.rawMessageKey}.`,
    );
  }

  const parsedMessage = parseRawEmailMessage(bytes);

  return normalizeParsedEmailMessage({
    accountAddress: dispatch.event.identityId,
    accountId: dispatch.event.identityId,
    message: parsedMessage,
    selfAddresses: resolveHostedEmailSelfAddresses({
      extra: [dispatch.event.selfAddress],
      senderIdentity: dispatch.event.identityId,
    }),
    source: "email",
    threadTarget: null,
  });
}
