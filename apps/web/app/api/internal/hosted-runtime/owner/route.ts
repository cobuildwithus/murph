import { parseHostedRuntimeOwnerCommand } from "@murphai/hosted-execution/runtime-owner";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { executeHostedRuntimeOwnerCommand } from "@/src/lib/hosted-execution/runtime-owner-control";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 64 * 1024 });
  return jsonOk(await executeHostedRuntimeOwnerCommand({
    prisma: getPrisma(), userId, command: parseHostedRuntimeOwnerCommand(payload),
  }));
});
