import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  quarantineHostedWakeTx,
} from "@/src/lib/hosted-wake/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  const wakeId = requireNonBlankString(body.wakeId, "wakeId");
  const quarantineCode = requireNonBlankString(body.quarantineCode, "quarantineCode");
  const quarantined = await getPrisma().$transaction((tx) => {
    return quarantineHostedWakeTx({
      quarantineCode,
      tx,
      userId,
      wakeId,
    });
  });

  return jsonOk({ quarantined });
});

function requireNonBlankString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError(`${label} must not be blank.`);
  }

  return normalized;
}
