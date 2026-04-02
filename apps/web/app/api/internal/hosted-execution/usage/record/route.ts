import { importHostedAiUsageRecords } from "@/src/lib/hosted-execution/usage";
import {
  authorizeHostedExecutionInternalRequest,
} from "@/src/lib/hosted-execution/internal";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
    authorizeHostedExecutionInternalRequest({
      acceptedToken: "internal",
      request,
      requireBoundUserId: true,
    });
    const body = await readOptionalJsonObject(request);
    const usage = Array.isArray(body.usage) ? body.usage : [];
    const { trustedUserId } = authorizeHostedExecutionInternalRequest({
      acceptedToken: "internal",
      bodyUserIdLabel: "memberId",
      bodyUserIds: usage.map((entry) =>
        typeof entry === "object" && entry !== null && typeof entry.memberId === "string"
          ? entry.memberId
          : null
      ),
      request,
      requireBoundUserId: true,
    });
    const imported = await importHostedAiUsageRecords({
      trustedUserId: trustedUserId ?? null,
      usage,
    });

    return jsonOk({
      recorded: imported.recordedIds.length,
      usageIds: imported.recordedIds,
    });
});
