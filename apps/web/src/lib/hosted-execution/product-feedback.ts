import "server-only";

import { createHash } from "node:crypto";

import {
  HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
  HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
  isHostedProductSupportEscalationFeedback,
  isHostedProductSupportEscalationSummary,
  sanitizeHostedProductFeedbackSummary,
  type HostedRuntimeProductFeedbackRecord,
  type HostedRuntimeProductFeedbackRecordResponse,
} from "@murphai/hosted-execution/runtime-control";

import { resolveChangelogCardItems } from "@/src/lib/changelog";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readHostedOperationalAlertEmailConfig } from "@/src/lib/hosted-onboarding/operational-alert-email-config";
import { sendHostedResendPlainTextEmail } from "@/src/lib/hosted-onboarding/resend-plain-text-email";
import { getPrisma } from "@/src/lib/prisma";

export const HOSTED_PRODUCT_SUPPORT_EMAIL = "support@withmurph.ai";
export const HOSTED_PRODUCT_SUPPORT_EMAILS_PER_MEMBER_UTC_DAY_MAX = 3;
// The support alert and its member-linked marker carry only server-authored
// text because that path deliberately sends identity to an operator. Ordinary
// stored feedback may be linked to a private member, but stays bounded and
// sanitized and is never emailed beside that identity by this service.
export const HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY =
  "Support escalation: member-requested product support escalation.";

export {
  HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
  isHostedProductSupportEscalationFeedback,
  isHostedProductSupportEscalationSummary,
} from "@murphai/hosted-execution/runtime-control";

const HOSTED_PRODUCT_SUPPORT_RECIPIENTS_ENV = "HOSTED_LINQ_ALERT_EMAILS";
const HOSTED_PRODUCT_SUPPORT_SUBJECT = "Murph support escalation";
const HOSTED_PRODUCT_SUPPORT_LOCK_NAMESPACE = "hosted-product-support";
const DAY_MS = 24 * 60 * 60 * 1_000;

export async function recordHostedProductFeedback(input: {
  env?: Readonly<Record<string, string | undefined>>;
  feedback: HostedRuntimeProductFeedbackRecord;
  memberId?: string | null;
  now?: Date;
  sendEmail?: typeof sendHostedResendPlainTextEmail;
  signal?: AbortSignal;
}): Promise<HostedRuntimeProductFeedbackRecordResponse> {
  const feedback = normalizeHostedProductFeedback(input.feedback);
  const feedbackId = buildHostedProductFeedbackId({
    feedback: input.feedback,
  });
  // The reserved prefix is itself the support-path discriminator. Fail closed
  // below when the remainder is missing or the reserved kind/linkage contract
  // is invalid instead of persisting it as ordinary feedback.
  const supportEscalation = feedback.summary.startsWith(
    HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
  );

  if (!supportEscalation) {
    return await persistHostedProductFeedback({
      feedback,
      feedbackId,
      memberId: await resolveOrdinaryHostedProductFeedbackMemberId(
        input.memberId,
      ),
    });
  }
  if (!isHostedProductSupportEscalationFeedback(feedback)) {
    rejectHostedProductSupportEscalation();
  }

  const memberId = input.memberId?.trim();
  if (!memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_PRODUCT_SUPPORT_MEMBER_REQUIRED",
      httpStatus: 400,
      message: "Product support escalation requires an authenticated member.",
    });
  }

  if (input.now && !Number.isFinite(input.now.getTime())) {
    throw new RangeError("Product support escalation time must be valid.");
  }
  const detailFeedbackId = buildHostedProductSupportDetailFeedbackId(feedbackId);
  const detailSummary = feedback.summary
    .slice(HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX.length)
    .trim();

  const persistence = await getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${HOSTED_PRODUCT_SUPPORT_LOCK_NAMESPACE}),
        hashtext(${memberId})
      )
    `;
    // Captured after the advisory lock so same-member escalations get
    // timestamps ordered with lock acquisition; a pre-lock timestamp could
    // rank a later-committed row before already-emailed rows and overshoot
    // the daily email cap.
    const now = input.now ?? new Date();

    const threadContainer = await tx.hostedThreadContainer.findUnique({
      select: { memberId: true },
      where: { memberId },
    });
    if (threadContainer) {
      throw hostedOnboardingError({
        code: "HOSTED_PRODUCT_SUPPORT_PRIVATE_MEMBER_REQUIRED",
        httpStatus: 403,
        message: "Account-linked product support escalation requires a private member runtime.",
      });
    }

    const created = await tx.hostedProductFeedback.createMany({
      data: [
        {
          createdAt: now,
          id: feedbackId,
          kind: feedback.kind,
          memberId,
          relatedChangelogItemIdsJson: [...feedback.relatedChangelogItemIds],
          summary: HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
        },
        {
          createdAt: now,
          id: detailFeedbackId,
          kind: feedback.kind,
          memberId: null,
          relatedChangelogItemIdsJson: [...feedback.relatedChangelogItemIds],
          summary: detailSummary,
        },
      ],
      skipDuplicates: true,
    });
    const row = await tx.hostedProductFeedback.findUnique({
      select: {
        createdAt: true,
        id: true,
        kind: true,
        memberId: true,
        relatedChangelogItemIdsJson: true,
        summary: true,
      },
      where: { id: feedbackId },
    });

    if (
      !row
      || row.memberId !== memberId
      || row.kind !== feedback.kind
      || row.summary !== HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY
      || !isEmptyJsonArray(row.relatedChangelogItemIdsJson)
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_PRODUCT_SUPPORT_IDEMPOTENCY_CONFLICT",
        httpStatus: 409,
        message: "Product support escalation idempotency key is already bound to different feedback.",
      });
    }

    const day = resolveUtcDayWindow(row.createdAt);
    const ordinal = await tx.hostedProductFeedback.count({
      where: {
        createdAt: {
          gte: day.startAt,
          lt: day.endAt,
        },
        kind: "frustration",
        memberId,
        OR: [
          {
            createdAt: {
              lt: row.createdAt,
            },
          },
          {
            createdAt: row.createdAt,
            id: {
              lte: row.id,
            },
          },
        ],
        summary: {
          startsWith: HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
        },
      },
    });

    return {
      recorded: created.count > 0,
      shouldSendEmail:
        ordinal <= HOSTED_PRODUCT_SUPPORT_EMAILS_PER_MEMBER_UTC_DAY_MAX,
    };
  });

  if (persistence.shouldSendEmail) {
    const emailConfig = readHostedOperationalAlertEmailConfig(
      {
        ...(input.env ?? process.env),
        [HOSTED_PRODUCT_SUPPORT_RECIPIENTS_ENV]: HOSTED_PRODUCT_SUPPORT_EMAIL,
      },
      HOSTED_PRODUCT_SUPPORT_RECIPIENTS_ENV,
    );
    if (!emailConfig) {
      throw hostedOnboardingError({
        code: "HOSTED_PRODUCT_SUPPORT_EMAIL_NOT_CONFIGURED",
        httpStatus: 503,
        message: "Product support escalation email is not configured.",
      });
    }

    await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
      config: emailConfig.resend,
      idempotencyKey: `hosted-product-support/${feedbackId}`,
      ...(input.signal ? { signal: input.signal } : {}),
      subject: `${HOSTED_PRODUCT_SUPPORT_SUBJECT} — ${feedbackId}`,
      text: formatHostedProductSupportEmail({
        feedbackId,
        memberId,
      }),
      to: emailConfig.recipients,
    });
  }

  return {
    feedbackId,
    recorded: persistence.recorded,
  };
}

export function normalizeHostedProductFeedback(
  feedback: HostedRuntimeProductFeedbackRecord,
): HostedRuntimeProductFeedbackRecord {
  const summary = sanitizeHostedProductFeedbackSummary(feedback.summary);
  if (
    summary.length === 0 ||
    summary.length > HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH ||
    (feedback.relatedChangelogItemIds.length > 0 &&
      !resolveChangelogCardItems(feedback.relatedChangelogItemIds))
  ) {
    rejectHostedProductFeedback();
  }

  return {
    idempotencyKey: feedback.idempotencyKey,
    kind: feedback.kind,
    relatedChangelogItemIds: [...feedback.relatedChangelogItemIds],
    summary,
  };
}

export function buildHostedProductFeedbackId(input: {
  feedback: Pick<HostedRuntimeProductFeedbackRecord, "idempotencyKey">;
}): string {
  const digest = createHash("sha256")
    .update(input.feedback.idempotencyKey)
    .digest("hex")
    .slice(0, 32);
  return `product_feedback_${digest}`;
}

async function resolveOrdinaryHostedProductFeedbackMemberId(
  memberId: string | null | undefined,
): Promise<string | null> {
  const normalizedMemberId = memberId?.trim();
  if (!normalizedMemberId) {
    return null;
  }

  // Group callbacks are bound to a synthetic hosted member row, not the human
  // speaker who expressed the feedback. Keep those rows anonymous rather than
  // making the synthetic runtime look like a messageable person.
  const threadContainer = await getPrisma().hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: normalizedMemberId },
  });

  return threadContainer ? null : normalizedMemberId;
}

async function persistHostedProductFeedback(input: {
  feedback: HostedRuntimeProductFeedbackRecord;
  feedbackId: string;
  memberId: string | null;
}): Promise<HostedRuntimeProductFeedbackRecordResponse> {
  const result = await getPrisma().hostedProductFeedback.createMany({
    data: [
      {
        id: input.feedbackId,
        kind: input.feedback.kind,
        memberId: input.memberId,
        relatedChangelogItemIdsJson: [
          ...input.feedback.relatedChangelogItemIds,
        ],
        summary: input.feedback.summary,
      },
    ],
    skipDuplicates: true,
  });

  return {
    feedbackId: input.feedbackId,
    recorded: result.count === 1,
  };
}

// The email is deliberately metadata-only: model-authored issue text, even
// after the shared scrub, can retain semantic private details and must never
// travel beside member identity. The de-identified issue text lives only in
// the separate anonymous detail row.
function formatHostedProductSupportEmail(input: {
  feedbackId: string;
  memberId: string;
}): string {
  return [
    "A Murph member explicitly asked to escalate a product issue.",
    "",
    `Feedback ID: ${input.feedbackId}`,
    `Member ID: ${input.memberId}`,
  ].join("\n");
}

export function buildHostedProductSupportDetailFeedbackId(
  feedbackId: string,
): string {
  const digest = createHash("sha256")
    .update(`${feedbackId}:support-detail`)
    .digest("hex");
  return `product_feedback_${digest}`;
}

function resolveUtcDayWindow(value: Date): {
  endAt: Date;
  startAt: Date;
} {
  const startAt = new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
  return {
    endAt: new Date(startAt.getTime() + DAY_MS),
    startAt,
  };
}

function isEmptyJsonArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function rejectHostedProductSupportEscalation(): never {
  throw hostedOnboardingError({
    code: "HOSTED_PRODUCT_SUPPORT_REJECTED",
    httpStatus: 400,
    message: "Product support escalation must be a frustration without changelog references.",
  });
}

function rejectHostedProductFeedback(): never {
  throw hostedOnboardingError({
    code: "HOSTED_PRODUCT_FEEDBACK_REJECTED",
    httpStatus: 400,
    message: "Product feedback must include a bounded summary and reference published changelog items when changelog ids are present.",
  });
}
