import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  deleteHostedVaultSyncPayload,
  isHostedVaultSyncPayloadTerminalStatus,
  projectHostedVaultSyncPayload,
} from "@/src/lib/vault-sync/shared";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request);
  const sessionId = await resolveDecodedRouteParam(context.params, "sessionId");
  const prisma = getPrisma();
  const record = await prisma.hostedVaultSyncPayload.findUnique({
    where: { sessionId },
    include: { session: true },
  });
  const unavailable = Boolean(
    record
    && (
      record.session.revokedAt
      || record.session.expiresAt <= new Date()
      || isHostedVaultSyncPayloadTerminalStatus(record.session.status)
    ),
  );
  if (record && record.memberId === memberId && unavailable) {
    await deleteHostedVaultSyncPayload({
      memberId,
      prisma,
      sessionId,
    });
  }
  if (!record || record.memberId !== memberId || unavailable) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_PAYLOAD_NOT_FOUND",
      httpStatus: 404,
      message: "That vault sync payload is not available.",
    });
  }
  return jsonOk(projectHostedVaultSyncPayload(record));
});
