import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseCanonicalLinqMessageReceivedEvent,
  parseLinqWebhookEvent,
} from "@murphai/messaging-ingress/linq-webhook";
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

type HostedTypingHandle = {
  stop(): Promise<void>;
};

type HostedLinqTypingOperation = "typing_start" | "typing_stop";

type HostedDispatchTypingIndicator = {
  channelLabel: "Linq" | "Telegram";
  startLogDetails?: Record<string, boolean | string>;
  stopLogDetails?: Record<string, boolean | string>;
  stop(): Promise<void>;
};

export function startHostedDispatchTypingIndicator(input: {
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"];
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
}): HostedDispatchTypingIndicator | null {
  if (isHostedLinqMessageReceivedDispatch(input.dispatch)) {
    return startHostedLinqDispatchTypingIndicator({
      ...input,
      dispatch: input.dispatch,
    });
  }

  if (isHostedTelegramMessageReceivedDispatch(input.dispatch)) {
    return startHostedTelegramDispatchTypingIndicator({
      ...input,
      dispatch: input.dispatch,
    });
  }

  return null;
}

export async function stopHostedDispatchTypingIndicator(input: {
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"];
  typingIndicator: HostedDispatchTypingIndicator | null;
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
      dispatch: input.dispatch,
      error,
      level: "warn",
      message: `Hosted ${input.typingIndicator.channelLabel} typing indicator could not be stopped.`,
      phase: "side-effects.draining",
      run: input.run,
    });
  }
}

function startHostedLinqDispatchTypingIndicator(input: {
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"] & {
    event: Extract<
      HostedAssistantRuntimeJobInput["request"]["dispatch"]["event"],
      { kind: "linq.message.received" }
    >;
  };
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
}): HostedDispatchTypingIndicator | null {
  const env = input.runtimeEnv as NodeJS.ProcessEnv;

  let chatId: string;
  try {
    const event = parseCanonicalLinqMessageReceivedEvent(
      parseLinqWebhookEvent(JSON.stringify(input.dispatch.event.linqEvent)),
    );
    chatId = event.data.chat_id;
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: buildHostedLinqTypingLogDetails("typing_start", false),
      dispatch: input.dispatch,
      error,
      level: "warn",
      message: "Hosted Linq typing indicator could not be started.",
      phase: "dispatch.running",
      run: input.run,
    });
    return null;
  }

  return createAsyncHostedTypingIndicator({
    channelLabel: "Linq",
    dispatch: input.dispatch,
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

function startHostedTelegramDispatchTypingIndicator(input: {
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"] & {
    event: Extract<
      HostedAssistantRuntimeJobInput["request"]["dispatch"]["event"],
      { kind: "telegram.message.received" }
    >;
  };
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
}): HostedDispatchTypingIndicator | null {
  return createAsyncHostedTypingIndicator({
    channelLabel: "Telegram",
    dispatch: input.dispatch,
    run: input.run,
    start: () => startTelegramTypingSession(
      {
        target: input.dispatch.event.telegramMessage.threadId,
      },
      {
        env: input.runtimeEnv as NodeJS.ProcessEnv,
      },
    ),
  });
}

function isHostedLinqMessageReceivedDispatch(
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"],
): dispatch is HostedAssistantRuntimeJobInput["request"]["dispatch"] & {
  event: Extract<
    HostedAssistantRuntimeJobInput["request"]["dispatch"]["event"],
    { kind: "linq.message.received" }
  >;
} {
  return dispatch.event.kind === "linq.message.received";
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
  channelLabel: HostedDispatchTypingIndicator["channelLabel"];
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"];
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  startLogDetails?: Record<string, boolean | string>;
  stopLogDetails?: Record<string, boolean | string>;
  start(): Promise<HostedTypingHandle>;
}): HostedDispatchTypingIndicator {
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
          dispatch: input.dispatch,
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
        dispatch: input.dispatch,
        message: `Hosted ${input.channelLabel} typing indicator started.`,
        phase: "dispatch.running",
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
        dispatch: input.dispatch,
        error,
        level: "warn",
        message: `Hosted ${input.channelLabel} typing indicator could not be started.`,
        phase: "dispatch.running",
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

function computeHostedRunElapsedMs(
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null,
): number | null {
  if (!run?.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, Date.now() - startedAtMs);
}

function isHostedTelegramMessageReceivedDispatch(
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"],
): dispatch is HostedAssistantRuntimeJobInput["request"]["dispatch"] & {
  event: Extract<
    HostedAssistantRuntimeJobInput["request"]["dispatch"]["event"],
    { kind: "telegram.message.received" }
  >;
} {
  return dispatch.event.kind === "telegram.message.received";
}
