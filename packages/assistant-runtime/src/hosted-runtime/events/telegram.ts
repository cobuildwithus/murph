import {
  normalizeTelegramUpdate,
  type TelegramUpdateLike,
} from "@murph/inboxd";
import type { HostedExecutionDispatchRequest } from "@murph/hosted-execution";

import { withHostedInboxPipeline } from "./inbox-pipeline.ts";

export async function ingestHostedTelegramMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "telegram.message.received" }>;
  },
): Promise<void> {
  const capture = await normalizeTelegramUpdate({
    accountId: "bot",
    botUserId: dispatch.event.botUserId,
    update: dispatch.event.telegramUpdate as TelegramUpdateLike,
  });

  await withHostedInboxPipeline(vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });
}
