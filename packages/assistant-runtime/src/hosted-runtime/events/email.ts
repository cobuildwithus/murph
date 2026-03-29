import {
  normalizeParsedEmailMessage,
  parseRawEmailMessage,
  readRawEmailHeaderValue,
} from "@murph/inboxd";
import {
  isHostedEmailInboundSenderAuthorized,
  parseHostedEmailThreadTarget,
  readHostedVerifiedEmailFromEnv,
} from "@murph/runtime-state";
import {
  resolveHostedEmailSelfAddresses,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";

import {
  buildHostedRunnerEmailMessageUrl,
} from "../../hosted-email.ts";
import { fetchHostedBytesResponse } from "../internal-http.ts";
import { withHostedInboxPipeline } from "./inbox-pipeline.ts";

export async function ingestHostedEmailMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "email.message.received" }>;
  },
  emailBaseUrl: string,
  fetchImpl: typeof fetch | undefined,
  timeoutMs: number | null,
  runtimeEnv: Readonly<Record<string, string>>,
): Promise<void> {
  const { bytes, response } = await fetchHostedBytesResponse({
    description: "Hosted email message fetch",
    fetchImpl,
    timeoutMs,
    url: buildHostedRunnerEmailMessageUrl(emailBaseUrl, dispatch.event.rawMessageKey).toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Hosted email message fetch failed for ${dispatch.event.userId}/${dispatch.event.rawMessageKey} with HTTP ${response.status}.`,
    );
  }

  const parsedMessage = parseRawEmailMessage(bytes);
  const headerFrom = readRawEmailHeaderValue(bytes, "from");
  const verifiedEmailAddress = readHostedVerifiedEmailFromEnv(runtimeEnv)?.address ?? null;

  if (!isHostedEmailInboundSenderAuthorized({
    envelopeFrom: dispatch.event.envelopeFrom,
    hasRepeatedHeaderFrom: headerFrom.repeated,
    headerFrom: headerFrom.value ?? parsedMessage.from,
    threadTarget: parseHostedEmailThreadTarget(dispatch.event.threadTarget),
    verifiedEmailAddress,
  })) {
    throw new Error(
      `Hosted email sender is not authorized for ${dispatch.event.userId}/${dispatch.event.rawMessageKey}.`,
    );
  }

  const capture = await normalizeParsedEmailMessage({
    accountAddress: dispatch.event.identityId,
    accountId: dispatch.event.identityId,
    message: parsedMessage,
    selfAddresses: resolveHostedEmailSelfAddresses({
      envelopeTo: dispatch.event.envelopeTo,
      senderIdentity: dispatch.event.identityId,
    }),
    source: "email",
    threadTarget: dispatch.event.threadTarget,
  });

  await withHostedInboxPipeline(vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });
}
