import { resolveDecodedRouteParam } from "@/src/lib/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { completeHostedVaultSyncAgentUpload } from "@/src/lib/vault-sync/session-service";
import { HOSTED_VAULT_SYNC_MAX_BUNDLE_BASE64_LENGTH } from "@/src/lib/vault-sync/shared";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) => {
  const sessionId = await resolveDecodedRouteParam(context.params, "sessionId");
  const body = await readJsonObject(request);
  const bundleBase64 = typeof body.bundleBase64 === "string" ? body.bundleBase64 : null;
  if (!bundleBase64) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_BUNDLE_REQUIRED",
      httpStatus: 400,
      message: "A vault sync import bundle is required.",
    });
  }
  if (bundleBase64.length > HOSTED_VAULT_SYNC_MAX_BUNDLE_BASE64_LENGTH) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_BUNDLE_TOO_LARGE",
      httpStatus: 413,
      message: "That vault sync bundle is too large for the first sync path. Try a smaller vault or wait for direct artifact upload support.",
    });
  }
  const localManifestHash = readOptionalString(body.localManifestHash);
  if (!localManifestHash) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_MANIFEST_HASH_REQUIRED",
      httpStatus: 400,
      message: "A vault sync import manifest hash is required.",
    });
  }
  const session = await completeHostedVaultSyncAgentUpload({
    bundleBase64,
    localManifestHash,
    request,
    sessionId,
    sourceSchemaVersion: readOptionalString(body.sourceSchemaVersion),
    sourceVaultId: readOptionalString(body.sourceVaultId),
    sourceVaultTitle: readOptionalString(body.sourceVaultTitle),
  });
  return jsonOk({ ok: true, session });
});

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
