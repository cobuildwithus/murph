import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  HOSTED_VAULT_SYNC_PAYLOAD_SCHEMA,
  isHostedVaultSyncPayloadTerminalStatus,
  normalizeHostedVaultSyncSessionStatus,
  projectHostedVaultSyncPayload,
} from "@/src/lib/vault-sync/shared";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request);
  const sessionId = await resolveDecodedRouteParam(context.params, "sessionId");
  const prisma = getPrisma();
  const now = new Date();
  const fetchedAt = now.toISOString();
  const record = await prisma.hostedVaultSyncPayload.findUnique({
    where: { sessionId },
    include: { session: true },
  });
  const sessionStatus = record
    ? normalizeHostedVaultSyncSessionStatus(record.session, now)
    : null;
  const unavailable = Boolean(
    sessionStatus
    && isHostedVaultSyncPayloadTerminalStatus(sessionStatus),
  );
  const owned = Boolean(record && record.memberId === memberId);
  if (!record || !owned || unavailable) {
    return jsonOk({
      fetchedAt,
      payload: null,
      unavailable: {
        code: resolveHostedVaultSyncPayloadUnavailableCode({
          owned,
          record,
          sessionStatus,
          unavailable,
        }),
        retryable: false,
      },
    });
  }
  return jsonOk({
    fetchedAt,
    payload: {
      ...projectHostedVaultSyncPayload(record),
      payloadSchema: HOSTED_VAULT_SYNC_PAYLOAD_SCHEMA,
    },
    unavailable: null,
  });
});

function resolveHostedVaultSyncPayloadUnavailableCode(input: {
  owned: boolean;
  record: unknown | null;
  sessionStatus: string | null;
  unavailable: boolean;
}): "expired" | "gone" | "not_found" {
  if (!input.record || !input.owned || !input.unavailable) {
    return "not_found";
  }
  if (input.sessionStatus === "expired") {
    return "expired";
  }
  return "gone";
}
