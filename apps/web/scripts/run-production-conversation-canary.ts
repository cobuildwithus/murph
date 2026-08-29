import { performance } from "node:perf_hooks";

import {
  Spectrum,
  type Message,
  type Space,
} from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";
import { MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE } from "@murphai/contracts";

const CANARY_RESET_PATH =
  "/api/internal/hosted-onboarding/linq/production-canary/reset";
const CANARY_REPLY_BUDGET_MS = 10_000;
const CANARY_REPLY_WAIT_MS = 30_000;
const CANARY_RESET_TIMEOUT_MS = 300_000;
const CANARY_TURNS = [
  "Hey Murph",
  "I'd like help building a healthier sleep routine.",
  "What is one useful place to start?",
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
  turn: number;
};

export async function runLinqProductionCanary(
  source: NodeJS.ProcessEnv = process.env,
): Promise<{
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
    let previousReplyAt: number | null = null;

    for (const [index, prompt] of CANARY_TURNS.entries()) {
      const turn = index + 1;
      const sentAt = performance.now();
      const replyPromise = waitForLinqProductionCanaryReply({
        inbound,
        spaceId: space.id,
        timeoutMs: CANARY_REPLY_WAIT_MS,
        userId: target.id,
      });
      const sent = await space.send(prompt);
      if (!sent) {
        void replyPromise.catch(() => undefined);
        throwCanaryFailure("send-unconfirmed");
      }
      const reply = await replyPromise;
      const replyAt = performance.now();
      const latencyMs = Math.round(replyAt - sentAt);
      if (
        latencyMs >= CANARY_REPLY_BUDGET_MS
        || (
          previousReplyAt !== null
          && replyAt - previousReplyAt >= CANARY_REPLY_BUDGET_MS
        )
      ) {
        throwCanaryFailure("reply-latency-budget-exceeded");
      }
      assertLinqProductionCanaryReply({ reply, turn });
      turns.push({ latencyMs, turn });
      previousReplyAt = replyAt;
    }

    return { reset, turns };
  } finally {
    await app.stop();
  }
}

export async function waitForLinqProductionCanaryReply(input: {
  inbound: AsyncIterator<[Space, Message]>;
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
  if (
    (input.turn === 1
      && input.reply !== MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE)
    || (
      input.turn > 1
      && input.reply === MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE
    )
  ) {
    throwCanaryFailure("reply-semantics-invalid");
  }
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
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function throwCanaryFailure(code: string): never {
  const error = new Error("The Linq production canary failed.");
  error.name = code;
  throw error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLinqProductionCanary()
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
