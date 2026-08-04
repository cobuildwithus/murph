import "server-only";

import {
  addDaysToIsoDate,
  formatTimeZoneDateTimeParts,
} from "@murphai/contracts";
import {
  HOSTED_PRODUCT_FEEDBACK_KINDS,
  HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
  type HostedProductFeedbackKind,
} from "@murphai/hosted-execution/runtime-control";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
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
  counts: Record<HostedProductFeedbackKind, number>;
  summariesByKind: Record<HostedProductFeedbackKind, string[]>;
};

export type HostedProductFeedbackDigestOutcome =
  | "outside_send_hour"
  | "sent";

export type HostedProductFeedbackDigestResult = {
  dayKey: string;
  feedbackCount: number;
  outcome: HostedProductFeedbackDigestOutcome;
  timeZone: typeof HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE;
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
    throw hostedOnboardingError({
      code: "HOSTED_PRODUCT_FEEDBACK_DIGEST_NOT_CONFIGURED",
      httpStatus: 503,
      message: "Hosted product feedback digest email is not configured.",
    });
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
    feedbackCount: countHostedProductFeedbackDigestBatch(batch),
    outcome: "sent",
    timeZone: HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE,
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
  const digestRowFilter = {
    createdAt: {
      gte: input.startAt,
      lt: input.endAt,
    },
    kind: {
      in: [...HOSTED_PRODUCT_FEEDBACK_KINDS],
    },
    // Ordinary feedback is member-linked again and remains visible here. The
    // reserved support marker stays out because its separate anonymous detail
    // row carries the actionable issue summary.
    NOT: {
      summary: {
        startsWith: HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
      },
    },
    summary: {
      not: null,
    },
  };
  const groupedCounts = await getPrisma().hostedProductFeedback.groupBy({
    by: ["kind"],
    _count: {
      _all: true,
    },
    where: digestRowFilter,
  });
  const rows = await getPrisma().hostedProductFeedback.findMany({
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      kind: true,
      summary: true,
    },
    take: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS,
    where: digestRowFilter,
  });
  const counts = createEmptyHostedProductFeedbackDigestCounts();
  const summariesByKind = createEmptyHostedProductFeedbackDigestSummaries();

  for (const groupedCount of groupedCounts) {
    if (isHostedProductFeedbackKind(groupedCount.kind)) {
      counts[groupedCount.kind] = groupedCount._count._all;
    }
  }
  for (const row of rows) {
    if (
      isHostedProductFeedbackKind(row.kind) &&
      typeof row.summary === "string" &&
      row.summary.length > 0
    ) {
      summariesByKind[row.kind].push(row.summary);
    }
  }

  return { counts, summariesByKind };
}

function formatHostedProductFeedbackDigest(
  batch: HostedProductFeedbackDigestBatch,
): string {
  const labels: Record<HostedProductFeedbackKind, string> = {
    feature_interest: "Feature interest",
    feature_request: "Feature requests",
    frustration: "Product frustrations",
  };
  const sections = HOSTED_PRODUCT_FEEDBACK_KINDS.flatMap((kind) => {
    const count = batch.counts[kind];
    if (count === 0) {
      return [];
    }
    const summaries = batch.summariesByKind[kind];
    const omittedCount = count - summaries.length;
    return [[
      `${labels[kind]} (${count})`,
      ...summaries.map((summary) => `- ${summary}`),
      ...(omittedCount > 0
        ? [`- (${omittedCount} more not shown past the ${HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS}-item email limit)`]
        : []),
    ].join("\n")];
  });

  if (sections.length === 0) {
    sections.push("- No feedback logged.");
  }

  return sections.join("\n\n");
}

function countHostedProductFeedbackDigestBatch(
  batch: HostedProductFeedbackDigestBatch,
): number {
  return HOSTED_PRODUCT_FEEDBACK_KINDS.reduce(
    (total, kind) => total + batch.counts[kind],
    0,
  );
}

function createEmptyHostedProductFeedbackDigestCounts(): Record<
  HostedProductFeedbackKind,
  number
> {
  return {
    feature_interest: 0,
    feature_request: 0,
    frustration: 0,
  };
}

function createEmptyHostedProductFeedbackDigestSummaries(): Record<
  HostedProductFeedbackKind,
  string[]
> {
  return {
    feature_interest: [],
    feature_request: [],
    frustration: [],
  };
}

function isHostedProductFeedbackKind(
  value: string,
): value is HostedProductFeedbackKind {
  return HOSTED_PRODUCT_FEEDBACK_KINDS.some((kind) => kind === value);
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
