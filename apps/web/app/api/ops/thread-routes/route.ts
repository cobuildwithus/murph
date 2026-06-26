import {
  ensureHostedOpsLinqThreadRoute,
} from "@/src/lib/hosted-ops/thread-routes";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_OPS_THREAD_ROUTE_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_THREAD_ROUTE_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_THREAD_ROUTE_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted thread route request body is too large.",
  });

  return jsonOk(await ensureHostedOpsLinqThreadRoute({
    containerMemberId: readOptionalStringField(body, "containerMemberId"),
    linqAccountPhoneNumber: readOptionalStringField(body, "linqAccountPhoneNumber"),
    linqChatId: readOptionalStringField(body, "linqChatId"),
    ownerMemberId: readOptionalStringField(body, "ownerMemberId"),
  }));
});

function readOptionalStringField(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}
