import { parseHostedRuntimeSnapshotCommand } from "@murphai/hosted-execution/runtime-resources";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { executeHostedRuntimeSnapshotCommand } from "@/src/lib/hosted-execution/runtime-snapshots";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 64 * 1024 });
  return jsonOk(await executeHostedRuntimeSnapshotCommand({ prisma: getPrisma(), userId, command: parseHostedRuntimeSnapshotCommand(payload) }));
});
