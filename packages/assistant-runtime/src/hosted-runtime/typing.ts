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

const HOSTED_RUN_MESSAGING_ACTIVITY_START_TIMEOUT_MS = 2_000;

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
  linqRefreshMs?: number;
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  startTimeoutMs?: number;
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

  const startRequestedAtMs = Date.now();
  const startAbortController = new AbortController();

  try {
    const indicator = await confirmHostedRunMessagingActivityStarted({
      component,
      run: input.run,
      startAbortController,
      startPromise: adapter.startTypingIndicator!(
        {
          bindingDelivery: null,
          explicitTarget: target.explicitTarget,
          identityId: target.identityId,
        },
        buildHostedMessagingActivityDependencies(input.runtimeEnv, {
          linqRefreshMs: input.linqRefreshMs,
          signal: startAbortController.signal,
        }),
      ),
      startRequestedAtMs,
      startTimeoutMs: normalizeHostedMessagingActivityStartTimeoutMs(input.startTimeoutMs),
      target,
    });

    if (!indicator) {
      return null;
    }

    emitHostedExecutionStructuredLog({
      component,
      details: {
        ...target.logDetails,
        runElapsedMs: computeHostedRunElapsedMs(input.run),
        startLatencyMs: Date.now() - startRequestedAtMs,
      },
      wake: target.wake,
      message: `Hosted ${formatHostedMessagingActivityChannelLabel(target.channel)} typing indicator started.`,
      phase: "wake.running",
      run: input.run,
    });

    return createStartedHostedRunMessagingActivityHandle({
      component,
      indicator,
      run: input.run,
      target,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component,
      details: {
        ...target.logDetails,
        runElapsedMs: computeHostedRunElapsedMs(input.run),
        startLatencyMs: Date.now() - startRequestedAtMs,
      },
      error,
      level: "warn",
      message: `Hosted ${formatHostedMessagingActivityChannelLabel(target.channel)} typing indicator could not be started.`,
      phase: "wake.running",
      run: input.run,
      wake: target.wake,
    });
    return null;
  }
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
  options: {
    linqRefreshMs?: number;
    signal: AbortSignal;
  },
): AssistantChannelDependencies {
  const env = runtimeEnv as NodeJS.ProcessEnv;

  return {
    startLinqTyping: (input) => startLinqTypingIndicator(input, {
      env,
      refreshMs: options.linqRefreshMs,
      signal: options.signal,
    }),
    startTelegramTyping: (input) => startTelegramTypingIndicator(input, {
      env,
      signal: options.signal,
    }),
  };
}

async function confirmHostedRunMessagingActivityStarted(input: {
  component: HostedMessagingActivityComponent;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  startAbortController: AbortController;
  startPromise: Promise<AssistantChannelActivityHandle | null>;
  startRequestedAtMs: number;
  startTimeoutMs: number;
  target: HostedRunMessagingActivityTarget;
}): Promise<AssistantChannelActivityHandle | null> {
  let startCancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const guardedStartPromise = input.startPromise.then(async (indicator) => {
    if (!indicator) {
      return null;
    }

    if (startCancelled) {
      await stopLateHostedMessagingActivityIndicator({
        component: input.component,
        indicator,
        run: input.run,
        target: input.target,
      });
      return null;
    }

    return indicator;
  });

  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      startCancelled = true;
      input.startAbortController.abort();
      emitHostedExecutionStructuredLog({
        component: input.component,
        details: {
          ...input.target.logDetails,
          runElapsedMs: computeHostedRunElapsedMs(input.run),
          startLatencyMs: Date.now() - input.startRequestedAtMs,
          startTimeoutMs: input.startTimeoutMs,
        },
        level: "warn",
        message: `Hosted ${formatHostedMessagingActivityChannelLabel(input.target.channel)} typing indicator start was not confirmed before the timeout.`,
        phase: "wake.running",
        run: input.run,
        wake: input.target.wake,
      });
      resolve(null);
    }, input.startTimeoutMs);
  });

  let indicator: AssistantChannelActivityHandle | null;
  try {
    indicator = await Promise.race([guardedStartPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (!indicator) {
    void guardedStartPromise.catch((error) => {
      if (!startCancelled) {
        emitHostedExecutionStructuredLog({
          component: input.component,
          details: input.target.logDetails,
          error,
          level: "warn",
          message: `Hosted ${formatHostedMessagingActivityChannelLabel(input.target.channel)} typing indicator late start failed after ownership was declined.`,
          phase: "wake.running",
          run: input.run,
          wake: input.target.wake,
        });
      }
    });
  }

  return indicator;
}

function createStartedHostedRunMessagingActivityHandle(input: {
  component: HostedMessagingActivityComponent;
  indicator: AssistantChannelActivityHandle;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  target: HostedRunMessagingActivityTarget;
}): HostedRunMessagingActivityHandle {
  let stopPromise: Promise<void> | null = null;

  return {
    async stop() {
      if (!stopPromise) {
        stopPromise = stopHostedMessagingActivityIndicator({
          component: input.component,
          indicator: input.indicator,
          run: input.run,
          target: input.target,
        });
      }

      await stopPromise;
    },
  };
}

async function stopLateHostedMessagingActivityIndicator(input: {
  component: HostedMessagingActivityComponent;
  indicator: AssistantChannelActivityHandle;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  target: HostedRunMessagingActivityTarget;
}): Promise<void> {
  await stopHostedMessagingActivityIndicator(input);
  emitHostedExecutionStructuredLog({
    component: input.component,
    details: input.target.logDetails,
    level: "warn",
    message: `Hosted ${formatHostedMessagingActivityChannelLabel(input.target.channel)} typing indicator was stopped after a late start because ownership had already been declined.`,
    phase: "side-effects.draining",
    run: input.run,
    wake: input.target.wake,
  });
}

async function stopHostedMessagingActivityIndicator(input: {
  component: HostedMessagingActivityComponent;
  indicator: AssistantChannelActivityHandle;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  target: HostedRunMessagingActivityTarget;
}): Promise<void> {
  try {
    await input.indicator.stop();
  } catch (error) {
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
  }
}

function normalizeHostedMessagingActivityStartTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return HOSTED_RUN_MESSAGING_ACTIVITY_START_TIMEOUT_MS;
  }

  return Math.max(1, Math.trunc(value));
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
