import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import { requestHostedActionApproval } from "@/src/lib/action-approvals";

const ACTION_APPROVAL_REQUEST_BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: ACTION_APPROVAL_REQUEST_BODY_LIMIT_BYTES,
  });

  return jsonOk(await requestHostedActionApproval({
    memberId,
    prisma: getPrisma(),
    request: await readOptionalJsonObject(request),
  }));
});
