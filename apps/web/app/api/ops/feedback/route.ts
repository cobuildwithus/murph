import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  listHostedOpsFeedback,
  listHostedFeedbackDiagnostics,
  requestHostedFeedbackDiagnostic,
} from "@/src/lib/hosted-ops/feedback";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readHostedOnboardingJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";

export const GET = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request);
  const params = new URL(request.url).searchParams;
  const after = params.has("after") ? readText(params.get("after"), 256) : undefined;
  const feedbackId = params.get("feedbackId");
  return jsonOk(feedbackId
    ? await listHostedFeedbackDiagnostics({ feedbackId: readText(feedbackId, 256), after })
    : await listHostedOpsFeedback(after));
});

export const POST = withJsonError(async (request: Request) => {
  const session = await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 8 * 1024,
    tooLargeErrorCode: "HOSTED_FEEDBACK_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Feedback diagnostic question is too large.",
  });
  if (Object.keys(body).some((key) => !["feedbackId", "question", "idempotencyKey"].includes(key))) {
    throw invalidInput();
  }
  return jsonOk(await requestHostedFeedbackDiagnostic({
    feedbackId: readText(body.feedbackId, 256),
    question: readText(body.question, 1200),
    idempotencyKey: readText(body.idempotencyKey, 256),
    requestedByMemberId: session.member.id,
    signal: request.signal,
  }));
});

function readText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > max) {
    throw invalidInput();
  }
  return value.trim();
}

function invalidInput() {
  return hostedOnboardingError({
    code: "HOSTED_FEEDBACK_INPUT_INVALID", httpStatus: 400,
    message: "Provide a feedback id, a bounded diagnostic question, and an idempotency key.",
    retryable: false,
  });
}
