import { readGameReportAudio } from "@/src/lib/game/report-review";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const GET = withJsonError(async (request: Request, context: { params: Promise<{ reportId: string }> }) => {
  await requireHostedOpsRequestAccess(request);
  const bytes = await readGameReportAudio(await resolveDecodedRouteParam(context.params, "reportId"));
  if (!bytes) throw hostedOnboardingError({ code: "HOSTED_OPS_GAME_REPORT_NOT_FOUND", httpStatus: 404, message: "Report not found." });
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "audio/mp4", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
});
