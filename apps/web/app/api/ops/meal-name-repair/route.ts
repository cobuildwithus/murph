import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { readHostedRuntimeMaintenanceOverview } from "@/src/lib/hosted-ops/runtime-maintenance";
import { queueMealNameRepair, readMealNameRepairStatus } from "@/src/lib/hosted-ops/meal-name-repair";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readHostedOnboardingJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

function batchNumber(value: unknown): number {
  const batch = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof batch !== "number" || !Number.isSafeInteger(batch) || batch < 0 || batch > 100000) throw invalid();
  return batch;
}
function target(value: unknown, owner: string): string {
  if (value === "owner") return owner;
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/u.test(value)) throw invalid();
  return value;
}
function invalid() {
  return hostedOnboardingError({ code: "MEAL_NAME_REPAIR_INVALID", httpStatus: 400, message: "Use a target and nonnegative batch number." });
}

export const GET = withJsonError(async (request: Request) => {
  const session = await requireHostedOpsRequestAccess(request);
  const params = new URL(request.url).searchParams;
  if (params.has("target")) return jsonOk(await readMealNameRepairStatus(
    target(params.get("target"), session.member.id), batchNumber(params.get("batch")),
  ));
  const page = await readHostedRuntimeMaintenanceOverview({ cursor: params.get("cursor"), limit: 10 });
  // Private routing identities only; never decrypt meals or expose profile data.
  return jsonOk({ targets: page.candidates.map(candidate => candidate.userId), nextCursor: page.nextCursor, count: page.totalCandidateCount });
});

export const POST = withJsonError(async (request: Request) => {
  const session = await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = await readHostedOnboardingJsonObject(request, { limitBytes: 1024,
    tooLargeErrorCode: "MEAL_NAME_REPAIR_INVALID", tooLargeErrorMessage: "Repair request is too large." });
  if (Object.keys(body).some(key => key !== "target" && key !== "batch")) throw invalid();
  return jsonOk(await queueMealNameRepair(target(body.target, session.member.id), batchNumber(body.batch)));
});
