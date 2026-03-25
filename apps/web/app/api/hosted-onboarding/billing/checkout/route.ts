import { jsonError, jsonOk, readJsonObject } from "@/src/lib/hosted-onboarding/http";
import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/service";
import { requireHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;

    if (!inviteCode) {
      throw new TypeError("inviteCode is required.");
    }

    const sessionRecord = await requireHostedSessionFromRequest(request);
    return jsonOk(
      await createHostedBillingCheckout({
        inviteCode,
        sessionRecord,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
