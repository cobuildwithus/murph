import type {
  AssistantChannelTypingDependencies,
} from "@murphai/assistant-engine";
import {
  getAssistantChannelAdapter,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from "@murphai/assistant-engine/assistant-channel-adapters";
import {
  HOSTED_ELEVENLABS_ENV_NAMES,
} from "@murphai/hosted-execution/assistant-capabilities";

import {
  requireHostedProviderFetchDependencies,
} from "./provider-fetch.ts";
import {
  resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest,
  type HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";
import {
  recordHostedAssistantMilestonesBestEffort,
  type HostedAssistantMilestoneTraceContext,
} from "./assistant-latency-trace.ts";

const HOSTED_TELEGRAM_CHANNEL_ENV_KEYS = [
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_FILE_BASE_URL",
] as const;

const HOSTED_LINQ_TYPING_MAX_SESSION_MS = 5 * 60_000;
const HOSTED_LINQ_TYPING_REFRESH_MS = 45_000;
const HOSTED_LINQ_TYPING_RESTART_COOLDOWN_MS = 10 * 60_000;

type HostedLinqTypingTargetState = {
  activeUntilMs: number;
  cooldownUntilMs: number;
  stoppingAtMs?: number;
  cleanup?: () => void;
  preparation?: {
    assistantInputId: string;
    providerFetch: typeof fetch;
    stop(): void;
    take(signal?: AbortSignal): Promise<HostedLinqTypingHandle | undefined>;
  };
};

type HostedLinqTypingHandle = NonNullable<Awaited<ReturnType<typeof startLinqTypingIndicator>>>;
type HostedChannelTypingInput = Parameters<typeof createHostedAssistantChannelTypingDependencies>[0];

const hostedLinqTypingTargets = new Map<string, HostedLinqTypingTargetState>();
export function buildHostedLinqChannelEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  userEnv: Readonly<Record<string, string>>;
}): Record<string, string> {
  const env: Record<string, string> = {};

  const userToken = readHostedChannelEnvValue(input.userEnv, "LINQ_API_TOKEN");
  if (userToken) {
    const userBaseUrl = readHostedChannelEnvValue(input.userEnv, "LINQ_API_BASE_URL");
    const forwardedBaseUrl = readHostedChannelEnvValue(input.forwardedEnv, "LINQ_API_BASE_URL");
    const baseUrl = userBaseUrl ?? forwardedBaseUrl;
    if (baseUrl) {
      env.LINQ_API_BASE_URL = baseUrl;
    }
    env.LINQ_API_TOKEN = userToken;
    return env;
  }

  const forwardedBaseUrl = readHostedChannelEnvValue(input.forwardedEnv, "LINQ_API_BASE_URL");
  const forwardedToken = readHostedChannelEnvValue(input.forwardedEnv, "LINQ_API_TOKEN");
  if (forwardedBaseUrl) {
    env.LINQ_API_BASE_URL = forwardedBaseUrl;
  }
  if (forwardedToken) {
    env.LINQ_API_TOKEN = forwardedToken;
  }
  return env;
}

export function buildHostedTelegramChannelEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const source = {
    ...input.forwardedEnv,
    ...(input.platformEnv ?? {}),
  };
  return pickHostedChannelEnv(source, HOSTED_TELEGRAM_CHANNEL_ENV_KEYS);
}

export function buildHostedTelegramVoiceMemoChannelEnv(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  platformEnv?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const source = {
    ...input.forwardedEnv,
    ...(input.platformEnv ?? {}),
  };
  return {
    ...pickHostedChannelEnv(source, HOSTED_TELEGRAM_CHANNEL_ENV_KEYS),
    ...pickHostedChannelEnv(source, HOSTED_ELEVENLABS_ENV_NAMES),
  };
}

export function createHostedAssistantChannelTypingDependencies(input: {
  forwardedEnv: Readonly<Record<string, string>>;
  latencyTraceContext?: HostedAssistantMilestoneTraceContext | null;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  platformEnv?: Readonly<Record<string, string>>;
  providerFetch?: typeof fetch | null;
  signal?: AbortSignal;
  userEnv: Readonly<Record<string, string>>;
}): AssistantChannelTypingDependencies {
  return {
    onTypingAccepted: ({ acceptedInputIds, at, channel }) => {
      if ((channel !== "linq" && channel !== "telegram") || input.signal?.aborted) return;
      recordHostedAssistantMilestonesBestEffort({
        context: input.latencyTraceContext ? {
          ...input.latencyTraceContext,
          assistantInputIds: acceptedInputIds,
          source: channel,
        } : null,
        milestones: [{
          at,
          milestone: channel === "telegram" ? "telegram_typing_accepted" : "linq_typing_accepted",
        }],
      });
    },
    startLinqTyping: async (request) => {
      const linqDeliveryContexts = input.linqDeliveryContexts ?? [];
      const deliveryContext = resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
        contexts: linqDeliveryContexts,
        replyToMessageId: request.replyToMessageId ?? null,
        target: request.target,
        targetKind: request.targetKind ?? "thread",
      });
      if (!deliveryContext) {
        return undefined;
      }
      if (!input.providerFetch) {
        return undefined;
      }
      const target = deliveryContext.target?.trim() ?? "";
      if (!target) {
        return undefined;
      }
      const existing = hostedLinqTypingTargets.get(target);
      if (existing?.preparation
        && existing.preparation.providerFetch === input.providerFetch
        && existing.activeUntilMs > Date.now()) {
        return existing.preparation.take(input.signal);
      }
      const typingTarget = claimHostedLinqTypingTarget(target);
      return typingTarget ? startHostedLinqTypingForTarget(input, typingTarget) : undefined;
    },
    startTelegramTyping: async (request) => {
      const dependencies = requireHostedProviderFetchDependencies({
        env: buildHostedTelegramChannelEnv({
          forwardedEnv: input.forwardedEnv,
          platformEnv: input.platformEnv,
        }) as NodeJS.ProcessEnv,
        fetchImplementation: input.providerFetch,
        signal: input.signal,
      }, "Hosted Telegram typing indicator");
      return startTelegramTypingIndicator(request, dependencies);
    },
  };
}

// Terminal evidence owns the input identity; the invocation's original guarded
// fetch owns provider authority. Neither identity comes from optional telemetry.
export function stopHostedLinqInputTyping(input: {
  assistantInputIds: readonly string[];
  providerFetch?: typeof fetch | null;
}): void {
  if (!input.providerFetch || input.assistantInputIds.length === 0) return;
  for (const state of hostedLinqTypingTargets.values()) {
    const preparation = state.preparation;
    if (preparation?.providerFetch === input.providerFetch
      && input.assistantInputIds.includes(preparation.assistantInputId)) {
      preparation.stop();
    }
  }
}

// The existing per-chat claim owns preparation and the turn's single refresh
// loop. The importer can cancel only until a validated turn takes the handle.
export function startHostedLinqInputTyping(input: Omit<
  HostedChannelTypingInput, "linqDeliveryContexts"
> & {
  assistantInputId: string;
  linqDeliveryContext: HostedAssistantLinqDeliveryContext | null;
}): (() => void) | null {
  const context = input.linqDeliveryContext;
  const target = context?.target?.trim();
  if (!context || !target || !input.providerFetch || input.signal?.aborted) {
    return null;
  }
  if (
    (context.routeAuthority && context.routeAuthority.threadId !== target)
    || getAssistantChannelAdapter("linq")?.canAutoReply({
      externalThreadRouteAuthorityPresent: context.routeAuthority != null,
      source: "linq",
      threadIsDirect: context.threadIsDirect,
    }) !== null
  ) {
    return null;
  }
  const typingTarget = claimHostedLinqTypingTarget(target);
  if (!typingTarget) {
    return null;
  }
  const typingTargetState = typingTarget.state;

  const controller = new AbortController();
  let ownerSignal: AbortSignal | undefined;
  let handedOff = false;
  const detach = () => ownerSignal?.removeEventListener("abort", stop);
  typingTarget.state.cleanup = detach;
  const ready = startHostedLinqTypingForTarget({
    ...input,
    signal: controller.signal,
  }, typingTarget).catch(() => undefined);

  function stop(): void {
    if (controller.signal.aborted) return;
    // Retain the claim until start and stop settle, even across its old expiry.
    // A cancelled request is not a max-length session just because it settles late.
    typingTargetState.stoppingAtMs = Date.now();
    delete typingTargetState.preparation;
    detach();
    controller.abort(ownerSignal?.reason);
    void ready.then((handle) => handle?.stop()).catch(() => {});
  }
  function bindSignal(signal?: AbortSignal): void {
    detach();
    ownerSignal = signal;
    if (controller.signal.aborted) return;
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
  }

  typingTarget.state.preparation = {
    assistantInputId: input.assistantInputId,
    providerFetch: input.providerFetch,
    stop,
    take(signal) {
      handedOff = true;
      delete typingTarget.state.preparation;
      bindSignal(signal);
      return ready.then((handle) => controller.signal.aborted ? undefined : handle);
    },
  };
  bindSignal(input.signal);
  void ready.then((handle) => {
    if (!handle) {
      detach();
      return;
    }
    // After handoff, only the turn can observe acceptance for its admitted inputs.
    if (handedOff || controller.signal.aborted || handle.isActive?.() === false || !handle.acceptedAt) return;
    recordHostedAssistantMilestonesBestEffort({
      context: input.latencyTraceContext,
      milestones: [{ at: handle.acceptedAt, milestone: "linq_typing_accepted" }],
    });
  }).catch(() => {});
  return () => { if (!handedOff) stop(); };
}

async function startHostedLinqTypingForTarget(
  input: HostedChannelTypingInput,
  typingTarget: HostedLinqTypingClaim,
): Promise<HostedLinqTypingHandle | undefined> {
  const typingRequestStartedAt = new Date().toISOString();
  try {
    const dependencies = requireHostedProviderFetchDependencies({
      env: buildHostedLinqChannelEnv({
        forwardedEnv: input.forwardedEnv,
        userEnv: input.userEnv,
      }) as NodeJS.ProcessEnv,
      fetchImplementation: input.providerFetch,
      signal: input.signal,
    }, "Hosted Linq typing indicator");
    const handle = await startLinqTypingIndicator({
      target: typingTarget.target,
    }, {
      ...dependencies,
      maxSessionMs: HOSTED_LINQ_TYPING_MAX_SESSION_MS,
      refreshMs: HOSTED_LINQ_TYPING_REFRESH_MS,
    });
    if (!handle) {
      releaseHostedLinqTypingTarget(typingTarget, {
        completedMaxSession: false,
      });
      return undefined;
    }
    return wrapHostedLinqTypingHandle({
      handle: { ...handle, acceptedAt: handle.acceptedAt ?? new Date().toISOString() },
      target: typingTarget,
    });
  } catch (error) {
    releaseHostedLinqTypingTarget(typingTarget, {
      completedMaxSession: false,
    });
    throw error;
  } finally {
    recordHostedAssistantMilestonesBestEffort({
      context: input.latencyTraceContext,
      milestones: [{
        at: typingRequestStartedAt,
        milestone: "linq_typing_request_started",
      }],
    });
  }
}

type HostedLinqTypingClaim = {
  target: string;
  state: HostedLinqTypingTargetState;
};

function claimHostedLinqTypingTarget(target: string): HostedLinqTypingClaim | null {
  const normalized = target.trim();
  if (!normalized) {
    return null;
  }

  const now = Date.now();
  for (const [key, state] of hostedLinqTypingTargets) {
    if (state.stoppingAtMs === undefined && state.activeUntilMs <= now && state.cooldownUntilMs <= now) {
      state.cleanup?.();
      hostedLinqTypingTargets.delete(key);
    }
  }

  const existing = hostedLinqTypingTargets.get(normalized);
  if (existing && (existing.stoppingAtMs !== undefined
    || existing.activeUntilMs > now || existing.cooldownUntilMs > now)) {
    return null;
  }

  const state: HostedLinqTypingTargetState = {
    activeUntilMs: now + HOSTED_LINQ_TYPING_MAX_SESSION_MS,
    cooldownUntilMs: now + HOSTED_LINQ_TYPING_MAX_SESSION_MS
      + HOSTED_LINQ_TYPING_RESTART_COOLDOWN_MS,
  };
  hostedLinqTypingTargets.set(normalized, state);
  return { target: normalized, state };
}

function wrapHostedLinqTypingHandle(input: {
  handle: NonNullable<Awaited<ReturnType<typeof startLinqTypingIndicator>>>;
  target: HostedLinqTypingClaim;
}): NonNullable<Awaited<ReturnType<typeof startLinqTypingIndicator>>> {
  let released = false;
  return {
    ...input.handle,
    stop: async (options) => {
      const ownsTarget = !released
        && hostedLinqTypingTargets.get(input.target.target) === input.target.state;
      const completedMaxSession = (input.target.state.stoppingAtMs ?? Date.now())
        >= input.target.state.activeUntilMs;
      try {
        await input.handle.stop(ownsTarget ? options : { ...options, providerStop: false });
      } finally {
        if (ownsTarget) {
          released = true;
          releaseHostedLinqTypingTarget(input.target, { completedMaxSession });
        }
      }
    },
  };
}

function releaseHostedLinqTypingTarget(input: HostedLinqTypingClaim, options: {
  completedMaxSession: boolean;
}): void {
  if (hostedLinqTypingTargets.get(input.target) !== input.state) {
    return;
  }
  input.state.cleanup?.();
  if (!options.completedMaxSession) {
    hostedLinqTypingTargets.delete(input.target);
    return;
  }

  delete input.state.stoppingAtMs;
  input.state.activeUntilMs = Date.now();
  input.state.cooldownUntilMs = Date.now() + HOSTED_LINQ_TYPING_RESTART_COOLDOWN_MS;
}

function pickHostedChannelEnv(
  source: Readonly<Record<string, string>>,
  keys: readonly string[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = readHostedChannelEnvValue(source, key);
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

function readHostedChannelEnvValue(
  env: Readonly<Record<string, string>>,
  key: string,
): string | null {
  const value = env[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
