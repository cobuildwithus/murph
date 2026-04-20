import {
  emitHostedExecutionStructuredLog,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionConversationMessageWake,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  parseTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";
import {
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
} from "@murphai/operator-config/linq-runtime";
import {
  startTelegramTypingSession,
} from "@murphai/operator-config/telegram-runtime";

import type {
  HostedAssistantRuntimeJobInput,
} from "./models.ts";
import { computeHostedRunElapsedMs } from "./utils.ts";

type HostedTypingHandle = {
  stop(): Promise<void>;
};

type HostedLinqTypingOperation = "typing_start" | "typing_stop";

type HostedRunTypingIndicator = {
  channelLabel: "Linq" | "Telegram";
  startLogDetails?: Record<string, boolean | string>;
  stopLogDetails?: Record<string, boolean | string>;
  stop(): Promise<void>;
};

export function startHostedRunTypingIndicator(input: {
  wake: HostedRuntimeEvent;
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
}): HostedRunTypingIndicator | null {
  const wake = input.wake;

  if (wake.kind !== "conversation.message") {
    return null;
  }

  if (isHostedLinqConversationMessageWake(wake)) {
    return startHostedLinqRunTypingIndicator({
      ...input,
      wake,
    });
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return startHostedTelegramRunTypingIndicator({
      ...input,
      wake,
    });
  }

  return null;
}

export async function stopHostedRunTypingIndicator(input: {
  wake: HostedRuntimeEvent;
  typingIndicator: HostedRunTypingIndicator | null;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
}): Promise<void> {
  if (!input.typingIndicator) {
    return;
  }

  try {
    await input.typingIndicator.stop();
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: input.typingIndicator.stopLogDetails,
      wake: input.wake,
      error,
      level: "warn",
      message: `Hosted ${input.typingIndicator.channelLabel} typing indicator could not be stopped.`,
      phase: "side-effects.draining",
      run: input.run,
    });
  }
}

function startHostedLinqRunTypingIndicator(input: {
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  wake: HostedExecutionConversationMessageWake & {
    message: {
      channel: "linq";
      linqMessage: {
        chatId: string;
      };
    };
  };
}): HostedRunTypingIndicator | null {
  const env = input.runtimeEnv as NodeJS.ProcessEnv;
  const chatId = input.wake.message.linqMessage.chatId.trim();
  if (chatId.length === 0) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: buildHostedLinqTypingLogDetails("typing_start", false),
      wake: input.wake,
      error: new TypeError("Hosted Linq typing indicator wake is missing a stable chat id."),
      level: "warn",
      message: "Hosted Linq typing indicator could not be started.",
      phase: "wake.running",
      run: input.run,
    });
    return null;
  }

  return createAsyncHostedTypingIndicator({
    channelLabel: "Linq",
    wake: input.wake,
    run: input.run,
    startLogDetails: buildHostedLinqTypingLogDetails("typing_start", true),
    stopLogDetails: buildHostedLinqTypingLogDetails("typing_stop", true),
    start: async () => {
      await startLinqChatTypingIndicator(
        {
          chatId,
        },
        {
          env,
        },
      );

      return {
        async stop() {
          await stopLinqChatTypingIndicator(
            {
              chatId,
            },
            {
              env,
            },
          );
        },
      };
    },
  });
}

function startHostedTelegramRunTypingIndicator(input: {
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  wake: HostedExecutionConversationMessageWake & {
    message: { channel: "telegram"; telegramMessage: { threadId: string } };
  };
}): HostedRunTypingIndicator | null {
  const target = input.wake.message.telegramMessage.threadId;
  const startLogDetails = buildHostedTelegramTypingLogDetails(target);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: startLogDetails,
    wake: input.wake,
    message: "Hosted Telegram typing indicator requested.",
    phase: "wake.running",
    run: input.run,
  });

  return createAsyncHostedTypingIndicator({
    channelLabel: "Telegram",
    wake: input.wake,
    run: input.run,
    startLogDetails,
    start: () => startTelegramTypingSession(
      {
        target,
      },
      {
        env: input.runtimeEnv as NodeJS.ProcessEnv,
      },
    ),
  });
}

function buildHostedLinqTypingLogDetails(
  operation: HostedLinqTypingOperation,
  chatIdPresent: boolean,
): Record<string, boolean | string> {
  return {
    chatIdPresent,
    operation,
    provider: "linq",
  };
}

function createAsyncHostedTypingIndicator(input: {
  channelLabel: HostedRunTypingIndicator["channelLabel"];
  wake: HostedRuntimeEvent;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  startLogDetails?: Record<string, boolean | string>;
  stopLogDetails?: Record<string, boolean | string>;
  start(): Promise<HostedTypingHandle>;
}): HostedRunTypingIndicator {
  let activeIndicator: HostedTypingHandle | null = null;
  let stopRequested = false;
  let stopPromise: Promise<void> | null = null;
  const typingStartRequestedAtMs = Date.now();

  const stopActiveIndicator = (indicator: HostedTypingHandle) => {
    if (!stopPromise) {
      stopPromise = indicator.stop().catch((error) => {
        emitHostedExecutionStructuredLog({
          component: "runtime",
          details: input.stopLogDetails,
          wake: input.wake,
          error,
          level: "warn",
          message: `Hosted ${input.channelLabel} typing indicator could not be stopped.`,
          phase: "side-effects.draining",
          run: input.run,
        });
      });
    }

    return stopPromise;
  };

  const startPromise = input.start()
    .then(async (indicator) => {
      activeIndicator = indicator;
      emitHostedExecutionStructuredLog({
        component: "runtime",
        details: {
          ...(input.startLogDetails ?? {}),
          runElapsedMs: computeHostedRunElapsedMs(input.run),
          startLatencyMs: Date.now() - typingStartRequestedAtMs,
        },
        wake: input.wake,
        message: `Hosted ${input.channelLabel} typing indicator started.`,
        phase: "wake.running",
        run: input.run,
      });
      if (stopRequested) {
        await stopActiveIndicator(indicator);
      }
    })
    .catch((error: unknown) => {
      emitHostedExecutionStructuredLog({
        component: "runtime",
        details: input.startLogDetails,
        wake: input.wake,
        error,
        level: "warn",
        message: `Hosted ${input.channelLabel} typing indicator could not be started.`,
        phase: "wake.running",
        run: input.run,
      });
    });

  return {
    channelLabel: input.channelLabel,
    startLogDetails: input.startLogDetails,
    stopLogDetails: input.stopLogDetails,
    async stop() {
      if (stopRequested) {
        await (stopPromise ?? startPromise);
        return;
      }

      stopRequested = true;
      if (activeIndicator) {
        const indicator = activeIndicator;
        activeIndicator = null;
        await stopActiveIndicator(indicator);
        return;
      }

      await startPromise;
      if (activeIndicator) {
        const indicator = activeIndicator;
        activeIndicator = null;
        await stopActiveIndicator(indicator);
      }
    },
  };
}

function buildHostedTelegramTypingLogDetails(target: string): Record<string, boolean | string> {
  const parsedTarget = parseHostedTelegramTypingTarget(target);
  return {
    provider: "telegram",
    targetBusinessConnectionPresent: parsedTarget.businessConnectionPresent,
    targetDirectMessagesTopicPresent: parsedTarget.directMessagesTopicPresent,
    targetMessageThreadPresent: parsedTarget.messageThreadPresent,
    targetParseable: parsedTarget.parseable,
  };
}

function parseHostedTelegramTypingTarget(target: string): {
  businessConnectionPresent: boolean;
  directMessagesTopicPresent: boolean;
  messageThreadPresent: boolean;
  parseable: boolean;
} {
  const parsedTarget = parseTelegramThreadTarget(target);
  if (!parsedTarget) {
    return {
      businessConnectionPresent: target.includes(":business:"),
      directMessagesTopicPresent: target.includes(":dm-topic:"),
      messageThreadPresent: target.includes(":topic:"),
      parseable: false,
    };
  }

  return {
    businessConnectionPresent: parsedTarget.businessConnectionId != null,
    directMessagesTopicPresent: parsedTarget.directMessagesTopicId != null,
    messageThreadPresent: parsedTarget.messageThreadId != null,
    parseable: true,
  };
}
