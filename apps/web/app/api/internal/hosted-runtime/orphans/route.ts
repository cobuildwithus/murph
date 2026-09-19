import { parseHostedRuntimeResourcePurge } from "@murphai/hosted-execution/runtime-resource-purge";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { recordHostedRuntimeOrphan } from "@/src/lib/hosted-execution/runtime-orphans";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 16 * 1024 });
  await recordHostedRuntimeOrphan({ prisma: getPrisma(), userId, resource: parseHostedRuntimeResourcePurge(payload) });
  return jsonOk({ recorded: true });
});
