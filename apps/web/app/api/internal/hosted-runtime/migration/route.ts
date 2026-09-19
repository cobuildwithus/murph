import { after } from "next/server";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
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
  const result = await executeHostedRuntimeMigrationCommand({
    prisma: getPrisma(), command: parseHostedRuntimeMigrationCommand(JSON.parse(payloadText)),
  });
  if (result && "member" in result && result.member && "mailboxItemId" in result.member && typeof result.member.mailboxItemId === "string") {
    const mailboxItemId = result.member.mailboxItemId;
    const expectedUserId = result.member.userId;
    after(async () => {
      try { await signalHostedMailboxAppendRuntime({ expectedUserId, mailboxItemId }); }
      catch { console.warn("Runtime migration wake signal deferred to durable mailbox recovery."); }
    });
  }
  return jsonOk(result);
});
