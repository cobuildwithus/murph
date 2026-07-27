import {
  parseHostedRuntimeManagedGroupActivityDecisionRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_MANAGED_GROUP_ACTIVITY_DECISION_REQUEST_MAX_BYTES,
} from "@murphai/hosted-execution/runtime-control";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedManagedGroupActivityDecision,
} from "@/src/lib/hosted-groups/managed-group-activity-decision";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } =
    await requireHostedCloudflareCallbackJsonRequest(request, {
      maxBodyBytes:
        HOSTED_RUNTIME_MANAGED_GROUP_ACTIVITY_DECISION_REQUEST_MAX_BYTES,
    });
  const body = parseHostedRuntimeManagedGroupActivityDecisionRequest(payload);
  return jsonOk(await readHostedManagedGroupActivityDecision({
    memberId,
    request: body,
  }));
});
