import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  createParsedInboxPipeline,
  openInboxRuntime,
} from "@murphai/inboxd";
import { createConfiguredParserRegistry } from "@murphai/parsers";

import { buildHostedEmailCapture } from "./email.ts";
import { buildHostedLinqCapture } from "./linq.ts";
import { buildHostedTelegramCapture } from "./telegram.ts";
import type {
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "../models.ts";

export async function ingestHostedConversationMessageWake(input: {
  wake: HostedExecutionConversationMessageWake;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "platform">;
  vaultRoot: string;
}): Promise<HostedConversationWakeMetrics> {
  const capture = await buildHostedInboxCaptureForConversationWake(input);
  const runtime = await openInboxRuntime({
    vaultRoot: input.vaultRoot,
  });
  let parserProcessed = 0;
  let pipeline: Awaited<ReturnType<typeof createParsedInboxPipeline>> | null = null;

  try {
    const configured = await createConfiguredParserRegistry({
      vaultRoot: input.vaultRoot,
    });
    pipeline = await createParsedInboxPipeline({
      ffmpeg: configured.ffmpeg,
      onParserDrain(results) {
        parserProcessed += results.length;
      },
      registry: configured.registry,
      runtime,
      vaultRoot: input.vaultRoot,
    });
    await pipeline.processCapture(capture);

    return {
      nextWakeAt: null,
      parserProcessed,
    };
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
  }
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
