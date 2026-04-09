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

type HostedDispatchTypingIndicator = {
  channelLabel: "Linq" | "Telegram";
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

function createAsyncHostedTypingIndicator(input: {
  channelLabel: HostedDispatchTypingIndicator["channelLabel"];
  dispatch: HostedAssistantRuntimeJobInput["request"]["dispatch"];
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  start(): Promise<HostedTypingHandle>;
}): HostedDispatchTypingIndicator {
  let activeIndicator: HostedTypingHandle | null = null;
  let stopRequested = false;
  let stopPromise: Promise<void> | null = null;

  const stopActiveIndicator = (indicator: HostedTypingHandle) => {
    if (!stopPromise) {
      stopPromise = indicator.stop().catch((error) => {
        emitHostedExecutionStructuredLog({
          component: "runtime",
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
      if (stopRequested) {
        await stopActiveIndicator(indicator);
      }
    })
    .catch((error: unknown) => {
      emitHostedExecutionStructuredLog({
        component: "runtime",
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
