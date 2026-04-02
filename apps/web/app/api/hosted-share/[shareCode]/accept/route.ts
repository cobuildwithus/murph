import { acceptHostedShareLink } from "@/src/lib/hosted-share/service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedPrivyRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareCode: string }> },
) => {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requireHostedPrivyRequestAuthContext(request);
    const { shareCode } = await context.params;
    return jsonOk(
      await acceptHostedShareLink({
        member: auth.member,
        shareCode: decodeURIComponent(shareCode),
      }),
    );
});
