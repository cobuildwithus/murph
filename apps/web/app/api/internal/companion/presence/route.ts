import { readHostedExecutionRuntimeAuthority } from "@murphai/hosted-execution/auth";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readRuntimeCompanionPresence } from "@/src/lib/companion/presence";

export const POST = withJsonError(async (request: Request) => {
  const { userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 128, runtimeAuthority: "caller_transaction" });
  const authority = readHostedExecutionRuntimeAuthority(new URL(request.url), request.headers);
  return jsonOk(await readRuntimeCompanionPresence(userId, authority ? { ...authority, userId } : null));
});
