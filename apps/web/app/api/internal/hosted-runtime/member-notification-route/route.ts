import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedRuntimeCallbackAuthority } from "@/src/lib/hosted-execution/runtime-write-fence";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveHostedAssistantNotificationDestination } from "@/src/lib/hosted-routing/assistant-notification-destination";

export const POST = withJsonError(async (request: Request) => {
  // The callback verifier validates the current runtime fence before this read.
  const authenticated = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: 1024,
  });
  if (!readHostedRuntimeCallbackAuthority(request)) {
    throw hostedOnboardingError({
      code: "HOSTED_NOTIFICATION_RUNTIME_REQUIRED",
      httpStatus: 403,
      message: "Notification routing requires an active runtime.",
    });
  }
  const payload = authenticated.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).length !== 0) {
    throw hostedOnboardingError({
      code: "HOSTED_NOTIFICATION_ROUTE_REQUEST_INVALID",
      httpStatus: 400,
      message: "Notification routing accepts no destination overrides.",
    });
  }
  const destination = await resolveHostedAssistantNotificationDestination({
    memberId: authenticated.userId,
    signal: request.signal,
  });
  return jsonOk({
    route: destination?.conversationShape === "direct-member"
      && destination.route.threadIsDirect === true
      ? destination.route
      : null,
  });
});
