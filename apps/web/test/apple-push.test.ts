import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { readApplePushCredentials, sendApplePush, type ApplePushRequest, type ApplePushTransport } from "@/src/lib/apple-push/send";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials = { keyId: "KEYID12345", privateKey, teamId: "TEAMID1234" };
const request: ApplePushRequest = {
  collapseId: "c".repeat(80),
  data: { wake: "wearable" },
  expiresAt: new Date("2026-10-05T12:00:30.000Z"),
  message: { kind: "background" },
  target: { environment: "production", token: "ab".repeat(32), topic: "ai.withmurph.app" },
};

function transport(result: { reason: string | null; status: number } = { reason: null, status: 200 }) {
  return vi.fn<ApplePushTransport>(async () => result);
}

describe("Apple push sender", () => {
  it("sends a low-priority background wake with a verifiable provider token and no reminder text", async () => {
    const send = transport();
    expect(await sendApplePush(request, { credentials, now: () => Date.parse("2026-10-05T12:00:00.000Z"), transport: send })).toBe("sent");
    const call = send.mock.calls[0]![0];
    expect(call).toMatchObject({ origin: "https://api.push.apple.com", path: `/3/device/${"ab".repeat(32)}`, timeoutMs: 2_500 });
    expect(call.headers).toMatchObject({
      "apns-collapse-id": "c".repeat(64), "apns-expiration": "1791201630",
      "apns-priority": "5", "apns-push-type": "background", "apns-topic": "ai.withmurph.app",
    });
    expect(JSON.parse(call.body)).toEqual({ aps: { "content-available": 1 }, wake: "wearable" });
    const [header, claims, signature] = call.headers.authorization!.replace("bearer ", "").split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEYID12345" });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({ iat: 1791201600, iss: "TEAMID1234" });
    expect(verify("sha256", Buffer.from(`${header}.${claims}`), { dsaEncoding: "ieee-p1363", key: publicKey }, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("sends a high-priority visible alert to the sandbox for development builds", async () => {
    const send = transport();
    const alert: ApplePushRequest = {
      ...request,
      message: { body: "Wrist reminder", kind: "alert", title: "Murph" },
      target: { ...request.target, environment: "development", topic: "ai.withmurph.app.dev" },
    };
    expect(await sendApplePush(alert, { credentials, transport: send })).toBe("sent");
    const call = send.mock.calls[0]![0];
    expect(call.origin).toBe("https://api.sandbox.push.apple.com");
    expect(call.headers).toMatchObject({ "apns-priority": "10", "apns-push-type": "alert", "apns-topic": "ai.withmurph.app.dev" });
    expect(JSON.parse(call.body).aps).toEqual({ alert: { body: "Wrist reminder", title: "Murph" }, "content-available": 1 });
  });

  it("reuses one provider token instead of re-signing every push", async () => {
    const send = transport();
    const now = Date.parse("2026-10-05T13:00:00.000Z");
    await sendApplePush(request, { credentials, now: () => now, transport: send });
    await sendApplePush(request, { credentials, now: () => now + 60_000, transport: send });
    expect(send.mock.calls[0]![0].headers.authorization).toBe(send.mock.calls[1]![0].headers.authorization);
  });

  it.each([
    [{ reason: null, status: 410 }, "unregistered"],
    [{ reason: "BadDeviceToken", status: 400 }, "unregistered"],
    [{ reason: "DeviceTokenNotForTopic", status: 400 }, "unregistered"],
    [{ reason: "TooManyRequests", status: 429 }, "failed"],
    [{ reason: "InternalServerError", status: 500 }, "failed"],
  ] as const)("maps %o to %s", async (response, result) => {
    expect(await sendApplePush(request, { credentials, transport: transport(response) })).toBe(result);
  });

  it("fails closed without credentials or when the transport throws", async () => {
    const send = transport();
    expect(await sendApplePush(request, { credentials: null, transport: send })).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(await sendApplePush(request, { credentials, transport: async () => { throw new Error("timeout"); } })).toBe("failed");
    expect(readApplePushCredentials({ APNS_KEY_ID: "k", APNS_TEAM_ID: "t" })).toBeNull();
  });
});
