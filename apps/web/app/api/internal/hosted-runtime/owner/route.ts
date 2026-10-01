import { after } from "next/server";
import { parseHostedRuntimeOwnerCommand } from "@murphai/hosted-execution/runtime-owner";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { executeHostedRuntimeOwnerCommand } from "@/src/lib/hosted-execution/runtime-owner-control";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { createHostedRuntimeCallbackTiming } from "@/src/lib/hosted-execution/runtime-callback-timing";

const runWithTiming = createHostedRuntimeCallbackTiming("owner");

export const POST = withJsonError((request: Request) => runWithTiming(request, async (timing) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 64 * 1024 });
  timing.authenticated();
  const command = parseHostedRuntimeOwnerCommand(payload);
  const result = await executeHostedRuntimeOwnerCommand({ prisma: getPrisma(), userId, command });
  if (command.operation === "complete" && result.status === "updated") {
    // Durable completion is sufficient for the response; accepted-attempt
    // rechecks recover a lost advisory hint.
    after(async () => {
      const { notifyHostedRuntimeOwnerCompletion } = await import("@/src/lib/hosted-orchestration/runtime-owner-release");
      await notifyHostedRuntimeOwnerCompletion({
        userId, runtimeAttemptId: command.attemptId,
        immediateRecheckRequested: command.immediateRecheckRequested,
      });
    });
  }
  return jsonOk(result);
}));
