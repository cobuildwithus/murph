import { jsonError, jsonOk, readJsonObject } from "@/src/lib/hosted-onboarding/http";
import { attachHostedSessionCookie, finishHostedPasskeyAuthentication } from "@/src/lib/hosted-onboarding/service";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;

    if (!inviteCode) {
      throw new TypeError("inviteCode is required.");
    }

    const result = await finishHostedPasskeyAuthentication({
      inviteCode,
      response: body.response,
      userAgent: request.headers.get("user-agent"),
    });
    const response = jsonOk({
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
