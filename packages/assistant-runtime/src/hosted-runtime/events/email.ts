import {
  type HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";

import type {
  HostedRuntimeEffectsPort,
} from "../platform.ts";

export async function readHostedRawEmailMessage(
  wake: HostedExecutionConversationMessageWake & {
    message: Extract<HostedExecutionConversationMessageWake["message"], { channel: "email" }>;
  },
  effectsPort: HostedRuntimeEffectsPort,
): Promise<Uint8Array> {
  const bytes = await effectsPort.readRawEmailMessage(wake.message.rawMessageKey);

  if (!bytes) {
    throw new Error(
      `Hosted email message fetch failed for ${wake.userId}/${wake.message.rawMessageKey}.`,
    );
  }

  return bytes;
}
