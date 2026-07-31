import "server-only";

import { createHash } from "node:crypto";

import {
  parseHostedRuntimeProductFeedbackRecordRequest,
} from "@murphai/hosted-execution/parsers";
import {
  type HostedRuntimeProductFeedbackRecord,
  type HostedRuntimeProductFeedbackRecordResponse,
} from "@murphai/hosted-execution/runtime-control";

import { resolveChangelogCardItems } from "@/src/lib/changelog";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getPrisma } from "@/src/lib/prisma";

export async function recordHostedProductFeedback(input: {
  feedback: HostedRuntimeProductFeedbackRecord;
  memberId?: string | null;
}): Promise<HostedRuntimeProductFeedbackRecordResponse> {
  const feedback = normalizeHostedProductFeedback(input.feedback);
  const feedbackId = buildHostedProductFeedbackId({
    feedback: input.feedback,
  });
  const result = await getPrisma().hostedProductFeedback.createMany({
    data: [
      {
        id: feedbackId,
        kind: feedback.kind,
        memberId: input.memberId ?? null,
        relatedChangelogItemIdsJson: [...feedback.relatedChangelogItemIds],
        summary: formatHostedProductFeedbackSummary(feedback),
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
  let parsed: HostedRuntimeProductFeedbackRecord;
  try {
    parsed = parseHostedRuntimeProductFeedbackRecordRequest({ feedback }).feedback;
  } catch {
    rejectHostedProductFeedback();
  }

  if (
    parsed.relatedChangelogItemIds.length > 0 &&
    !resolveChangelogCardItems(parsed.relatedChangelogItemIds)
  ) {
    rejectHostedProductFeedback();
  }

  return parsed;
}

export function formatHostedProductFeedbackSummary(
  feedback: Pick<
    HostedRuntimeProductFeedbackRecord,
    "action" | "outcome" | "productArea"
  >,
): string {
  return [
    `product_area=${feedback.productArea}`,
    `action=${feedback.action}`,
    `outcome=${feedback.outcome}`,
  ].join("; ");
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

function rejectHostedProductFeedback(): never {
  throw hostedOnboardingError({
    code: "HOSTED_PRODUCT_FEEDBACK_REJECTED",
    httpStatus: 400,
    message: "Product feedback must use the closed product abstraction and reference published changelog items when changelog ids are present.",
  });
}
