import {
  parseHostedEmailGroupRecipientsCallbackRequest,
} from "@murphai/hosted-execution/hosted-email";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedGroupNewsletterEmailRecipients,
} from "@/src/lib/hosted-groups/group-newsletter";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  const body = parseHostedEmailGroupRecipientsCallbackRequest(payload);
  const resolved = await readHostedGroupNewsletterEmailRecipients({
    ...(body.expectedNewsletterAuthorizationProof
      ? {
          expectedNewsletterAuthorizationProof:
            body.expectedNewsletterAuthorizationProof,
        }
      : {}),
    groupId: body.groupId,
    runtimeMemberId: memberId,
  });

  if (resolved.status !== "ok") {
    if (resolved.unavailableReason === "group_not_found") {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_NEWSLETTER_GROUP_NOT_FOUND",
        httpStatus: 410,
        message: "Hosted group newsletter no longer exists.",
      });
    }
    if (resolved.unavailableReason === "newsletter_authorization_changed") {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_NEWSLETTER_AUTHORIZATION_CHANGED",
        httpStatus: 410,
        message: "Hosted group newsletter authorization changed.",
      });
    }
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
