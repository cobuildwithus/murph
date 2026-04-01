import { acceptHostedShareLink } from "@/src/lib/hosted-share/service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareCode: string }> },
) => {
    assertHostedOnboardingMutationOrigin(request);
    const sessionRecord = await requireHostedSessionFromRequest(request);
    const { shareCode } = await context.params;
    return jsonOk(
      await acceptHostedShareLink({
        sessionRecord,
        shareCode: decodeURIComponent(shareCode),
      }),
    );
});
