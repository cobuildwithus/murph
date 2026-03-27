import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonError, jsonOk, readJsonObject } from "@/src/lib/hosted-onboarding/http";
import { attachHostedSessionCookie, completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/service";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const identityToken = typeof body.identityToken === "string" ? body.identityToken : null;

    if (!identityToken) {
      throw hostedOnboardingError({
        code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
        message: "A Privy identity token is required to continue.",
        httpStatus: 400,
      });
    }

    const result = await completeHostedPrivyVerification({
      identityToken,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      userAgent: request.headers.get("user-agent"),
    });
    const response = jsonOk({
      inviteCode: result.inviteCode,
      joinUrl: result.joinUrl,
      ok: true,
      stage: result.stage,
    });

    attachHostedSessionCookie({
      expiresAt: result.expiresAt,
      response,
      token: result.token,
    });

    return response;
  } catch (error) {
    return jsonError(error);
  }
}
