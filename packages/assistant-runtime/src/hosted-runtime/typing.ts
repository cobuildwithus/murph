import {
  getAssistantChannelAdapter,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
  type AssistantChannelActivityHandle,
  type AssistantChannelDependencies,
} from "@murphai/assistant-engine/assistant-channel-adapters";
import {
  stopLinqChatTypingIndicator,
} from "@murphai/operator-config/linq-runtime";
import {
  emitHostedExecutionStructuredLog,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionConversationMessageWake,
  type HostedRuntimeEvent,
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
  ownsRuntimeActivity: boolean;
  stop(): Promise<void>;
};

type HostedMessagingActivityChannel = "linq" | "telegram" | "email";

const HOSTED_RUN_MESSAGING_ACTIVITY_START_TIMEOUT_MS = 2_000;
const HOSTED_RUN_MESSAGING_ACTIVITY_LATE_CLEANUP_TIMEOUT_MS = 2_000;

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
  platformEnv?: Readonly<Record<string, string>>;
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

  const startTimeoutMs = normalizeHostedMessagingActivityStartTimeoutMs(input.startTimeoutMs);
  const startRequestedAtMs = Date.now();
  const startAbortController = new AbortController();

  emitHostedExecutionStructuredLog({
    component,
    details: {
      ...target.logDetails,
      runElapsedMs: computeHostedRunElapsedMs(input.run),
      startTimeoutMs,
    },
    message: `Hosted ${formatHostedMessagingActivityChannelLabel(target.channel)} typing indicator start requested.`,
    phase: "wake.running",
    run: input.run,
    wake: target.wake,
  });

  try {
    const activity = await confirmHostedRunMessagingActivityStarted({
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
          platformEnv: input.platformEnv,
          signal: startAbortController.signal,
        }),
      ),
      startRequestedAtMs,
      startTimeoutMs,
      target,
    });

    if (!activity) {
      return null;
    }

    if (activity.ownsRuntimeActivity) {
      emitHostedExecutionStructuredLog({
        component,
        details: {
          ...target.logDetails,
          runElapsedMs: computeHostedRunElapsedMs(input.run),
          startLatencyMs: Date.now() - startRequestedAtMs,
          startTimeoutMs,
        },
        wake: target.wake,
        message: `Hosted ${formatHostedMessagingActivityChannelLabel(target.channel)} typing indicator started.`,
        phase: "wake.running",
        run: input.run,
      });
    }

    return activity;
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component,
      details: {
        ...target.logDetails,
        runElapsedMs: computeHostedRunElapsedMs(input.run),
        startLatencyMs: Date.now() - startRequestedAtMs,
        startTimeoutMs,
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

export async function stopExecutorOwnedHostedRunMessagingActivityAfterDelivery(input: {
  component?: HostedMessagingActivityComponent;
  runtimeEnv: Readonly<Record<string, string>>;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  wake: HostedRuntimeEvent;
}): Promise<void> {
  if (shouldStartRuntimeHostedRunMessagingActivity(input.runtimeEnv)) {
    return;
  }

  const target = resolveHostedMessagingActivityTarget(input.wake, "post-commit-delivery");
  if (!target || target.channel !== "linq") {
    return;
  }

  const component = input.component ?? "runtime";

  try {
    await stopLinqChatTypingIndicator(
      {
        chatId: target.explicitTarget,
      },
      {
        env: input.runtimeEnv,
      },
    );

    emitHostedExecutionStructuredLog({
      component,
      details: {
        ...target.logDetails,
        runElapsedMs: computeHostedRunElapsedMs(input.run),
      },
      message: "Hosted Linq typing indicator stopped immediately after committed assistant delivery.",
      phase: "side-effects.draining",
      run: input.run,
      wake: target.wake,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component,
      details: {
        ...target.logDetails,
        runElapsedMs: computeHostedRunElapsedMs(input.run),
      },
      error,
      level: "warn",
      message:
        "Hosted Linq typing indicator could not be stopped immediately after committed assistant delivery.",
      phase: "side-effects.draining",
      run: input.run,
      wake: target.wake,
    });
  }
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
    platformEnv?: Readonly<Record<string, string>>;
    signal: AbortSignal;
  },
): AssistantChannelDependencies {
  const env = runtimeEnv as NodeJS.ProcessEnv;
  const telegramEnv = {
    ...runtimeEnv,
    ...(options.platformEnv ?? {}),
  } as NodeJS.ProcessEnv;

  return {
    startLinqTyping: (input) => startLinqTypingIndicator(input, {
      env,
      refreshMs: options.linqRefreshMs,
      signal: options.signal,
    }),
    startTelegramTyping: (input) => startTelegramTypingIndicator(input, {
      env: telegramEnv,
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
}): Promise<HostedRunMessagingActivityHandle | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const startOutcomePromise = input.startPromise.then((indicator) => ({
    indicator,
    kind: "started" as const,
  }));

  const timeoutPromise = new Promise<{
    kind: "timeout";
  }>((resolve) => {
    timeoutId = setTimeout(() => {
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
      resolve({
        kind: "timeout",
      });
    }, input.startTimeoutMs);
  });

  let outcome:
    | {
        indicator: AssistantChannelActivityHandle | null;
        kind: "started";
      }
    | {
        kind: "timeout";
      };
  try {
    outcome = await Promise.race([startOutcomePromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (outcome.kind === "timeout") {
    return createHostedRunMessagingActivityHandle({
      component: input.component,
      indicatorPromise: startOutcomePromise
        .then((startOutcome) => startOutcome.indicator)
        .catch(() => null),
      ownsRuntimeActivity: false,
      run: input.run,
      target: input.target,
    });
  }

  if (!outcome.indicator) {
    return null;
  }

  return createHostedRunMessagingActivityHandle({
    component: input.component,
    indicatorPromise: Promise.resolve(outcome.indicator),
    ownsRuntimeActivity: true,
    run: input.run,
    target: input.target,
  });
}

function createHostedRunMessagingActivityHandle(input: {
  component: HostedMessagingActivityComponent;
  indicatorPromise: Promise<AssistantChannelActivityHandle | null>;
  ownsRuntimeActivity: boolean;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  target: HostedRunMessagingActivityTarget;
}): HostedRunMessagingActivityHandle {
  let stopPromise: Promise<void> | null = null;

  return {
    ownsRuntimeActivity: input.ownsRuntimeActivity,
    async stop() {
      if (!stopPromise) {
        stopPromise = (async () => {
          const indicator = await resolveHostedMessagingActivityIndicatorForStop(input);
          if (!indicator) {
            return;
          }

          await stopHostedMessagingActivityIndicator({
            component: input.component,
            indicator,
            run: input.run,
            target: input.target,
          });
        })();
      }

      await stopPromise;
    },
  };
}

async function resolveHostedMessagingActivityIndicatorForStop(input: {
  component: HostedMessagingActivityComponent;
  indicatorPromise: Promise<AssistantChannelActivityHandle | null>;
  ownsRuntimeActivity: boolean;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  target: HostedRunMessagingActivityTarget;
}): Promise<AssistantChannelActivityHandle | null> {
  if (input.ownsRuntimeActivity) {
    return input.indicatorPromise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const indicatorOutcomePromise = input.indicatorPromise.then((indicator) => ({
    indicator,
    kind: "indicator" as const,
  }));
  const timeoutPromise = new Promise<{
    kind: "timeout";
  }>((resolve) => {
    timeoutId = setTimeout(() => {
      emitHostedExecutionStructuredLog({
        component: input.component,
        details: {
          ...input.target.logDetails,
          cleanupTimeoutMs: HOSTED_RUN_MESSAGING_ACTIVITY_LATE_CLEANUP_TIMEOUT_MS,
        },
        level: "warn",
        message: `Hosted ${formatHostedMessagingActivityChannelLabel(input.target.channel)} typing indicator cleanup stopped waiting for a late start handle after the cleanup timeout.`,
        phase: "side-effects.draining",
        run: input.run,
        wake: input.target.wake,
      });
      resolve({
        kind: "timeout",
      });
    }, HOSTED_RUN_MESSAGING_ACTIVITY_LATE_CLEANUP_TIMEOUT_MS);
  });

  const outcome = await Promise.race([indicatorOutcomePromise, timeoutPromise]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  if (outcome.kind === "timeout") {
    void indicatorOutcomePromise.then(async (lateOutcome) => {
      if (!lateOutcome.indicator) {
        return;
      }

      await stopHostedMessagingActivityIndicator({
        component: input.component,
        indicator: lateOutcome.indicator,
        run: input.run,
        target: input.target,
      });
    });
    return null;
  }

  return outcome.indicator;
}

async function stopHostedMessagingActivityIndicator(input: {
  component: HostedMessagingActivityComponent;
  indicator: AssistantChannelActivityHandle;
  run: HostedAssistantRuntimeJobInput["request"]["run"] | null;
  target: HostedRunMessagingActivityTarget;
}): Promise<void> {
  try {
    await input.indicator.stop();
    emitHostedExecutionStructuredLog({
      component: input.component,
      details: {
        ...input.target.logDetails,
        runElapsedMs: computeHostedRunElapsedMs(input.run),
      },
      message: `Hosted ${formatHostedMessagingActivityChannelLabel(input.target.channel)} typing indicator stopped.`,
      phase: "side-effects.draining",
      run: input.run,
      wake: input.target.wake,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: input.component,
      details: {
        ...input.target.logDetails,
        runElapsedMs: computeHostedRunElapsedMs(input.run),
      },
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
