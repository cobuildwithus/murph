import { importHostedAiUsageRecords } from "@/src/lib/hosted-execution/usage";
import {
  authorizeHostedExecutionInternalRequest,
} from "@/src/lib/hosted-execution/internal";
import { jsonError, jsonOk, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    return jsonError(error);
  }
}
