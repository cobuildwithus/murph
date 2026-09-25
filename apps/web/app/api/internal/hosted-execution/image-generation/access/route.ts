import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedImageGenerationAccess } from "@/src/lib/hosted-onboarding/image-generation-access";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const { userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: 128,
  });
  // The signed member binding is the only account authority; body fields cannot
  // select a payer or claim subscription access.
  return jsonOk(await readHostedImageGenerationAccess({ memberId }));
});
