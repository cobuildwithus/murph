import { importHostedAssistantRuntimeIssues } from "@/src/lib/hosted-execution/runtime-issues";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  if (!Array.isArray(body.issues)) {
    throw new TypeError("issues must be an array.");
  }

  const result = await importHostedAssistantRuntimeIssues({
    issues: body.issues,
  });

  return jsonOk({
    issueIds: result.recordedIds,
    recorded: result.recordedIds.length,
  });
});
