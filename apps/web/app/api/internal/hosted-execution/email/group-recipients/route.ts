import {
  parseHostedEmailGroupRecipientsCallbackRequest,
} from "@murphai/hosted-execution/hosted-email";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedGroupNewsletterEmailRecipients,
} from "@/src/lib/hosted-groups/group-newsletter";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const body = parseHostedEmailGroupRecipientsCallbackRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );
  const resolved = await readHostedGroupNewsletterEmailRecipients({
    groupId: body.groupId,
    runtimeMemberId: memberId,
  });

  if (resolved.status !== "ok") {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_NEWSLETTER_RECIPIENTS_UNAVAILABLE",
      httpStatus: 409,
      message: "Hosted group newsletter recipients are unavailable.",
    });
  }

  return jsonOk({
    recipients: resolved.recipients,
  });
});
