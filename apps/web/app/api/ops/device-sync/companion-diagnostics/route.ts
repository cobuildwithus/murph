import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { readHostedOpsCompanionSyncDiagnostics } from "@/src/lib/hosted-ops/companion-sync-diagnostics";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request);
  const memberId = new URL(request.url).searchParams.get("memberId");
  if (!memberId || !/^[A-Za-z0-9_.:-]{1,256}$/u.test(memberId)) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_MEMBER_REQUIRED", message: "Select a member.", httpStatus: 400,
    });
  }
  return jsonOk(await readHostedOpsCompanionSyncDiagnostics({ memberId, prisma: getPrisma() }));
});
