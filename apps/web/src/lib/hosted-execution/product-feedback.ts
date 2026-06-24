import "server-only";

import { createHash } from "node:crypto";

import {
  HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
  type HostedRuntimeProductFeedbackRecord,
  type HostedRuntimeProductFeedbackRecordResponse,
} from "@murphai/hosted-execution/runtime-control";

import { resolveChangelogCardItems } from "@/src/lib/changelog";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getPrisma } from "@/src/lib/prisma";

export async function recordHostedProductFeedback(input: {
  feedback: HostedRuntimeProductFeedbackRecord;
  memberId: string;
}): Promise<HostedRuntimeProductFeedbackRecordResponse> {
  const feedback = normalizeHostedProductFeedback(input.feedback);
  const feedbackId = buildHostedProductFeedbackId(input);
  const result = await getPrisma().hostedProductFeedback.createMany({
    data: [
      {
        id: feedbackId,
        kind: feedback.kind,
        memberId: input.memberId,
        relatedChangelogItemIdsJson: [...feedback.relatedChangelogItemIds],
        summary: feedback.summary,
      },
    ],
    skipDuplicates: true,
  });

  return {
    feedbackId,
    recorded: result.count === 1,
  };
}

export function normalizeHostedProductFeedback(
  feedback: HostedRuntimeProductFeedbackRecord,
): HostedRuntimeProductFeedbackRecord {
  const summary = feedback.summary.trim().replace(/\s+/gu, " ");
  if (
    summary.length === 0 ||
    summary.length > HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH ||
    (feedback.kind === "feature_interest" &&
      feedback.relatedChangelogItemIds.length === 0) ||
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
  memberId: string;
}): string {
  const digest = createHash("sha256")
    .update(input.memberId)
    .update("\0")
    .update(input.feedback.idempotencyKey)
    .digest("hex")
    .slice(0, 32);
  return `product_feedback_${digest}`;
}

function rejectHostedProductFeedback(): never {
  throw hostedOnboardingError({
    code: "HOSTED_PRODUCT_FEEDBACK_REJECTED",
    httpStatus: 400,
    message: "Product feedback must include a bounded summary and reference published changelog items when changelog ids are present.",
  });
}
