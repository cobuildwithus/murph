import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { clearHostedSessionCookie } from "@/src/lib/hosted-onboarding/session";

export async function POST() {
  try {
    const response = jsonOk({ ok: true });
    clearHostedSessionCookie(response);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
