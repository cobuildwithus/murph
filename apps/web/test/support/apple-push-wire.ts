import { generateKeyPairSync } from "node:crypto";
import { vi } from "vitest";

import type { ApplePushRequest } from "@/src/lib/apple-push/send";

const credentials = { keyId: "KEYID12345", privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey, teamId: "TEAMID1234" };

/** The `aps` dictionary the real sender puts on the wire for a request that a mocked sender captured. */
export async function applePushWireAps(request: ApplePushRequest): Promise<Record<string, unknown>> {
  const { sendApplePush } = await vi.importActual<typeof import("@/src/lib/apple-push/send")>("@/src/lib/apple-push/send");
  let body = "";
  await sendApplePush(request, { credentials, transport: async input => { body = input.body; return { reason: null, status: 200 }; } });
  return JSON.parse(body).aps;
}
