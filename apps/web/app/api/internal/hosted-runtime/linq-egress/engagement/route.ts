import {
  parseHostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  assertHostedLinqRecentInboundEngagementForRuntime,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_LINQ_EGRESS_ENGAGEMENT_BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_EGRESS_ENGAGEMENT_BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const routeAuthority = body.routeAuthority
    ? parseHostedExecutionExternalThreadRouteAuthority(
        body.routeAuthority,
        "Hosted Linq egress engagement request route authority",
      )
    : null;

  await assertHostedLinqRecentInboundEngagementForRuntime({
    directRecipientPhoneNumber: readOptionalBodyString(body.directRecipientPhoneNumber),
    fromPhoneNumber: readOptionalBodyString(body.fromPhoneNumber),
    idempotencyKey: readOptionalBodyString(body.idempotencyKey),
    intentId: readOptionalBodyString(body.intentId),
    memberId: userId,
    prisma: getPrisma(),
    routeAuthority,
    target: readOptionalBodyString(body.target),
    targetKind: readOptionalBodyString(body.targetKind),
  });

  return jsonOk({
    ok: true,
  });
});

function readOptionalBodyString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
