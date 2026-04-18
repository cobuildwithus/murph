import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";

import { buildHostedEmailCapture } from "./email.ts";
import { withHostedInboxPipeline } from "./inbox-pipeline.ts";
import { buildHostedLinqCapture } from "./linq.ts";
import { buildHostedTelegramCapture } from "./telegram.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "../models.ts";

export async function ingestHostedConversationMessageWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "platform">;
  vaultRoot: string;
}): Promise<void> {
  const capture = await buildHostedInboxCaptureForConversationWake(input);

  await withHostedInboxPipeline(input.vaultRoot, async (pipeline) => {
    await pipeline.processCapture(capture);
  });
}

async function buildHostedInboxCaptureForConversationWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "platform">;
}) {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    return buildHostedLinqCapture(input.wake);
  }

  if (isHostedTelegramConversationMessageWake(input.wake)) {
    return buildHostedTelegramCapture(input.wake);
  }

  if (isHostedEmailConversationMessageWake(input.wake)) {
    return buildHostedEmailCapture(
      input.wake,
      input.runtime.platform.effectsPort,
    );
  }

  throw new TypeError("Unsupported hosted conversation message wake kind.");
}
