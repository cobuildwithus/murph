import type {
  Prisma,
} from "@prisma/client";

import { decodeHostedIngressStoredPayload } from "../hosted-ingress/payload";
import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import {
  hostedMemberRoutingStateSelect,
  projectHostedMemberRoutingState,
  type HostedMemberRoutingRecord,
} from "./hosted-member-routing-state";
import {
  sendHostedLinqTypingPing,
  sendHostedLinqTypingStop,
} from "./linq-client";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import { getHostedOnboardingEnvironment } from "./runtime";

const DEFAULT_LINQ_TYPING_DIAGNOSTIC_DELAYS_MS = [
  0,
  4_000,
  8_000,
  12_000,
  16_000,
  20_000,
] as const;
const MAX_LINQ_TYPING_DIAGNOSTIC_ATTEMPTS = 10;
const MAX_LINQ_TYPING_DIAGNOSTIC_DELAY_MS = 45_000;
const MAX_LINQ_TYPING_DIAGNOSTIC_TIMEOUT_MS = 5_000;
const LATEST_LINQ_INGRESS_CANDIDATE_LIMIT = 25;

export type HostedLinqTypingDiagnosticMode = "deferred" | "inline";
export type HostedLinqTypingDiagnosticOperation = "start" | "stop";

export interface HostedLinqTypingDiagnosticRequest {
  delaysMs: readonly number[];
  mode: HostedLinqTypingDiagnosticMode;
  stop: boolean;
  stopDelayMs: number | null;
  timeoutMs: number;
}

export interface HostedLinqTypingDiagnosticPublicTarget {
  chatIdPresent: true;
  ingressAgeMs: number | null;
  latestIngressMatched: true;
  routedChatIdPresent: boolean;
  routedChatMatched: boolean;
  source: "latest-linq-ingress";
}

export interface HostedLinqTypingDiagnosticPlan {
  chatId: string;
  delaysMs: readonly number[];
  stop: boolean;
  stopDelayMs: number | null;
  target: HostedLinqTypingDiagnosticPublicTarget;
  timeoutMs: number;
}

export interface HostedLinqTypingDiagnosticAttempt {
  attempt: number;
  delayMs: number;
  elapsedMs: number;
  errorName: string | null;
  httpStatus: number | null;
  ok: boolean;
  operation: HostedLinqTypingDiagnosticOperation;
}

export interface HostedLinqTypingDiagnosticResult {
  attempts: HostedLinqTypingDiagnosticAttempt[];
  ok: boolean;
  target: HostedLinqTypingDiagnosticPublicTarget;
}

interface HostedLinqConversationWakeForDiagnostic {
  kind: "conversation.message";
  message: {
    channel: "linq";
    linqMessage: {
      chatId: string;
    };
  };
}

type HostedIngressCandidate = Prisma.HostedIngressEventGetPayload<{
  select: {
    createdAt: true;
    payload: {
      select: {
        payloadCiphertext: true;
      };
    };
    payloadInlineCiphertext: true;
    userId: true;
  };
}>;

interface HostedLinqTypingDiagnosticPrisma {
  hostedIngressEvent: {
    findMany(input: {
      orderBy: { createdAt: "desc" };
      select: {
        createdAt: true;
        payload: {
          select: {
            payloadCiphertext: true;
          };
        };
        payloadInlineCiphertext: true;
        userId: true;
      };
      take: number;
      where: {
        kind: "conversation.message";
        quarantinedAt: null;
      };
    }): Promise<HostedIngressCandidate[]>;
  };
  hostedMemberRouting: {
    findUnique(input: {
      select: typeof hostedMemberRoutingStateSelect;
      where: {
        memberId: string;
      };
    }): Promise<HostedMemberRoutingRecord | null>;
  };
}

export function parseHostedLinqTypingDiagnosticRequest(
  body: Record<string, unknown>,
): HostedLinqTypingDiagnosticRequest {
  const delaysMs = parseHostedLinqTypingDiagnosticDelays(body.delaysMs);
  const stop = body.stop === true;
  const stopDelayMs = stop
    ? parseHostedLinqTypingDiagnosticStopDelay(body.stopDelayMs, delaysMs)
    : null;

  return {
    delaysMs,
    mode: parseHostedLinqTypingDiagnosticMode(body.mode),
    stop,
    stopDelayMs,
    timeoutMs: parseHostedLinqTypingDiagnosticTimeout(body.timeoutMs),
  };
}

export async function prepareHostedLinqTypingDiagnostic(input: {
  prisma?: HostedLinqTypingDiagnosticPrisma;
  request: HostedLinqTypingDiagnosticRequest;
}): Promise<HostedLinqTypingDiagnosticPlan> {
  const environment = getHostedOnboardingEnvironment();

  if (!environment.linqIngressTypingDiagnosticEnabled) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_DISABLED",
      httpStatus: 403,
      message: "Hosted Linq typing diagnostic is disabled.",
    });
  }

  const target = await resolveLatestHostedLinqTypingDiagnosticTarget({
    prisma: input.prisma ?? getPrisma(),
  });

  return {
    chatId: target.chatId,
    delaysMs: input.request.delaysMs,
    stop: input.request.stop,
    stopDelayMs: input.request.stopDelayMs,
    target: target.publicTarget,
    timeoutMs: input.request.timeoutMs,
  };
}

export async function runHostedLinqTypingDiagnosticBurst(input: {
  plan: HostedLinqTypingDiagnosticPlan;
  signal?: AbortSignal;
}): Promise<HostedLinqTypingDiagnosticResult> {
  const attempts: HostedLinqTypingDiagnosticAttempt[] = [];
  const startedAtMs = Date.now();
  let previousDelayMs = 0;

  for (const [index, delayMs] of input.plan.delaysMs.entries()) {
    const waitMs = Math.max(0, delayMs - previousDelayMs);
    previousDelayMs = delayMs;
    await waitForHostedLinqTypingDiagnosticDelay(waitMs, input.signal);

    attempts.push(await runHostedLinqTypingDiagnosticAttempt({
      attempt: index + 1,
      chatId: input.plan.chatId,
      delayMs,
      operation: "start",
      signal: input.signal,
      startedAtMs,
      timeoutMs: input.plan.timeoutMs,
      totalAttempts: input.plan.delaysMs.length,
    }));
  }

  if (input.plan.stop) {
    const lastDelayMs = input.plan.delaysMs[input.plan.delaysMs.length - 1] ?? 0;
    const stopDelayMs = input.plan.stopDelayMs ?? lastDelayMs;
    await waitForHostedLinqTypingDiagnosticDelay(
      Math.max(0, stopDelayMs - previousDelayMs),
      input.signal,
    );

    attempts.push(await runHostedLinqTypingDiagnosticAttempt({
      attempt: attempts.length + 1,
      chatId: input.plan.chatId,
      delayMs: stopDelayMs,
      operation: "stop",
      signal: input.signal,
      startedAtMs,
      timeoutMs: input.plan.timeoutMs,
      totalAttempts: input.plan.delaysMs.length + 1,
    }));
  }

  return {
    attempts,
    ok: attempts.every((attempt) => attempt.ok),
    target: input.plan.target,
  };
}

async function resolveLatestHostedLinqTypingDiagnosticTarget(input: {
  prisma: HostedLinqTypingDiagnosticPrisma;
}): Promise<{
  chatId: string;
  publicTarget: HostedLinqTypingDiagnosticPublicTarget;
}> {
  const candidates = await input.prisma.hostedIngressEvent.findMany({
    orderBy: {
      createdAt: "desc",
    },
    select: {
      createdAt: true,
      payload: {
        select: {
          payloadCiphertext: true,
        },
      },
      payloadInlineCiphertext: true,
      userId: true,
    },
    take: LATEST_LINQ_INGRESS_CANDIDATE_LIMIT,
    where: {
      kind: "conversation.message",
      quarantinedAt: null,
    },
  });

  for (const candidate of candidates) {
    const wake = decodeHostedLinqTypingDiagnosticCandidate(candidate);

    if (!isHostedLinqConversationWakeForDiagnostic(wake)) {
      continue;
    }

    const chatId = normalizeRequiredDiagnosticString(wake.message.linqMessage.chatId);

    if (!chatId) {
      continue;
    }

    const routedChatIds = await readHostedLinqTypingDiagnosticRoutingChatIds({
      memberId: candidate.userId,
      prisma: input.prisma,
    });

    return {
      chatId,
      publicTarget: {
        chatIdPresent: true,
        ingressAgeMs: computeNonNegativeAgeMs(candidate.createdAt),
        latestIngressMatched: true,
        routedChatIdPresent: routedChatIds.length > 0,
        routedChatMatched: routedChatIds.includes(chatId),
        source: "latest-linq-ingress",
      },
    };
  }

  throw hostedOnboardingError({
    code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_TARGET_MISSING",
    httpStatus: 404,
    message: "No recent hosted Linq conversation target is available for typing diagnostics.",
  });
}

async function readHostedLinqTypingDiagnosticRoutingChatIds(input: {
  memberId: string;
  prisma: HostedLinqTypingDiagnosticPrisma;
}): Promise<string[]> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    select: hostedMemberRoutingStateSelect,
    where: {
      memberId: input.memberId,
    },
  });

  if (!routingRecord) {
    return [];
  }

  const routing = projectHostedMemberRoutingState(routingRecord);

  return [
    routing.linqChatId,
    routing.pendingLinqChatId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function decodeHostedLinqTypingDiagnosticCandidate(
  candidate: HostedIngressCandidate,
): unknown {
  try {
    return decodeHostedIngressStoredPayload({
      payloadInlineCiphertext: candidate.payloadInlineCiphertext,
      payloadRefCiphertext: candidate.payload?.payloadCiphertext ?? null,
      userId: candidate.userId,
    });
  } catch {
    return null;
  }
}

async function runHostedLinqTypingDiagnosticAttempt(input: {
  attempt: number;
  chatId: string;
  delayMs: number;
  operation: HostedLinqTypingDiagnosticOperation;
  signal?: AbortSignal;
  startedAtMs: number;
  timeoutMs: number;
  totalAttempts: number;
}): Promise<HostedLinqTypingDiagnosticAttempt> {
  const timing = startHostedOnboardingTiming(
    `hosted-onboarding.linq.typing-diagnostic.${input.operation}`,
    {
      attempt: input.attempt,
      chatIdPresent: true,
      delayMs: input.delayMs,
      totalAttempts: input.totalAttempts,
      timeoutMs: input.timeoutMs,
    },
  );

  try {
    const result = input.operation === "start"
      ? await sendHostedLinqTypingPing({
        chatId: input.chatId,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      })
      : await sendHostedLinqTypingStop({
        chatId: input.chatId,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      });
    const elapsedMs = Date.now() - input.startedAtMs;

    finishHostedOnboardingTiming(timing, result.ok ? "completed" : "failed", {
      attempt: input.attempt,
      delayMs: input.delayMs,
      elapsedMs,
      httpStatus: result.status,
      operation: input.operation,
      totalAttempts: input.totalAttempts,
    });

    return {
      attempt: input.attempt,
      delayMs: input.delayMs,
      elapsedMs,
      errorName: null,
      httpStatus: result.status,
      ok: result.ok,
      operation: input.operation,
    };
  } catch (error) {
    const elapsedMs = Date.now() - input.startedAtMs;
    const errorName = deriveHostedOnboardingTimingErrorName(error);

    finishHostedOnboardingTiming(timing, "failed", {
      attempt: input.attempt,
      delayMs: input.delayMs,
      elapsedMs,
      errorName,
      operation: input.operation,
      totalAttempts: input.totalAttempts,
    });

    return {
      attempt: input.attempt,
      delayMs: input.delayMs,
      elapsedMs,
      errorName,
      httpStatus: null,
      ok: false,
      operation: input.operation,
    };
  }
}

function parseHostedLinqTypingDiagnosticMode(
  value: unknown,
): HostedLinqTypingDiagnosticMode {
  if (value === undefined || value === null) {
    return "deferred";
  }

  if (value === "deferred" || value === "inline") {
    return value;
  }

  throw hostedOnboardingError({
    code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_MODE_INVALID",
    httpStatus: 400,
    message: "Hosted Linq typing diagnostic mode must be deferred or inline.",
  });
}

function parseHostedLinqTypingDiagnosticDelays(value: unknown): readonly number[] {
  if (value === undefined || value === null) {
    return DEFAULT_LINQ_TYPING_DIAGNOSTIC_DELAYS_MS;
  }

  if (!Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_DELAYS_INVALID",
      httpStatus: 400,
      message: "Hosted Linq typing diagnostic delays must be an array of milliseconds.",
    });
  }

  const delaysMs = [...new Set(value.map(parseHostedLinqTypingDiagnosticDelay))]
    .sort((left, right) => left - right);

  if (delaysMs.length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_DELAYS_EMPTY",
      httpStatus: 400,
      message: "Hosted Linq typing diagnostic requires at least one delay.",
    });
  }

  if (delaysMs.length > MAX_LINQ_TYPING_DIAGNOSTIC_ATTEMPTS) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_DELAYS_TOO_MANY",
      httpStatus: 400,
      message: "Hosted Linq typing diagnostic has too many attempts.",
    });
  }

  return delaysMs;
}

function parseHostedLinqTypingDiagnosticDelay(value: unknown): number {
  if (!isIntegerNumber(value) || value < 0 || value > MAX_LINQ_TYPING_DIAGNOSTIC_DELAY_MS) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_DELAY_INVALID",
      httpStatus: 400,
      message: "Hosted Linq typing diagnostic delay is outside the allowed range.",
    });
  }

  return value;
}

function parseHostedLinqTypingDiagnosticStopDelay(
  value: unknown,
  delaysMs: readonly number[],
): number {
  const lastDelayMs = delaysMs[delaysMs.length - 1] ?? 0;

  if (value === undefined || value === null) {
    return Math.min(lastDelayMs + 4_000, MAX_LINQ_TYPING_DIAGNOSTIC_DELAY_MS);
  }

  if (
    !isIntegerNumber(value)
    || value < lastDelayMs
    || value > MAX_LINQ_TYPING_DIAGNOSTIC_DELAY_MS
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_STOP_DELAY_INVALID",
      httpStatus: 400,
      message: "Hosted Linq typing diagnostic stop delay is outside the allowed range.",
    });
  }

  return value;
}

function parseHostedLinqTypingDiagnosticTimeout(value: unknown): number {
  if (value === undefined || value === null) {
    return getHostedOnboardingEnvironment().linqIngressTypingDiagnosticTimeoutMs;
  }

  if (!isIntegerNumber(value) || value <= 0 || value > MAX_LINQ_TYPING_DIAGNOSTIC_TIMEOUT_MS) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_TIMEOUT_INVALID",
      httpStatus: 400,
      message: "Hosted Linq typing diagnostic timeout is outside the allowed range.",
    });
  }

  return value;
}

function isIntegerNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isHostedLinqConversationWakeForDiagnostic(
  value: unknown,
): value is HostedLinqConversationWakeForDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (record.kind !== "conversation.message") {
    return false;
  }

  const message = record.message;

  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }

  const messageRecord = message as Record<string, unknown>;

  if (messageRecord.channel !== "linq") {
    return false;
  }

  const linqMessage = messageRecord.linqMessage;

  if (!linqMessage || typeof linqMessage !== "object" || Array.isArray(linqMessage)) {
    return false;
  }

  return typeof (linqMessage as Record<string, unknown>).chatId === "string";
}

function normalizeRequiredDiagnosticString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function computeNonNegativeAgeMs(value: Date): number | null {
  const ageMs = Date.now() - value.getTime();
  return Number.isFinite(ageMs) ? Math.max(0, ageMs) : null;
}

function waitForHostedLinqTypingDiagnosticDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }

    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
