import {
  getAssistantChannelAdapter,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
  type AssistantChannelActivityHandle,
  type AssistantChannelDependencies,
} from "@murphai/assistant-engine/assistant-channel-adapters";
import {
  emitHostedExecutionStructuredLog,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionConversationMessageWake,
  type HostedRuntimeDrainEvent,
} from "@murphai/hosted-execution";
import {
  parseTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";

import type {
  HostedAssistantRuntimeJobInput,
} from "./models.ts";
import { computeHostedRunElapsedMs } from "./utils.ts";

export const HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_ENV =
  "HOSTED_RUN_MESSAGING_ACTIVITY_OWNER";
export const HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_EXECUTOR = "executor";

export type HostedMessagingActivityComponent = "runtime" | "runner";

export type HostedRunMessagingActivityHandle = {
  stop(): Promise<void>;
};

type HostedMessagingActivityChannel = "linq" | "telegram" | "email";

export interface HostedRunMessagingActivityTarget {
  channel: HostedMessagingActivityChannel;
  explicitTarget: string;
  identityId: string | null;
  logDetails: Record<string, boolean | string>;
  sourceSeq: string;
  wake: HostedExecutionConversationMessageWake;
}

export function shouldStartRuntimeHostedRunMessagingActivity(
  runtimeEnv: Readonly<Record<string, string>>,
): boolean {
  return runtimeEnv[HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_ENV]
    !== HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_EXECUTOR;
}

export async function startHostedRunMessagingActivity(input: {
  component?: HostedMessagingActivityComponent;
  events: readonly HostedRuntimeDrainEvent[];
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
}): Promise<HostedRunMessagingActivityHandle | null> {
  const target = selectHostedRunMessagingActivityTarget(input.events);
  if (!target) {
    return null;
  }

  const component = input.component ?? "runtime";
  const adapter = getAssistantChannelAdapter(target.channel);
  if (!adapter?.startTypingIndicator) {
    return null;
  }

  return createAsyncHostedRunMessagingActivityHandle({
    component,
    run: input.run,
    start: () => adapter.startTypingIndicator!(
      {
        bindingDelivery: null,
        explicitTarget: target.explicitTarget,
        identityId: target.identityId,
      },
      buildHostedMessagingActivityDependencies(input.runtimeEnv),
    ),
    target,
  });
}

export async function stopHostedRunMessagingActivity(input: {
  activity: HostedRunMessagingActivityHandle | null;
}): Promise<void> {
  await input.activity?.stop();
}

export function selectHostedRunMessagingActivityTarget(
  events: readonly HostedRuntimeDrainEvent[],
): HostedRunMessagingActivityTarget | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) {
      continue;
    }

    const target = resolveHostedMessagingActivityTarget(event.wake, event.seq);
    if (target) {
      return target;
    }
  }

  return null;
}

function resolveHostedMessagingActivityTarget(
  wake: HostedRuntimeDrainEvent["wake"],
  sourceSeq: string,
): HostedRunMessagingActivityTarget | null {
  if (wake.kind !== "conversation.message") {
    return null;
  }

  if (isHostedLinqConversationMessageWake(wake)) {
    const chatId = wake.message.linqMessage.chatId.trim();
    if (chatId.length === 0) {
      return null;
    }

    return {
      channel: "linq",
      explicitTarget: chatId,
      identityId: null,
      logDetails: {
        chatIdPresent: true,
        provider: "linq",
        sourceSeq,
      },
      sourceSeq,
      wake,
    };
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    const target = wake.message.telegramMessage.threadId.trim();
    if (target.length === 0) {
      return null;
    }

    return {
      channel: "telegram",
      explicitTarget: target,
      identityId: null,
      logDetails: {
        ...buildHostedTelegramTypingLogDetails(target),
        sourceSeq,
      },
      sourceSeq,
      wake,
    };
  }

  return null;
}

function buildHostedMessagingActivityDependencies(
  runtimeEnv: Readonly<Record<string, string>>,
): AssistantChannelDependencies {
  const env = runtimeEnv as NodeJS.ProcessEnv;

  return {
    startLinqTyping: (input) => startLinqTypingIndicator(input, { env }),
    startTelegramTyping: (input) => startTelegramTypingIndicator(input, { env }),
  };
}

function createAsyncHostedRunMessagingActivityHandle(input: {
  component: HostedMessagingActivityComponent;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  start(): Promise<AssistantChannelActivityHandle | null>;
  target: HostedRunMessagingActivityTarget;
}): HostedRunMessagingActivityHandle {
  let activeIndicator: AssistantChannelActivityHandle | null = null;
  let stopRequested = false;
  let stopPromise: Promise<void> | null = null;
  const startRequestedAtMs = Date.now();

  const stopActiveIndicator = (indicator: AssistantChannelActivityHandle) => {
    if (!stopPromise) {
      stopPromise = indicator.stop().catch((error) => {
        emitHostedExecutionStructuredLog({
          component: input.component,
          details: input.target.logDetails,
          error,
          level: "warn",
          message: `Hosted ${formatHostedMessagingActivityChannelLabel(input.target.channel)} typing indicator could not be stopped.`,
          phase: "side-effects.draining",
          run: input.run,
          wake: input.target.wake,
        });
      });
    }

    return stopPromise;
  };

  const startPromise = input.start()
    .then(async (indicator) => {
      if (!indicator) {
        return;
      }

      activeIndicator = indicator;
      emitHostedExecutionStructuredLog({
        component: input.component,
        details: {
          ...input.target.logDetails,
          runElapsedMs: computeHostedRunElapsedMs(input.run),
          startLatencyMs: Date.now() - startRequestedAtMs,
        },
        wake: input.target.wake,
        message: `Hosted ${formatHostedMessagingActivityChannelLabel(input.target.channel)} typing indicator started.`,
        phase: "wake.running",
        run: input.run,
      });
      if (stopRequested) {
        await stopActiveIndicator(indicator);
      }
    })
    .catch((error) => {
      emitHostedExecutionStructuredLog({
        component: input.component,
        details: input.target.logDetails,
        error,
        level: "warn",
        message: `Hosted ${formatHostedMessagingActivityChannelLabel(input.target.channel)} typing indicator could not be started.`,
        phase: "wake.running",
        run: input.run,
        wake: input.target.wake,
      });
    });

  let stopped = false;

  return {
    async stop() {
      if (stopped) {
        await (stopPromise ?? startPromise);
        return;
      }

      stopped = true;

      if (activeIndicator) {
        const indicator = activeIndicator;
        activeIndicator = null;
        await stopActiveIndicator(indicator);
        return;
      }

      stopRequested = true;
      await startPromise;
      if (activeIndicator) {
        const indicator = activeIndicator;
        activeIndicator = null;
        await stopActiveIndicator(indicator);
      }
    },
  };
}

function formatHostedMessagingActivityChannelLabel(channel: HostedMessagingActivityChannel): string {
  switch (channel) {
    case "linq":
      return "Linq";
    case "telegram":
      return "Telegram";
    case "email":
      return "Email";
  }

  return channel;
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
