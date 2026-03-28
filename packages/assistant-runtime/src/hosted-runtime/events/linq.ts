import {
  normalizeLinqWebhookEvent,
  parseLinqWebhookEvent,
} from "@murph/inboxd";
import type { HostedExecutionDispatchRequest } from "@murph/hosted-execution";

import { withHostedInboxPipeline } from "./inbox-pipeline.ts";

export async function ingestHostedLinqMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "linq.message.received" }>;
  },
): Promise<void> {
  const event = parseLinqWebhookEvent(JSON.stringify(dispatch.event.linqEvent));
  const capture = await normalizeLinqWebhookEvent({
    defaultAccountId: dispatch.event.normalizedPhoneNumber,
    event,
  });

  await withHostedInboxPipeline(vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });
}
