import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedRuntimeCryptoContextForWorker } from "@/src/lib/hosted-crypto/domain-root-store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const context = await readHostedRuntimeCryptoContextForWorker({
    prisma: getPrisma(),
    userId,
  });
  return jsonOk({ ...context, fetchedAt: new Date().toISOString() });
});
