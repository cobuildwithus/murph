import {
  parseHostedRuntimeNewsletterToolRequest,
} from "@murphai/hosted-execution/parsers";

import {
  readHostedGroupNewsletterParticipants,
} from "@/src/lib/hosted-groups/group-newsletter";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 512 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const body = parseHostedRuntimeNewsletterToolRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );

  if (body.action === "read_stats") {
    const result = await readHostedGroupNewsletterParticipants({
      groupId: body.groupId,
      runtimeMemberId: memberId,
    });
    return jsonOk({
      action: body.action,
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
