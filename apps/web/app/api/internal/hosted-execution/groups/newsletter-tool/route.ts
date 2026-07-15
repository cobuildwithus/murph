import {
  parseHostedRuntimeNewsletterToolRequest,
} from "@murphai/hosted-execution/parsers";

import {
  prepareHostedGroupNewsletterParticipants,
} from "@/src/lib/hosted-groups/group-newsletter";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 512 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeNewsletterToolRequest(payload);

  if (
    body.action === "read_stats"
    || (
      body.action === "prepare"
      && (
        body.includeAuthorizationProof !== true
        || body.includeAuthorizationSnapshot !== true
      )
    )
  ) {
    return jsonOk({
      action: body.action,
      result: {
        status: "unavailable",
        unavailableReason: "newsletter_runner_upgrade_required",
      },
    });
  }

  if (body.action === "prepare") {
    const result = await prepareHostedGroupNewsletterParticipants({
      groupId: body.groupId,
      runtimeMemberId: memberId,
    });
    return jsonOk({
      action: "prepare",
      result,
    });
  }

  return jsonOk({
    action: body.action,
    result: {
      status: "unavailable",
      unavailableReason: "send_requires_worker_effects",
    },
  });
});
