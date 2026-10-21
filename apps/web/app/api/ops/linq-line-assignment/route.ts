import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT } from "@/src/lib/hosted-onboarding/linq-line-store";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const projection = {
  assignmentWeight: true,
  phoneNumberHint: true,
  phoneNumberLookupKey: true,
} as const;

export const GET = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request);
  const lines = await getPrisma().hostedLinqLine.findMany({
    where: { configuredAt: { not: null } },
    select: projection,
    orderBy: { phoneNumberLookupKey: "asc" },
    take: HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT + 1,
  });
  if (lines.length > HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ASSIGNMENT_POOL_TOO_LARGE",
      httpStatus: 409,
      message: "Configured Linq line inventory exceeds the operator read limit.",
    });
  }
  return jsonOk({ lines });
});

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 4 * 1024,
    tooLargeErrorCode: "HOSTED_LINQ_ASSIGNMENT_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Linq assignment settings exceed the request limit.",
  });
  const { assignmentWeight, phoneNumberLookupKey } = body;
  if (
    typeof phoneNumberLookupKey !== "string"
    || !phoneNumberLookupKey.trim()
    || phoneNumberLookupKey.length > 256
    || typeof assignmentWeight !== "number"
    || !Number.isInteger(assignmentWeight)
    || assignmentWeight < 0
    || assignmentWeight > 10_000
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ASSIGNMENT_INVALID",
      httpStatus: 400,
      message: "Provide a line lookup key and integer assignment weight from 0 to 10000.",
    });
  }
  // The unique lookup key bounds this atomic mutation to one configured line.
  // No member route, provider state, health, or delivery policy changes here.
  const [line] = await getPrisma().hostedLinqLine.updateManyAndReturn({
    where: {
      configuredAt: { not: null },
      phoneNumberLookupKey: phoneNumberLookupKey.trim(),
    },
    data: { assignmentWeight },
    select: projection,
  });
  if (!line) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ASSIGNMENT_LINE_NOT_FOUND",
      httpStatus: 404,
      message: "Configured Linq line was not found.",
    });
  }
  return jsonOk({ line });
});
