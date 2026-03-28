import {
  createInboxPipeline,
  normalizeLinqWebhookEvent,
  openInboxRuntime,
  parseLinqWebhookEvent,
  rebuildRuntimeFromVault,
} from "@murph/inboxd";
import type { HostedExecutionDispatchRequest } from "@murph/hosted-execution";

export async function ingestHostedLinqMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "linq.message.received" }>;
  },
): Promise<void> {
  const runtime = await openInboxRuntime({
    vaultRoot,
  });
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;

  try {
    await rebuildRuntimeFromVault({
      runtime,
      vaultRoot,
    });
    const event = parseLinqWebhookEvent(JSON.stringify(dispatch.event.linqEvent));
    const capture = await normalizeLinqWebhookEvent({
      defaultAccountId: dispatch.event.normalizedPhoneNumber,
      event,
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
