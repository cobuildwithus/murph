import {
  buildCompanionHealthMetadataDirtyResource,
  COMPANION_HEALTH_METADATA_BODY_LIMIT_BYTES,
  parseCompanionHealthMetadataBatch,
  resolveCompanionHealthMetadataConnection,
} from "@/src/lib/device-sync/companion";
import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { persistHostedDeviceSyncCompanionMetadata } from "@/src/lib/device-sync/wake-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import { requireActivePrivyMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

// Companion-only, bearer-authenticated ingestion for two closed custom
// metadata values selected by WHOOP-named HealthKit keys. The keys are an
// unverified provider hint, not server-attested provenance. The batch is
// durably encrypted into device-sync dirty state and reaches the vault only
// through device-syncd, importers, and core; this route never writes
// canonical health data itself.
export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });

  const occurredAt = new Date().toISOString();
  const batch = parseCompanionHealthMetadataBatch(
    await readJsonObject(request, {
      limitBytes: COMPANION_HEALTH_METADATA_BODY_LIMIT_BYTES,
    }),
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
