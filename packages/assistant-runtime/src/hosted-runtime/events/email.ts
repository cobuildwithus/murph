import {
  normalizeParsedEmailMessage,
  parseRawEmailMessage,
} from "@murphai/inboxd";
import {
  resolveHostedEmailSelfAddresses,
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

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
  _runtimeEnv: Readonly<Record<string, string>>,
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

  const capture = await normalizeParsedEmailMessage({
    accountAddress: dispatch.event.identityId,
    accountId: dispatch.event.identityId,
    message: parsedMessage,
    selfAddresses: resolveHostedEmailSelfAddresses({
      senderIdentity: dispatch.event.identityId,
    }),
    source: "email",
    threadTarget: null,
  });

  await withHostedInboxPipeline(vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });
}
