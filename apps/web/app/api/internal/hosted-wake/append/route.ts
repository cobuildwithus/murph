import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  await requireHostedCloudflareCallbackRequest(request);
  throw new TypeError(
    "Hosted wake append is no longer supported. Use the hosted email-ingress callback route.",
  );
});
