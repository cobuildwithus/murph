import { parseHostedUsageDiagnosticsRequest } from "@murphai/hosted-execution/usage-diagnostics";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedUsageDiagnostics } from "@/src/lib/hosted-execution/usage-diagnostics";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: 512,
  });
  return jsonOk(await readHostedUsageDiagnostics({
    memberId, request: parseHostedUsageDiagnosticsRequest(payload),
  }));
});
