import {
  drainPendingHostedGroupJoinConfirmations,
} from "@/src/lib/hosted-groups/group-join-confirmation";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_GROUP_JOIN_CONFIRMATION_DRAIN_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted group join confirmation drain request is too large.",
  });

  return jsonOk(await drainPendingHostedGroupJoinConfirmations({
    cursor: typeof body.cursor === "string" ? body.cursor : null,
    ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
  }));
});
