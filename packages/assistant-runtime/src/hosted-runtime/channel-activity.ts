import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  isHostedLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  markLinqChatRead,
} from "@murphai/operator-config/linq-runtime";

export async function markHostedConversationReadBestEffort(input: {
  runtimeEnv: Readonly<Record<string, string>>;
  wake: HostedExecutionConversationMessageWake;
  signal?: AbortSignal;
}): Promise<void> {
  if (!isHostedLinqConversationMessageWake(input.wake)) {
    return;
  }

  const linqMessage = input.wake.message.linqMessage;
  if (linqMessage.isFromMe) {
    return;
  }

  try {
    await markLinqChatRead(
      {
        chatId: linqMessage.chatId,
      },
      {
        env: input.runtimeEnv as NodeJS.ProcessEnv,
        signal: input.signal,
      },
    );
  } catch {
    // Best-effort provider-visible acknowledgement; local import remains authoritative.
  }
}
