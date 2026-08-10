import {
  buildCompanionHealthMetadataDirtyResource,
  COMPANION_HEALTH_METADATA_BODY_LIMIT_BYTES,
  parseCompanionHealthMetadataBatch,
  resolveCompanionHealthMetadataConnection,
} from "@/src/lib/device-sync/companion";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { persistHostedDeviceSyncCompanionMetadata } from "@/src/lib/device-sync/wake-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import { requireHostedCompanionMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

// Companion-only, bearer-authenticated ingestion for two closed custom
// metadata values selected by WHOOP-named HealthKit keys. The keys are an
// unverified provider hint, not server-attested provenance. The batch is
// durably encrypted into device-sync dirty state and reaches the vault only
// through device-syncd, importers, and core; this route never writes
// canonical health data itself.
export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireHostedCompanionMemberAuthFromBearerToken(request, prisma);
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: auth.member.id,
    prisma,
  });

  const occurredAt = new Date().toISOString();
  const batch = parseCompanionHealthMetadataBatch(
    await readCompanionHealthMetadataBody(request),
    occurredAt,
  );
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const connection = await resolveCompanionHealthMetadataConnection({
    memberId: auth.member.id,
    store: controlPlane.store,
  });
  await persistHostedDeviceSyncCompanionMetadata({
    connectionId: connection.id,
    occurredAt,
    resource: buildCompanionHealthMetadataDirtyResource({ batch, occurredAt }),
    store: controlPlane.store,
    userId: auth.member.id,
  });

  return jsonOk({ acceptedCount: batch.records.length });
});

async function readCompanionHealthMetadataBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await readJsonObject(request, {
      limitBytes: COMPANION_HEALTH_METADATA_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw deviceSyncError({
        code: "COMPANION_REQUEST_INVALID",
        httpStatus: 400,
        message: "Companion health metadata must be valid JSON.",
        retryable: false,
      });
    }
    throw error;
  }
}
