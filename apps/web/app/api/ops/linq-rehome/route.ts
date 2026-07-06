import {
  readHostedLinqLineRehomeOverview,
  rehomeHostedMemberLinqHomeLine,
} from "@/src/lib/hosted-ops/linq-line-rehome";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_LINQ_REHOME_BODY_LIMIT_BYTES = 4 * 1024;

export const GET = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request);
  const url = new URL(request.url);

  return jsonOk(await readHostedLinqLineRehomeOverview({
    memberId: readRequiredString(
      url.searchParams.get("memberId"),
      "HOSTED_LINQ_REHOME_MEMBER_ID_REQUIRED",
      "Hosted Linq rehome overview requires a memberId query parameter.",
    ),
  }));
});

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_LINQ_REHOME_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_LINQ_REHOME_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted Linq rehome request body is too large.",
  });

  return jsonOk(await rehomeHostedMemberLinqHomeLine({
    memberId: readRequiredString(
      body.memberId,
      "HOSTED_LINQ_REHOME_MEMBER_ID_REQUIRED",
      "Hosted Linq rehome requires a memberId.",
    ),
    targetLineLookupKey: readRequiredString(
      body.targetLineLookupKey,
      "HOSTED_LINQ_REHOME_TARGET_LOOKUP_KEY_REQUIRED",
      "Hosted Linq rehome requires a targetLineLookupKey.",
    ),
  }));
});

function readRequiredString(
  value: unknown,
  code: string,
  message: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw hostedOnboardingError({
      code,
      httpStatus: 400,
      message,
      retryable: false,
    });
  }

  return value.trim();
}
