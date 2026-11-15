import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { parseInput, RequestInputError } from "@murphai/hosted-execution/request-input";
import { parseHostedRuntimeSnapshotCommand } from "@murphai/hosted-execution/runtime-resources";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { executeHostedRuntimeSnapshotCommand } from "@/src/lib/hosted-execution/runtime-snapshots";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 64 * 1024 });
  return jsonOk(await executeHostedRuntimeSnapshotCommand({ prisma: getPrisma(), userId, command: parseInput(payload, parseHostedRuntimeSnapshotCommand) }).catch((error: unknown) => {
    // Preserve the callback's generic envelope for these explicit domain refusals.
    if (isHostedOnboardingError(error) && error.httpStatus === 400 && error.code === "INVALID_REQUEST") {
      throw new RequestInputError(error.message, { cause: error });
    }
    throw error;
  }));
});
