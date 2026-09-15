import { parseHostedRuntimeMediaCommand } from "@murphai/hosted-execution/runtime-media";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { executeHostedRuntimeMediaCommand } from "@/src/lib/hosted-execution/runtime-media";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 16 * 1024 });
  return jsonOk(await executeHostedRuntimeMediaCommand({ prisma: getPrisma(), userId, command: parseHostedRuntimeMediaCommand(payload) }));
});
