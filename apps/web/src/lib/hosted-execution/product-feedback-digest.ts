import "server-only";

import {
  addDaysToIsoDate,
  formatTimeZoneDateTimeParts,
} from "@murphai/contracts";

import { readHostedOperationalAlertEmailConfig } from "../hosted-onboarding/operational-alert-email-config";
import { sendHostedResendPlainTextEmail } from "../hosted-onboarding/resend-plain-text-email";
import { getPrisma } from "../prisma";

export const HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE = "America/New_York";
export const HOSTED_PRODUCT_FEEDBACK_DIGEST_SEND_HOUR = 18;
export const HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS = 200;

const HOSTED_PRODUCT_FEEDBACK_DIGEST_RECIPIENTS_ENV =
  "HOSTED_PRODUCT_FEEDBACK_DIGEST_EMAILS";
const HOSTED_PRODUCT_FEEDBACK_DIGEST_SUBJECT = "Murph feedback";

export type HostedProductFeedbackDigestBatch = {
  summaries: string[];
  truncated: boolean;
};

export type HostedProductFeedbackDigestOutcome =
  | "not_configured"
  | "outside_send_hour"
  | "sent";

export type HostedProductFeedbackDigestResult = {
  dayKey: string;
  feedbackCount: number;
  outcome: HostedProductFeedbackDigestOutcome;
  timeZone: typeof HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE;
  truncated: boolean;
  windowEndAt: string | null;
  windowStartAt: string | null;
};

export async function runHostedProductFeedbackDigest(input: {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  readFeedback?: typeof readHostedProductFeedbackDigestBatch;
  sendEmail?: typeof sendHostedResendPlainTextEmail;
  signal?: AbortSignal;
} = {}): Promise<HostedProductFeedbackDigestResult> {
  const now = input.now ?? new Date();
  const localNow = formatTimeZoneDateTimeParts(
    now,
    HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE,
  );

  if (localNow.hour !== HOSTED_PRODUCT_FEEDBACK_DIGEST_SEND_HOUR) {
    return {
      dayKey: localNow.dayKey,
      feedbackCount: 0,
      outcome: "outside_send_hour",
      timeZone: HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE,
      truncated: false,
      windowEndAt: null,
      windowStartAt: null,
    };
  }

  const window = resolveHostedProductFeedbackDigestWindow(now);
  const emailConfig = readHostedOperationalAlertEmailConfig(
    input.env ?? process.env,
    HOSTED_PRODUCT_FEEDBACK_DIGEST_RECIPIENTS_ENV,
  );
  if (!emailConfig) {
    return {
      dayKey: window.dayKey,
      feedbackCount: 0,
      outcome: "not_configured",
      timeZone: HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE,
      truncated: false,
      windowEndAt: window.endAt.toISOString(),
      windowStartAt: window.startAt.toISOString(),
    };
  }

  const batch = await (
    input.readFeedback ?? readHostedProductFeedbackDigestBatch
  )({
    endAt: window.endAt,
    startAt: window.startAt,
  });

  await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
    config: emailConfig.resend,
    idempotencyKey: `hosted-product-feedback-digest/${window.dayKey}`,
    ...(input.signal ? { signal: input.signal } : {}),
    subject: `${HOSTED_PRODUCT_FEEDBACK_DIGEST_SUBJECT} — ${window.dayKey}`,
    text: formatHostedProductFeedbackDigest(batch),
    to: emailConfig.recipients,
  });

  return {
    dayKey: window.dayKey,
    feedbackCount: batch.summaries.length,
    outcome: "sent",
    timeZone: HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE,
    truncated: batch.truncated,
    windowEndAt: window.endAt.toISOString(),
    windowStartAt: window.startAt.toISOString(),
  };
}

export function resolveHostedProductFeedbackDigestWindow(now: Date): {
  dayKey: string;
  endAt: Date;
  startAt: Date;
} {
  const dayKey = formatTimeZoneDateTimeParts(
    now,
    HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE,
  ).dayKey;

  return {
    dayKey,
    endAt: resolveHostedProductFeedbackDigestBoundary(dayKey),
    startAt: resolveHostedProductFeedbackDigestBoundary(
      addDaysToIsoDate(dayKey, -1),
    ),
  };
}

export async function readHostedProductFeedbackDigestBatch(input: {
  endAt: Date;
  startAt: Date;
}): Promise<HostedProductFeedbackDigestBatch> {
  const rows = await getPrisma().hostedProductFeedback.findMany({
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      summary: true,
    },
    take: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS + 1,
    where: {
      createdAt: {
        gte: input.startAt,
        lt: input.endAt,
      },
      summary: {
        not: null,
      },
    },
  });

  return {
    summaries: rows
      .slice(0, HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS)
      .flatMap(({ summary }) =>
        typeof summary === "string" && summary.length > 0 ? [summary] : []
      ),
    truncated: rows.length > HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS,
  };
}

function formatHostedProductFeedbackDigest(
  batch: HostedProductFeedbackDigestBatch,
): string {
  const lines = batch.summaries.map((summary) => `- ${summary}`);

  if (lines.length === 0) {
    lines.push("- No feedback logged.");
  }
  if (batch.truncated) {
    lines.push(
      `- Additional feedback omitted from this email after the ${HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS}-item safety limit.`,
    );
  }

  return lines.join("\n");
}

function resolveHostedProductFeedbackDigestBoundary(dayKey: string): Date {
  const year = Number(dayKey.slice(0, 4));
  const month = Number(dayKey.slice(5, 7));
  const day = Number(dayKey.slice(8, 10));
  const targetWallClockMs = Date.UTC(
    year,
    month - 1,
    day,
    HOSTED_PRODUCT_FEEDBACK_DIGEST_SEND_HOUR,
  );
  let candidateMs = targetWallClockMs;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = formatTimeZoneDateTimeParts(
      candidateMs,
      HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE,
    );
    const candidateWallClockMs = Date.UTC(
      candidate.year,
      candidate.month - 1,
      candidate.day,
      candidate.hour,
      candidate.minute,
      candidate.second,
    );
    const adjustmentMs = targetWallClockMs - candidateWallClockMs;
    candidateMs += adjustmentMs;

    if (adjustmentMs === 0) {
      return new Date(candidateMs);
    }
  }

  throw new RangeError([
    `Unable to resolve ${dayKey}`,
    `at ${HOSTED_PRODUCT_FEEDBACK_DIGEST_SEND_HOUR}:00`,
    `in ${HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE}.`,
  ].join(" "));
}
