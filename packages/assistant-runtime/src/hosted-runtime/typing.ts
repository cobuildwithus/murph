import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseCanonicalLinqMessageReceivedEvent,
  parseLinqWebhookEvent,
} from "@murphai/messaging-ingress/linq-webhook";
import {
  parseTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";
import {
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
} from "@murphai/operator-config/linq-runtime";
import {
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
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

const HOSTED_TELEGRAM_TYPING_REFRESH_MS = 4_000;
const HOSTED_TELEGRAM_API_BASE_URL = "https://api.telegram.org";

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

  let active = false;
  let stopRequested = false;
  let stopPromise: Promise<void> | null = null;

  const runStop = () => {
    if (!stopPromise) {
      stopPromise = stopLinqChatTypingIndicator(
        {
          chatId,
        },
        {
          env,
        },
      )
        .catch((error) => {
          emitHostedExecutionStructuredLog({
            component: "runtime",
            dispatch: input.dispatch,
            error,
            level: "warn",
            message: "Hosted Linq typing indicator could not be stopped.",
            phase: "side-effects.draining",
            run: input.run,
          });
        })
        .finally(() => {
          active = false;
        });
    }

    return stopPromise;
  };

  const startPromise = startLinqChatTypingIndicator(
    {
      chatId,
    },
    {
      env,
    },
  )
    .then(async () => {
      active = true;
      if (stopRequested) {
        await runStop();
      }
    })
    .catch((error) => {
      emitHostedExecutionStructuredLog({
        component: "runtime",
        dispatch: input.dispatch,
        error,
        level: "warn",
        message: "Hosted Linq typing indicator could not be started.",
        phase: "dispatch.running",
        run: input.run,
      });
    });

  return {
    channelLabel: "Linq",
    async stop() {
      if (stopRequested) {
        await (stopPromise ?? startPromise);
        return;
      }

      stopRequested = true;
      if (active) {
        await runStop();
        return;
      }

      await startPromise;
      if (active) {
        await runStop();
      }
    },
  };
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
}): HostedDispatchTypingIndicator {
  const env = input.runtimeEnv as NodeJS.ProcessEnv;
  const token = resolveTelegramBotToken(env);
  const fetchImplementation = globalThis.fetch?.bind(globalThis);
  const target = parseTelegramThreadTarget(input.dispatch.event.telegramMessage.threadId);
  if (!token || typeof fetchImplementation !== "function" || !target) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      dispatch: input.dispatch,
      error: new Error("Hosted Telegram typing indicator prerequisites are unavailable."),
      level: "warn",
      message: "Hosted Telegram typing indicator could not be started.",
      phase: "dispatch.running",
      run: input.run,
    });
    return {
      channelLabel: "Telegram",
      async stop() {},
    };
  }

  const baseUrl = (resolveTelegramApiBaseUrl(env) ?? HOSTED_TELEGRAM_API_BASE_URL).replace(
    /\/$/u,
    "",
  );
  let activeIndicator: HostedTypingHandle | null = null;
  let stopRequested = false;

  const stopActiveIndicator = async (indicator: HostedTypingHandle) => {
    try {
      await indicator.stop();
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runtime",
        dispatch: input.dispatch,
        error,
        level: "warn",
        message: "Hosted Telegram typing indicator could not be stopped.",
        phase: "side-effects.draining",
        run: input.run,
      });
    }
  };

  const startPromise = createHostedTelegramTypingHandle({
    baseUrl,
    fetchImplementation,
    target,
    token,
  })
    .then(async (indicator: HostedTypingHandle) => {
      if (stopRequested) {
        await stopActiveIndicator(indicator);
        return null;
      }

      activeIndicator = indicator;
      return indicator;
    })
    .catch((error: unknown) => {
      emitHostedExecutionStructuredLog({
        component: "runtime",
        dispatch: input.dispatch,
        error,
        level: "warn",
        message: "Hosted Telegram typing indicator could not be started.",
        phase: "dispatch.running",
        run: input.run,
      });
      return null;
    });

  return {
    channelLabel: "Telegram",
    async stop() {
      if (stopRequested) {
        await startPromise;
        return;
      }

      stopRequested = true;
      if (activeIndicator) {
        const indicator = activeIndicator;
        activeIndicator = null;
        await stopActiveIndicator(indicator);
        return;
      }

      const indicator = await startPromise;
      if (indicator) {
        activeIndicator = null;
        await stopActiveIndicator(indicator);
      }
    },
  };
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

async function createHostedTelegramTypingHandle(input: {
  baseUrl: string;
  fetchImplementation: typeof globalThis.fetch;
  target: NonNullable<ReturnType<typeof parseTelegramThreadTarget>>;
  token: string;
}): Promise<HostedTypingHandle> {
  const stopController = new AbortController();

  await sendHostedTelegramTypingIndicatorOnce({
    ...input,
    signal: stopController.signal,
  });

  const running = keepHostedTelegramTypingIndicatorAlive({
    ...input,
    signal: stopController.signal,
  });

  return {
    async stop() {
      stopController.abort();
      await running;
    },
  };
}

async function keepHostedTelegramTypingIndicatorAlive(input: {
  baseUrl: string;
  fetchImplementation: typeof globalThis.fetch;
  signal: AbortSignal;
  target: NonNullable<ReturnType<typeof parseTelegramThreadTarget>>;
  token: string;
}): Promise<void> {
  while (!input.signal.aborted) {
    await waitForHostedTelegramTypingRefresh(input.signal);
    if (input.signal.aborted) {
      return;
    }

    await sendHostedTelegramTypingIndicatorOnce(input);
  }
}

async function waitForHostedTelegramTypingRefresh(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, HOSTED_TELEGRAM_TYPING_REFRESH_MS);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function sendHostedTelegramTypingIndicatorOnce(input: {
  baseUrl: string;
  fetchImplementation: typeof globalThis.fetch;
  signal: AbortSignal;
  target: NonNullable<ReturnType<typeof parseTelegramThreadTarget>>;
  token: string;
}): Promise<void> {
  const response = await input.fetchImplementation(
    `${input.baseUrl}/bot${input.token}/sendChatAction`,
    {
      body: JSON.stringify({
        action: "typing",
        business_connection_id: input.target.businessConnectionId ?? undefined,
        chat_id: input.target.chatId,
        direct_messages_topic_id: input.target.directMessagesTopicId ?? undefined,
        message_thread_id: input.target.messageThreadId ?? undefined,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
      signal: input.signal,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Hosted Telegram typing indicator failed with ${response.status} ${response.statusText}.`,
    );
  }

  const payload = await response.json() as {
    description?: string;
    ok?: boolean;
  };
  if (payload.ok !== true) {
    throw new Error(
      payload.description ?? "Hosted Telegram typing indicator returned an invalid response.",
    );
  }
}
