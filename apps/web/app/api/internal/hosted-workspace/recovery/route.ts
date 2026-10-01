import { parseHostedCheckpointRecoveryRequest } from "@murphai/hosted-execution/runtime-resources";
import { after } from "next/server";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { recoverHostedWorkspaceCheckpoint } from "@/src/lib/hosted-workspace/checkpoint-recovery";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  // This is a protected operator callback, never a runtime capability URL.
  if (new URL(request.url).search || [...request.headers.keys()].some(key => key.startsWith("x-hosted-runtime-"))) {
    throw hostedOnboardingError({ code: "HOSTED_CHECKPOINT_RECOVERY_AUTHORITY_INVALID", httpStatus: 403,
      message: "Checkpoint recovery requires operator callback authority." });
  }
  const { userId, payload } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 64 * 1024 });
  const result = await recoverHostedWorkspaceCheckpoint({ prisma: getPrisma(), userId,
    request: parseHostedCheckpointRecoveryRequest(payload) });
  if (result.status === "published") {
    const signal = async () => {
      try {
        const { signalHostedRuntimeRecheckRuntime } = await import("@/src/lib/hosted-orchestration/signal-runtime");
        await signalHostedRuntimeRecheckRuntime({ userId });
      } catch {
        console.warn("Checkpoint recovery runtime recheck signal failed.");
      }
    };
    try { after(signal); } catch { void signal(); }
  }
  return jsonOk(result);
});
