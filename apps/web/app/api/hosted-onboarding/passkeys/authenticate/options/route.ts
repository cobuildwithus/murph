import { beginHostedPasskeyAuthentication } from "@/src/lib/hosted-onboarding/service";
import { jsonError, jsonOk, readJsonObject } from "@/src/lib/hosted-onboarding/http";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;

    if (!inviteCode) {
      throw new TypeError("inviteCode is required.");
    }

    return jsonOk(await beginHostedPasskeyAuthentication({ inviteCode }));
  } catch (error) {
    return jsonError(error);
  }
}
