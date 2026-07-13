import {
  drainPendingHostedGroupJoinConfirmations,
  isHostedGroupJoinConfirmationProducerEnabled,
} from "@/src/lib/hosted-groups/group-join-confirmation";
import {
  isHostedGroupJoinConfirmationRolloutRequestAuthorized,
  requireHostedGroupJoinConfirmationRolloutRequest,
} from "@/src/lib/hosted-groups/group-join-confirmation-rollout-auth";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 4 * 1024;

export const GET = withJsonError(async (request: Request) =>
  jsonOk({
    authorized: isHostedGroupJoinConfirmationRolloutRequestAuthorized(request),
    enabled: isHostedGroupJoinConfirmationProducerEnabled(),
  }));

export const POST = withJsonError(async (request: Request) => {
  requireHostedGroupJoinConfirmationRolloutRequest(request);
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_GROUP_JOIN_CONFIRMATION_ROLLOUT_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Group join confirmation rollout request is too large.",
  });

  return jsonOk(await drainPendingHostedGroupJoinConfirmations({
    cursor: typeof body.cursor === "string" ? body.cursor : null,
    ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
  }));
});
