import { reviewGameReport } from "@/src/lib/game/report-review";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readHostedOnboardingJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/** One review of one game report: any of remove the post, end their games, suspend the member; then reviewed. */
export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 2 * 1024,
    tooLargeErrorCode: "HOSTED_OPS_GAME_REPORT_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Game report review request body is too large.",
  });
  const flag = (value: unknown) => value === true;
  if (typeof body.reportId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/u.test(body.reportId)) {
    throw hostedOnboardingError({ code: "HOSTED_OPS_GAME_REPORT_INVALID", httpStatus: 400, message: "Name one report." });
  }
  const result = await reviewGameReport({
    endGames: flag(body.endGames), removePost: flag(body.removePost), reportId: body.reportId, suspendMember: flag(body.suspendMember),
  });
  if (!result.found) throw hostedOnboardingError({ code: "HOSTED_OPS_GAME_REPORT_NOT_FOUND", httpStatus: 404, message: "Report not found." });
  return jsonOk({ ok: true, reportId: body.reportId });
});
