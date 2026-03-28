import { acceptHostedShareLink } from "@/src/lib/hosted-share/service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { requireHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export async function POST(
  request: Request,
  context: { params: Promise<{ shareCode: string }> },
) {
  try {
    assertHostedOnboardingMutationOrigin(request);
    const sessionRecord = await requireHostedSessionFromRequest(request);
    const { shareCode } = await context.params;
    return jsonOk(
      await acceptHostedShareLink({
        sessionRecord,
        shareCode: decodeURIComponent(shareCode),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
