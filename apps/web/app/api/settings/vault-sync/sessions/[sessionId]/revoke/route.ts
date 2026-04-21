import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireActivePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { revokeHostedVaultSyncSession } from "@/src/lib/vault-sync/session-service";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActivePrivyMemberAuth(request);
  const sessionId = await resolveDecodedRouteParam(context.params, "sessionId");
  return jsonOk({
    ok: true,
    session: await revokeHostedVaultSyncSession({
      memberId: auth.member.id,
      sessionId,
    }),
  });
});
