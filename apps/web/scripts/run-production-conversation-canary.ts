import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import {
  Spectrum,
  type Message,
  type Space,
} from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";
import {
  MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS,
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  LINQ_PRODUCTION_CANARY_GOAL_TITLE,
  type LinqProductionCanaryOutcome,
} from "../src/lib/hosted-onboarding/linq-production-canary-contract";

const CANARY_RESET_PATH =
  "/api/internal/hosted-onboarding/linq/production-canary/reset";
const CANARY_OUTCOME_PATH =
  "/api/internal/hosted-onboarding/linq/production-canary/outcome";
const CANARY_REPLY_BUDGET_MS = 20_000;
const CANARY_REPLY_WAIT_MS = 90_000;
const CANARY_RESET_TIMEOUT_MS = 300_000;
const CANARY_OUTCOME_WAIT_MS = 90_000;
const CANARY_TURNS = [
  { prompt: "Hey Murph", stage: "welcome" },
  { prompt: "Yes, ready.", stage: "identity-question" },
  { prompt: "My name is Robin. I am 32 and a woman.", stage: "runtime-identity" },
  {
    prompt: `Please save a new active health goal with the exact title "${LINQ_PRODUCTION_CANARY_GOAL_TITLE}". I want to walk for twenty minutes before lunch each day, starting today. Save it now and tell me when it is saved.`,
    stage: "save-goal",
  },
  {
    prompt: "What is the exact title of the walking goal I just asked you to save? Please read my saved goals and tell me its title; do not create or change anything.",
    stage: "read-goal",
  },
] as const;

type LinqProductionCanaryConfig = {
  productionBaseUrl: string;
  projectId: string;
  projectSecret: string;
  resetSecret: string;
  targetPhoneNumber: string;
};

type LinqProductionCanaryResetResult = {
  accountDeleted: boolean;
  admissionBudgetCount: number;
  admissionDecisionCount: number;
  deliveryClaimCount: number;
};

type LinqProductionCanaryTurnResult = {
  latencyMs: number;
  stage: (typeof CANARY_TURNS)[number]["stage"];
  turn: number;
};

export async function runLinqProductionCanary(
  source: NodeJS.ProcessEnv = process.env,
  reportTurn?: (result: LinqProductionCanaryTurnResult) => void,
): Promise<{
  canonicalOutcome: { baselineGoalCount: number; savedGoalCount: number; readbackGoalCount: number };
  reset: LinqProductionCanaryResetResult;
  turns: LinqProductionCanaryTurnResult[];
}> {
  const config = readLinqProductionCanaryConfig(source);
  const reset = await resetProductionConversationCanary(config);
  const app = await Spectrum({
    options: { logLevel: "error" },
    projectId: config.projectId,
    projectSecret: config.projectSecret,
    providers: [imessage.config()],
    telemetry: false,
  });

  try {
    const inbound = app.messages[Symbol.asyncIterator]();
    const provider = imessage(app);
    const target = await provider.user(config.targetPhoneNumber);
    const space = await provider.space.create(target);
    const turns: LinqProductionCanaryTurnResult[] = [];
    const canonicalOutcome = { baselineGoalCount: 0, savedGoalCount: 0, readbackGoalCount: 0 };
    let previousReplyAt: number | null = null;

    for (const [index, { prompt, stage }] of CANARY_TURNS.entries()) {
      const turn = index + 1;
      const sentAt = performance.now();
      const sentAtEpochMs = Date.now();
      const replyPromise = waitForLinqProductionCanaryReply({
        inbound,
        notBeforeEpochMs: sentAtEpochMs,
        spaceId: space.id,
        timeoutMs: CANARY_REPLY_WAIT_MS,
        userId: target.id,
      });
      const sent = await space.send(prompt);
      if (!sent) {
        void replyPromise.catch(() => undefined);
        throwCanaryFailure("send-unconfirmed");
      }
      const reply = await replyPromise.catch(() => {
        throwCanaryFailure(`reply-unavailable; turn=${turn}; stage=${stage}; wait_limit_ms=${CANARY_REPLY_WAIT_MS}`);
      });
      const replyAt = performance.now();
      const latencyMs = Math.round(replyAt - sentAt);
      const turnResult = { latencyMs, stage, turn };
      reportTurn?.(turnResult);
      if (latencyMs >= CANARY_REPLY_BUDGET_MS) {
        throwCanaryFailure(
          `reply-latency-budget-exceeded; turn=${turn}; metric=send_to_reply; elapsed_ms=${Math.min(CANARY_REPLY_WAIT_MS, latencyMs)}; budget_ms=${CANARY_REPLY_BUDGET_MS}`,
        );
      }
      const interReplyGapMs = previousReplyAt === null
        ? null
        : replyAt - previousReplyAt;
      if (
        interReplyGapMs !== null
        && interReplyGapMs >= CANARY_REPLY_BUDGET_MS
      ) {
        throwCanaryFailure(
          `reply-latency-budget-exceeded; turn=${turn}; metric=inter_reply_gap; elapsed_ms=${Math.min(CANARY_REPLY_WAIT_MS, Math.round(interReplyGapMs))}; budget_ms=${CANARY_REPLY_BUDGET_MS}`,
        );
      }
      assertLinqProductionCanaryReply({ reply, turn });
      turns.push(turnResult);
      previousReplyAt = replyAt;
      if (stage === "runtime-identity" || stage === "save-goal" || stage === "read-goal") {
        const expectedCount = stage === "runtime-identity" ? 0 : 1;
        const outcome = await waitForCanonicalGoalOutcome(config, expectedCount, stage);
        if (stage === "runtime-identity") canonicalOutcome.baselineGoalCount = outcome.matchingGoalCount;
        if (stage === "save-goal") canonicalOutcome.savedGoalCount = outcome.matchingGoalCount;
        if (stage === "read-goal") canonicalOutcome.readbackGoalCount = outcome.matchingGoalCount;
        // Observation deliberately waits for publication. It is outside reply latency.
        previousReplyAt = null;
      }
    }

    return { canonicalOutcome, reset, turns };
  } finally {
    await app.stop();
  }
}

export async function waitForLinqProductionCanaryReply(input: {
  inbound: AsyncIterator<[Space, Message]>;
  notBeforeEpochMs: number;
  spaceId: string;
  timeoutMs: number;
  userId: string;
}): Promise<string> {
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error("canary-reply-timeout")), input.timeoutMs)
      .unref();
  });

  const nextReply = (async () => {
    while (true) {
      const next = await input.inbound.next();
      if (next.done) {
        throwCanaryFailure("message-stream-ended");
      }
      const [space, message] = next.value;
      if (
        space.id !== input.spaceId
        || message.direction !== "inbound"
        || message.platform !== "imessage"
        || message.sender?.id !== input.userId
        || message.content.type !== "text"
        || !Number.isFinite(message.timestamp.getTime())
        || message.timestamp.getTime() < input.notBeforeEpochMs
      ) {
        continue;
      }
      return message.content.text.trim();
    }
  })();

  try {
    return await Promise.race([nextReply, timeout]);
  } catch {
    throwCanaryFailure("reply-unavailable");
  }
}

function assertLinqProductionCanaryReply(input: {
  reply: string;
  turn: number;
}): void {
  if (!input.reply) {
    throwCanaryFailure("reply-empty");
  }
  if (input.turn === 5 && !input.reply.includes(LINQ_PRODUCTION_CANARY_GOAL_TITLE)) {
    throwCanaryFailure("goal-readback-reply-invalid");
  }
  const isIdentityQuestion = Object.values(MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS)
    .some((question) => input.reply === question);
  if (
    (input.turn === 2 && !isIdentityQuestion)
    || (input.turn === 3 && isIdentityQuestion)
    || (input.turn === 1
      && input.reply !== MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE)
    || (
      input.turn > 1
      && input.reply === MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE
    )
  ) {
    throwCanaryFailure("reply-semantics-invalid");
  }
}

async function waitForCanonicalGoalOutcome(
  config: LinqProductionCanaryConfig,
  expectedCount: 0 | 1,
  stage: string,
): Promise<LinqProductionCanaryOutcome> {
  const signal = AbortSignal.timeout(CANARY_OUTCOME_WAIT_MS);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await fetch(new URL(CANARY_OUTCOME_PATH, config.productionBaseUrl), {
      headers: { authorization: `Bearer ${config.resetSecret}` },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    }).catch(() => throwCanaryFailure(`outcome-read-failed; stage=${stage}`));
    if (!response.ok) throwCanaryFailure(`outcome-read-failed; stage=${stage}`);
    const body: unknown = await response.json().catch(() => null);
    if (!isLinqProductionCanaryOutcomeResponse(body)) {
      throwCanaryFailure(`outcome-response-invalid; stage=${stage}`);
    }
    const { outcome } = body;
    if (outcome.ready) {
      if (outcome.totalGoalCount > expectedCount
        || outcome.totalGoalCount !== outcome.matchingGoalCount
        || outcome.matchingGoalIdCount !== outcome.matchingGoalCount) {
        throwCanaryFailure(`outcome-cardinality-invalid; stage=${stage}`);
      }
      if (outcome.matchingGoalCount === expectedCount) return outcome;
    }
    await delay(1_000, undefined, { signal })
      .catch(() => throwCanaryFailure(`outcome-not-ready; stage=${stage}`));
  }
  throwCanaryFailure(`outcome-not-ready; stage=${stage}`);
}

function isLinqProductionCanaryOutcomeResponse(value: unknown): value is {
  ok: true;
  outcome: LinqProductionCanaryOutcome;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || !record.outcome || typeof record.outcome !== "object") return false;
  const outcome = record.outcome as Record<string, unknown>;
  return typeof outcome.ready === "boolean"
    && isNonNegativeInteger(outcome.totalGoalCount)
    && isNonNegativeInteger(outcome.matchingGoalCount)
    && isNonNegativeInteger(outcome.matchingGoalIdCount);
}

async function resetProductionConversationCanary(
  config: LinqProductionCanaryConfig,
): Promise<LinqProductionCanaryResetResult> {
  const url = new URL(CANARY_RESET_PATH, config.productionBaseUrl);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${config.resetSecret}` },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(CANARY_RESET_TIMEOUT_MS),
  });
  if (!response.ok) {
    throwCanaryFailure("reset-failed");
  }

  const body: unknown = await response.json();
  if (!isLinqProductionCanaryResetResponse(body)) {
    throwCanaryFailure("reset-response-invalid");
  }
  return body.reset;
}

function readLinqProductionCanaryConfig(
  source: NodeJS.ProcessEnv,
): LinqProductionCanaryConfig {
  const projectId = requireEnvironmentValue(source, "SPECTRUM_PROJECT_ID");
  const projectSecret = requireEnvironmentValue(
    source,
    "SPECTRUM_PROJECT_SECRET",
  );
  const resetSecret = requireEnvironmentValue(
    source,
    "MURPH_LINQ_PRODUCTION_CANARY_RESET_SECRET",
  );
  const targetPhoneNumber = requireEnvironmentValue(
    source,
    "MURPH_LINQ_PRODUCTION_CANARY_TARGET_PHONE_NUMBER",
  );
  if (!/^\+[1-9]\d{7,14}$/u.test(targetPhoneNumber)) {
    throwCanaryFailure("target-phone-invalid");
  }

  const productionBaseUrl = requireEnvironmentValue(
    source,
    "HOSTED_WEB_PRODUCTION_BASE_URL",
  );
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(productionBaseUrl);
  } catch {
    throwCanaryFailure("production-base-url-invalid");
  }
  if (
    parsedBaseUrl.protocol !== "https:"
    || parsedBaseUrl.username
    || parsedBaseUrl.password
    || parsedBaseUrl.pathname !== "/"
    || parsedBaseUrl.search
    || parsedBaseUrl.hash
  ) {
    throwCanaryFailure("production-base-url-invalid");
  }

  return {
    productionBaseUrl: parsedBaseUrl.href,
    projectId,
    projectSecret,
    resetSecret,
    targetPhoneNumber,
  };
}

function requireEnvironmentValue(
  source: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = source[name]?.trim();
  if (!value) {
    throwCanaryFailure("configuration-missing");
  }
  return value;
}

function isLinqProductionCanaryResetResponse(value: unknown): value is {
  ok: true;
  reset: LinqProductionCanaryResetResult;
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || !record.reset || typeof record.reset !== "object") {
    return false;
  }
  const reset = record.reset as Record<string, unknown>;
  return typeof reset.accountDeleted === "boolean"
    && isNonNegativeInteger(reset.admissionBudgetCount)
    && isNonNegativeInteger(reset.admissionDecisionCount)
    && isNonNegativeInteger(reset.deliveryClaimCount);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function throwCanaryFailure(code: string): never {
  const error = new Error("The Linq production canary failed.");
  error.name = code;
  throw error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLinqProductionCanary(process.env, (turn) => {
    process.stdout.write(`${JSON.stringify({ status: "reply-received", ...turn })}\n`);
  })
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        status: "passed",
        ...result,
      })}\n`);
    })
    .catch((error: unknown) => {
      const code = error instanceof Error ? error.name : "unknown";
      console.error(`Linq production canary failed (${code}).`);
      process.exitCode = 1;
    });
}
