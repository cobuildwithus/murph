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
import { withHostedInboxPipeline } from "./inbox-pipeline.ts";

export async function ingestHostedEmailMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "email.message.received" }>;
  },
  effectsPort: HostedRuntimeEffectsPort,
  _runtimeEnv: Readonly<Record<string, string>>,
): Promise<void> {
  const bytes = await effectsPort.readRawEmailMessage(dispatch.event.rawMessageKey);

  if (!bytes) {
    throw new Error(
      `Hosted email message fetch failed for ${dispatch.event.userId}/${dispatch.event.rawMessageKey}.`,
    );
  }

  const parsedMessage = parseRawEmailMessage(bytes);

  const capture = await normalizeParsedEmailMessage({
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

  await withHostedInboxPipeline(vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });
}
