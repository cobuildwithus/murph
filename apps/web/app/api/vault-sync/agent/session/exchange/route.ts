import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { exchangeHostedVaultSyncPairingCode } from "@/src/lib/vault-sync/session-service";

export const POST = withJsonError(async (request: Request) => {
  const body = await readJsonObject(request);
  const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode : null;
  if (!pairingCode) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_PAIRING_CODE_REQUIRED",
      httpStatus: 400,
      message: "A vault sync pairing code is required.",
    });
  }
  const result = await exchangeHostedVaultSyncPairingCode({ pairingCode });
  return jsonOk({
    agentToken: result.agentToken,
    ok: true,
    session: result.session,
  });
});
