import { importHostedAiUsageRecords } from "@/src/lib/hosted-execution/usage";
import { requireHostedExecutionInternalToken } from "@/src/lib/hosted-execution/internal";
import { jsonError, jsonOk, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";

export async function POST(request: Request) {
  try {
    requireHostedExecutionInternalToken(request);
    const body = await readOptionalJsonObject(request);
    const usage = Array.isArray(body.usage) ? body.usage : [];
    const imported = await importHostedAiUsageRecords({
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
