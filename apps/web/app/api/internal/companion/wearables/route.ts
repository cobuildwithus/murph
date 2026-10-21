import { readHostedExecutionRuntimeAuthority } from "@murphai/hosted-execution/auth";
import { wearableHapticRequestSchema } from "@murphai/hosted-execution/wearable-haptics";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requestWearableHaptic } from "@/src/lib/wearable-haptics/service";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 2_048, runtimeAuthority: "caller_transaction" });
  const parsed = wearableHapticRequestSchema.safeParse(payload);
  if (!parsed.success) throw new TypeError("Invalid wearable haptic request.");
  const authority = readHostedExecutionRuntimeAuthority(new URL(request.url), request.headers);
  return jsonOk(await requestWearableHaptic({
    memberId: userId, runtimeIdentity: authority ? { ...authority, userId } : null, request: parsed.data,
  }));
});
