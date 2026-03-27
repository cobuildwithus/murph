import { jsonError, jsonOk, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { requireHostedPrivyIdentityFromCookies } from "@/src/lib/hosted-onboarding/privy";
import { attachHostedSessionCookie, completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/service";

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
