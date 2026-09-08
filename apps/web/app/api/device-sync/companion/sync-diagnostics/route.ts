import { parseCompanionSyncDiagnostic, COMPANION_SYNC_DIAGNOSTIC_BODY_LIMIT } from "@/src/lib/device-sync/companion-sync-diagnostics";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireActivePrivyMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { writeHostedRuntimeLogs } from "@/src/lib/hosted-runtime-log/write";
import { readOptionalJsonObject } from "@/src/lib/http";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const body = await readOptionalJsonObject(request, { limitBytes: COMPANION_SYNC_DIAGNOSTIC_BODY_LIMIT });
  const entry = parseCompanionSyncDiagnostic(body);
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedHistoricalLaunchConsentGranted({ memberId: auth.member.id, prisma });
  // The existing store owns subject hashing, deletion fencing, retention and
  // a serialized per-member cap. Diagnostic failure cannot initiate sync work.
  const recorded = await writeHostedRuntimeLogs({ entries: [entry], userId: auth.member.id });
  return jsonOk({ recorded: recorded === 1 });
});
