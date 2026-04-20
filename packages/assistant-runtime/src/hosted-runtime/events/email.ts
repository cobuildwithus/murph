import {
  type HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";

import type {
  HostedRuntimeEffectsPort,
} from "../platform.ts";

export class HostedRawEmailMessageMissingError extends Error {
  readonly code = "email-raw-message-missing";

  constructor(input: { rawMessageKey: string; userId: string }) {
    super(
      `Hosted email message fetch failed for ${input.userId}/${input.rawMessageKey}.`,
    );
    this.name = "HostedRawEmailMessageMissingError";
  }
}

export async function readHostedRawEmailMessage(
  wake: HostedExecutionConversationMessageWake & {
    message: Extract<HostedExecutionConversationMessageWake["message"], { channel: "email" }>;
  },
  effectsPort: HostedRuntimeEffectsPort,
): Promise<Uint8Array> {
  const bytes = await effectsPort.readRawEmailMessage(wake.message.rawMessageKey);

  if (!bytes) {
    throw new HostedRawEmailMessageMissingError({
      rawMessageKey: wake.message.rawMessageKey,
      userId: wake.userId,
    });
  }

  return bytes;
}
