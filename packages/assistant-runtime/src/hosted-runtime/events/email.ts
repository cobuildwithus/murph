import {
  createInboxPipeline,
  normalizeParsedEmailMessage,
  openInboxRuntime,
  parseRawEmailMessage,
  rebuildRuntimeFromVault,
} from "@murph/inboxd";
import {
  resolveHostedEmailSelfAddresses,
  type HostedExecutionDispatchRequest,
} from "@murph/hosted-execution";

import {
  buildHostedRunnerEmailMessageUrl,
} from "../../hosted-email.ts";

export async function ingestHostedEmailMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "email.message.received" }>;
  },
  emailBaseUrl: string,
): Promise<void> {
  const response = await fetch(
    buildHostedRunnerEmailMessageUrl(emailBaseUrl, dispatch.event.rawMessageKey).toString(),
  );

  if (!response.ok) {
    throw new Error(
      `Hosted email message fetch failed for ${dispatch.event.userId}/${dispatch.event.rawMessageKey} with HTTP ${response.status}.`,
    );
  }

  const runtime = await openInboxRuntime({
    vaultRoot,
  });
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;

  try {
    await rebuildRuntimeFromVault({
      runtime,
      vaultRoot,
    });
    const capture = await normalizeParsedEmailMessage({
      accountAddress: dispatch.event.identityId,
      accountId: dispatch.event.identityId,
      message: parseRawEmailMessage(new Uint8Array(await response.arrayBuffer())),
      selfAddresses: resolveHostedEmailSelfAddresses({
        envelopeTo: dispatch.event.envelopeTo,
        senderIdentity: dispatch.event.identityId,
      }),
      source: "email",
      threadTarget: dispatch.event.threadTarget,
    });
    pipeline = await createInboxPipeline({
      runtime,
      vaultRoot,
    });
    await pipeline.processCapture(capture);
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
  }
}
