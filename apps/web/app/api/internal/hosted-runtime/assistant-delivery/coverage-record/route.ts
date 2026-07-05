import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  requireHostedRuntimeMailboxActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  advanceHostedMailboxConsumedSeqByLane,
} from "@/src/lib/hosted-mailbox/store";
import { readOptionalJsonObject } from "@/src/lib/http";

const HOSTED_ASSISTANT_DELIVERY_COVERAGE_BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_ASSISTANT_DELIVERY_COVERAGE_BODY_LIMIT_BYTES,
  });
  await requireHostedRuntimeMailboxActiveAccess(userId);
  const body = await readOptionalJsonObject(request);
  parseAcceptedAt(body.acceptedAt);
  const answeredCoverage = parseAnsweredCoverage(body.answeredCoverage);
  const idempotencyKey = readOptionalBodyString(body.idempotencyKey);
  const intentId = readOptionalBodyString(body.intentId);

  if (!idempotencyKey && !intentId) {
    throw hostedOnboardingError({
      code: "HOSTED_ASSISTANT_DELIVERY_COVERAGE_IDENTITY_MISSING",
      httpStatus: 400,
      message: "Hosted assistant delivery coverage requires a delivery identity.",
      retryable: false,
    });
  }

  const consumedSeqByLane = await advanceHostedMailboxConsumedSeqByLane({
    lanes: [{
      consumedSeq: answeredCoverage.laneSeq,
      lane: answeredCoverage.lane,
    }],
    userId,
  });

  return jsonOk({
    consumedSeqByLane,
    ok: true,
  });
});

function parseAcceptedAt(value: unknown): Date {
  const timestamp = readOptionalBodyString(value);
  if (!timestamp) {
    throw hostedOnboardingError({
      code: "HOSTED_ASSISTANT_DELIVERY_COVERAGE_ACCEPTED_AT_MISSING",
      httpStatus: 400,
      message: "Hosted assistant delivery coverage requires an accepted timestamp.",
      retryable: false,
    });
  }
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    throw hostedOnboardingError({
      code: "HOSTED_ASSISTANT_DELIVERY_COVERAGE_ACCEPTED_AT_INVALID",
      httpStatus: 400,
      message: "Hosted assistant delivery coverage accepted timestamp is invalid.",
      retryable: false,
    });
  }
  return date;
}

function parseAnsweredCoverage(value: unknown): {
  lane: "conversation";
  laneSeq: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_ASSISTANT_DELIVERY_COVERAGE_INVALID",
      httpStatus: 400,
      message: "Hosted assistant delivery coverage is invalid.",
      retryable: false,
    });
  }
  const record = value as Record<string, unknown>;
  if (record.lane !== "conversation") {
    throw hostedOnboardingError({
      code: "HOSTED_ASSISTANT_DELIVERY_COVERAGE_INVALID",
      httpStatus: 400,
      message: "Hosted assistant delivery coverage lane is invalid.",
      retryable: false,
    });
  }
  const laneSeq = readOptionalBodyString(record.laneSeq);
  if (!laneSeq) {
    throw hostedOnboardingError({
      code: "HOSTED_ASSISTANT_DELIVERY_COVERAGE_INVALID",
      httpStatus: 400,
      message: "Hosted assistant delivery coverage laneSeq is invalid.",
      retryable: false,
    });
  }
  return {
    lane: "conversation",
    laneSeq,
  };
}

function readOptionalBodyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
