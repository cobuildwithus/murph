import { parseHostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";
import { requireHostedCloudflareSystemCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { executeHostedRuntimeMigrationCommand } from "@/src/lib/hosted-execution/runtime-migration";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, { limitBytes: 1100 * 1024 })).toString("utf8");
  await requireHostedCloudflareSystemCallbackRequest(request, {
    maxBodyBytes: 1100 * 1024, payloadText, nonceOwner: "system:hosted-runtime-migration",
  });
  return jsonOk(await executeHostedRuntimeMigrationCommand({
    prisma: getPrisma(), command: parseHostedRuntimeMigrationCommand(JSON.parse(payloadText)),
  }));
});
