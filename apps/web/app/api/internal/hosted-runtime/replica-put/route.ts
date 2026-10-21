import { parseHostedRuntimeReplicaPutCommand } from "@murphai/hosted-execution/runtime-resources";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { executeHostedRuntimeReplicaPutCommand } from "@/src/lib/hosted-execution/runtime-replica-puts";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 128 * 1024 });
  return jsonOk(await executeHostedRuntimeReplicaPutCommand({ prisma: getPrisma(), userId, command: parseHostedRuntimeReplicaPutCommand(payload) }));
});
