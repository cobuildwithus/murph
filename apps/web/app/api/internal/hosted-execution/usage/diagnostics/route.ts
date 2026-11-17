import { assertContract } from "@murphai/contracts";
import { parseInput } from "@murphai/hosted-execution/request-input";
import { hostedUsageDiagnosticsRequestSchema } from "@murphai/hosted-execution/usage-diagnostics";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedUsageDiagnostics } from "@/src/lib/hosted-execution/usage-diagnostics";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: 512,
  });
  return jsonOk(await readHostedUsageDiagnostics({
    memberId, request: parseInput(payload, (value) => assertContract(hostedUsageDiagnosticsRequestSchema, value, "Internal request")),
  }));
});
