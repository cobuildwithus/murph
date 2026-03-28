import {
  normalizeParsedEmailMessage,
  parseRawEmailMessage,
} from "@murph/inboxd";
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
  timeoutMs: number | null,
): Promise<void> {
  const { bytes, response } = await fetchHostedBytesResponse({
    description: "Hosted email message fetch",
    timeoutMs,
    url: buildHostedRunnerEmailMessageUrl(emailBaseUrl, dispatch.event.rawMessageKey).toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Hosted email message fetch failed for ${dispatch.event.userId}/${dispatch.event.rawMessageKey} with HTTP ${response.status}.`,
    );
  }

  const capture = await normalizeParsedEmailMessage({
    accountAddress: dispatch.event.identityId,
    accountId: dispatch.event.identityId,
    message: parseRawEmailMessage(bytes),
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
