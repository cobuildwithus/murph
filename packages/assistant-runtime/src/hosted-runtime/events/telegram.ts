import {
  createInboxPipeline,
  normalizeTelegramUpdate,
  openInboxRuntime,
  rebuildRuntimeFromVault,
  type TelegramUpdateLike,
} from "@murph/inboxd";
import type { HostedExecutionDispatchRequest } from "@murph/hosted-execution";

export async function ingestHostedTelegramMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "telegram.message.received" }>;
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
    const capture = await normalizeTelegramUpdate({
      accountId: "bot",
      update: dispatch.event.telegramUpdate as TelegramUpdateLike,
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
