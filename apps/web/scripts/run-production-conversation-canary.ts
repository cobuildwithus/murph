import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import {
  Spectrum,
  type Message,
  type Space,
} from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";
import { HOSTED_EXECUTION_DEFAULT_RUNNER_IDLE_TTL_MS } from "@murphai/hosted-execution/contracts";
import {
  MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS,
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  LINQ_PRODUCTION_CANARY_DIAGNOSTIC_TRACE_LIMIT,
  LINQ_PRODUCTION_CANARY_DIAGNOSTIC_WINDOW_MS,
  type LinqProductionCanaryDiagnostics,
  type LinqProductionCanaryLatencyTrace,
  type LinqProductionCanaryOutcome,
} from "../src/lib/hosted-onboarding/linq-production-canary-contract";
import CANARY_TURNS from "./fixtures/linq-production-conversation.json";

const CANARY_RESET_PATH =
  "/api/internal/hosted-onboarding/linq/production-canary/reset";
const CANARY_OUTCOME_PATH =
  "/api/internal/hosted-onboarding/linq/production-canary/outcome";
const CANARY_REPLY_BUDGET_MS = 20_000;
const CANARY_REPLY_OBSERVATION_COUNT_MAX = 10_000;
export const CANARY_REPLY_WAIT_MS = 90_000;
export const CANARY_RESET_TIMEOUT_MS = 300_000;
export const CANARY_DIAGNOSTIC_WAIT_MS = 3_000;
// Observe the normal quiet window plus bounded checkpoint/publication time.
// This budget is independent of the twenty-second reply latency requirement.
export const CANARY_OUTCOME_WAIT_MS = HOSTED_EXECUTION_DEFAULT_RUNNER_IDLE_TTL_MS + 120_000;
export const CANARY_OUTCOME_POLL_MS = 5_000;

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
  senderSendMs: number;
  stage: (typeof CANARY_TURNS)[number]["stage"];
  turn: number;
};

type LinqProductionCanaryDiagnosticObservation =
  | { observation: "available"; diagnostics: LinqProductionCanaryDiagnostics }
  | { observation: "unsupported" | "invalid" | "unavailable" };

type LinqProductionCanaryDiagnosticRecord = LinqProductionCanaryDiagnosticObservation & {
  status: "turn-diagnostics";
  stage: LinqProductionCanaryTurnResult["stage"];
  turn: number;
};

type LinqProductionCanaryReplyObservation = {
  reason: "timeout" | "stream-ended" | "stream-failed";
  observedCount: number;
  rejectedCount: number;
};

class LinqProductionCanaryReplyUnavailableError extends Error {
  constructor(readonly observation: LinqProductionCanaryReplyObservation) {
    super("The Linq production canary failed.");
    this.name = `reply-unavailable${formatCanaryReplyObservation(observation)}`;
  }
}

function formatCanaryReplyObservation(observation: LinqProductionCanaryReplyObservation): string {
  return `; reason=${observation.reason}; observed_count=${observation.observedCount}; rejected_count=${observation.rejectedCount}`;
}

export async function runLinqProductionCanary(
  source: NodeJS.ProcessEnv = process.env,
  reportTurn?: (result: LinqProductionCanaryTurnResult) => void,
  reportDiagnostic?: (result: LinqProductionCanaryDiagnosticRecord) => void,
): Promise<{
  canonicalOutcome: { baselineGoalCount: number; savedGoalCount: number; proposalGoalCount: number };
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
    const canonicalOutcome = { baselineGoalCount: 0, savedGoalCount: 0, proposalGoalCount: 0 };
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
      const senderSendMs = Math.round(performance.now() - sentAt);
      const reply = await replyPromise.catch(async (error: unknown) => {
        const observation = error instanceof LinqProductionCanaryReplyUnavailableError
          ? formatCanaryReplyObservation(error.observation) : "";
        await reportCanaryFailureDiagnostics(config, { stage, turn }, reportDiagnostic);
        throwCanaryFailure(`reply-unavailable; turn=${turn}; stage=${stage}; wait_limit_ms=${CANARY_REPLY_WAIT_MS}${observation}`);
      });
      const replyAt = performance.now();
      const latencyMs = Math.round(replyAt - sentAt);
      const turnResult = { latencyMs, senderSendMs, stage, turn };
      reportTurn?.(turnResult);
      if (latencyMs >= CANARY_REPLY_BUDGET_MS) {
        await reportCanaryFailureDiagnostics(config, { stage, turn }, reportDiagnostic);
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
        await reportCanaryFailureDiagnostics(config, { stage, turn }, reportDiagnostic);
        throwCanaryFailure(
          `reply-latency-budget-exceeded; turn=${turn}; metric=inter_reply_gap; elapsed_ms=${Math.min(CANARY_REPLY_WAIT_MS, Math.round(interReplyGapMs))}; budget_ms=${CANARY_REPLY_BUDGET_MS}`,
        );
      }
      assertLinqProductionCanaryReply({ reply, turn });
      turns.push(turnResult);
      previousReplyAt = replyAt;
      if (stage === "runtime-identity" || stage === "goal-proposal" || stage === "accept-goal") {
        const expectedCount = stage === "accept-goal" ? 1 : 0;
        const outcome = await waitForCanonicalGoalOutcome(config, expectedCount, stage);
        if (stage === "runtime-identity") canonicalOutcome.baselineGoalCount = outcome.matchingGoalCount;
        if (stage === "accept-goal") canonicalOutcome.savedGoalCount = outcome.matchingGoalCount;
        if (stage === "goal-proposal") canonicalOutcome.proposalGoalCount = outcome.matchingGoalCount;
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
  let observedCount = 0;
  let rejectedCount = 0;
  // Identity-only markers cannot be confused with provider error names or values.
  const timeoutFailure = Symbol();
  const streamEndFailure = Symbol();
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(timeoutFailure), input.timeoutMs)
      .unref();
  });

  const nextReply = (async () => {
    while (true) {
      const next = await input.inbound.next();
      if (next.done) {
        throw streamEndFailure;
      }
      observedCount = Math.min(observedCount + 1, CANARY_REPLY_OBSERVATION_COUNT_MAX);
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
        rejectedCount = Math.min(rejectedCount + 1, CANARY_REPLY_OBSERVATION_COUNT_MAX);
        continue;
      }
      return message.content.text.trim();
    }
  })();

  try {
    return await Promise.race([nextReply, timeout]);
  } catch (error: unknown) {
    throw new LinqProductionCanaryReplyUnavailableError({
      reason: error === timeoutFailure ? "timeout"
        : error === streamEndFailure ? "stream-ended" : "stream-failed",
      observedCount,
      rejectedCount,
    });
  }
}

function assertLinqProductionCanaryReply(input: {
  reply: string;
  turn: number;
}): void {
  if (!input.reply) {
    throwCanaryFailure("reply-empty");
  }
  const questions = Object.values(MURPH_ASSISTANT_ONBOARDING_IDENTITY_QUESTIONS);
  // Compare the complete word sequence, tolerating only case and separators.
  const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const isExactIdentityQuestion = questions
    .some((question) => input.reply === question);
  const identityMatch = isExactIdentityQuestion ? "exact"
    : questions.some((question) => words(input.reply) === words(question)) ? "format-only" : "different";
  const isIdentityQuestion = identityMatch !== "different";
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
    // Closed diagnostic categories preserve the failed assertion without logging copy.
    throwCanaryFailure(
      `reply-semantics-invalid; turn=${input.turn}; identity_copy=${identityMatch}; welcome_copy=${input.reply === MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE}; reply_chars=${Math.min(input.reply.length, 10000)}`,
    );
  }
}

async function waitForCanonicalGoalOutcome(
  config: LinqProductionCanaryConfig,
  expectedCount: 0 | 1,
  stage: string,
): Promise<LinqProductionCanaryOutcome> {
  const signal = AbortSignal.timeout(CANARY_OUTCOME_WAIT_MS);
  for (let attempt = 0; attempt < CANARY_OUTCOME_WAIT_MS / CANARY_OUTCOME_POLL_MS; attempt += 1) {
    const outcome = await readCanonicalGoalOutcome(config, signal, stage);
    if (signal.aborted) throwCanaryFailure(`outcome-not-ready; stage=${stage}`);
    if (outcome?.ready) {
      if (outcome.totalGoalCount > expectedCount
        || outcome.totalGoalCount !== outcome.matchingGoalCount
        || outcome.matchingGoalIdCount !== outcome.matchingGoalCount) {
        throwCanaryFailure(`outcome-cardinality-invalid; stage=${stage}`);
      }
      if (outcome.matchingGoalCount === expectedCount) return outcome;
    }
    await delay(CANARY_OUTCOME_POLL_MS, undefined, { signal })
      .catch(() => throwCanaryFailure(`outcome-not-ready; stage=${stage}`));
  }
  throwCanaryFailure(`outcome-not-ready; stage=${stage}`);
}

async function reportCanaryFailureDiagnostics(
  config: LinqProductionCanaryConfig,
  turn: Pick<LinqProductionCanaryTurnResult, "stage" | "turn">,
  report: ((result: LinqProductionCanaryDiagnosticRecord) => void) | undefined,
): Promise<void> {
  try {
    const observation = await readCanaryFailureDiagnostics(config, turn.stage);
    report?.({ status: "turn-diagnostics", ...turn, ...observation });
  } catch {
    // A diagnostic or reporter failure must never replace the original failure.
  }
}

async function readCanaryFailureDiagnostics(
  config: LinqProductionCanaryConfig,
  stage: string,
): Promise<LinqProductionCanaryDiagnosticObservation> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // One read after failure; this deadline never extends reply acceptance or
    // starts the canonical outcome polling loop. The race also bounds body reads.
    const outcome = await Promise.race([
      readCanonicalGoalOutcome(config, controller.signal, stage),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, CANARY_DIAGNOSTIC_WAIT_MS).unref();
      }),
    ]);
    if (!outcome) return { observation: "unavailable" };
    if (!Object.hasOwn(outcome, "diagnostics")) return { observation: "unsupported" };
    if (!isCanaryDiagnostics(outcome.diagnostics)) return { observation: "invalid" };
    return { observation: "available", diagnostics: outcome.diagnostics };
  } catch {
    return { observation: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

function isCanaryDiagnostics(value: unknown): value is LinqProductionCanaryDiagnostics {
  const record = readDiagnosticRecord(value);
  if (!record
    || !hasExactDiagnosticKeys(record, ["status", "failedTurnMatched", "truncated", "traces"])
    || record.failedTurnMatched !== false
    || typeof record.truncated !== "boolean"
    || !Array.isArray(record.traces)
    || record.traces.length > LINQ_PRODUCTION_CANARY_DIAGNOSTIC_TRACE_LIMIT
    || !record.traces.every(isCanaryLatencyTrace)) return false;
  switch (record.status) {
    case "empty":
    case "unavailable": return record.traces.length === 0 && !record.truncated;
    case "observed": return record.traces.length === 1 && !record.truncated;
    case "ambiguous": return record.traces.length > 1
      && (!record.truncated || record.traces.length === LINQ_PRODUCTION_CANARY_DIAGNOSTIC_TRACE_LIMIT);
    default: return false;
  }
}

function isCanaryLatencyTrace(value: unknown): value is LinqProductionCanaryLatencyTrace {
  const record = readDiagnosticRecord(value);
  if (!record || typeof record.stale !== "boolean" || typeof record.incomplete !== "boolean"
    || typeof record.stage !== "string"
    || !["instant_reply", "pre_runtime", "runtime_provider", "delivery_observation"].includes(record.stage)) return false;
  const durations = [
    "ageMs", "ingressMs", "preRuntimeMs", "runtimeToProviderMs", "providerToDeliveryMs",
    "acceptedToDeliveryAttemptMs", "deliveryAcceptMs", "deliveryReceiptMs", "deliveredAgeMs",
  ];
  return Object.entries(record).every(([key, duration]) => ["stage", "stale", "incomplete"].includes(key)
    || (durations.includes(key) && isNonNegativeInteger(duration) && duration <= LINQ_PRODUCTION_CANARY_DIAGNOSTIC_WINDOW_MS));
}

function readDiagnosticRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function hasExactDiagnosticKeys(record: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

async function readCanonicalGoalOutcome(
  config: LinqProductionCanaryConfig,
  observationSignal: AbortSignal,
  stage: string,
): Promise<LinqProductionCanaryOutcome | null> {
  const requestSignal = AbortSignal.any([observationSignal, AbortSignal.timeout(10_000)]);
  const response = await fetch(new URL(CANARY_OUTCOME_PATH, config.productionBaseUrl), {
    headers: { authorization: `Bearer ${config.resetSecret}` },
    method: "GET",
    redirect: "error",
    signal: requestSignal,
  }).catch(() => {
    if (requestSignal.aborted) return null;
    throwCanaryFailure(`outcome-read-failed; stage=${stage}`);
  });
  if (!response) return null;
  // The observer is read-only. A transient unavailable response or request
  // timeout can use the next existing poll, but never extends the stage deadline.
  if (response.status === 503) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) throwCanaryFailure(`outcome-read-failed; stage=${stage}; http_status=${response.status}`);
  const body: unknown = await response.json().catch(() => {
    if (requestSignal.aborted) return null;
    throwCanaryFailure(`outcome-response-invalid; stage=${stage}`);
  });
  if (requestSignal.aborted) return null;
  if (!isLinqProductionCanaryOutcomeResponse(body)) {
    throwCanaryFailure(`outcome-response-invalid; stage=${stage}`);
  }
  return body.outcome;
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
  }, (diagnostic) => {
    process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
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
