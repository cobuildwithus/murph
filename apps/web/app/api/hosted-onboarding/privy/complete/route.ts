import { jsonError, jsonOk, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { requireHostedPrivyIdentityFromCookies } from "@/src/lib/hosted-onboarding/privy";
import { applyHostedSessionCookie } from "@/src/lib/hosted-onboarding/session";

export async function POST(request: Request) {
  try {
    const identity = await requireHostedPrivyIdentityFromCookies();
    const body = await readOptionalJsonObject(request);
    const result = await completeHostedPrivyVerification({
      identity,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      userAgent: request.headers.get("user-agent"),
    });
    const response = jsonOk({
      inviteCode: result.inviteCode,
      joinUrl: result.joinUrl,
      ok: true,
      stage: result.stage,
    });

    applyHostedSessionCookie(response, result.token, result.expiresAt);

    return response;
  } catch (error) {
    return jsonError(error);
  }
}
