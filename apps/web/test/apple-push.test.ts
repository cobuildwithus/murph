import { generateKeyPairSync, sign, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const kms = vi.hoisted(() => ({ asymmetricSign: vi.fn() }));
vi.mock("@/src/lib/hosted-crypto/env", () => ({ getHostedWebCryptoConfig: () => ({ gcpKms: kms }) }));

import { p256DerSignatureToJose, prepareApplePushProviderToken, readApplePushCredentials, sendApplePush, type ApplePushRequest, type ApplePushTransport } from "@/src/lib/apple-push/send";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials = { keyId: "KEYID12345", privateKey, teamId: "TEAMID1234" };
const request: ApplePushRequest = {
  collapseId: "c".repeat(80),
  data: { gameId: "synthetic-game" },
  expiresAt: new Date("2026-10-05T12:00:30.000Z"),
  message: { kind: "background" },
  target: { environment: "production", token: "ab".repeat(32), topic: "ai.withmurph.app" },
};

function transport(result: { reason: string | null; status: number } = { reason: null, status: 200 }) {
  return vi.fn<ApplePushTransport>(async () => result);
}

describe("Apple push sender", () => {
  afterEach(() => { vi.unstubAllEnvs(); kms.asymmetricSign.mockReset(); });
  it("sends a low-priority background push with a verifiable provider token", async () => {
    const send = transport();
    expect(await sendApplePush(request, { credentials, now: () => Date.parse("2026-10-05T12:00:00.000Z"), transport: send })).toBe("sent");
    const call = send.mock.calls[0]![0];
    expect(call).toMatchObject({ origin: "https://api.push.apple.com", path: `/3/device/${"ab".repeat(32)}`, timeoutMs: 2_500 });
    expect(call.headers).toMatchObject({
      "apns-collapse-id": "c".repeat(64), "apns-expiration": "1791201630",
      "apns-priority": "5", "apns-push-type": "background", "apns-topic": "ai.withmurph.app",
    });
    expect(JSON.parse(call.body)).toEqual({ aps: { "content-available": 1 }, gameId: "synthetic-game" });
    const [header, claims, signature] = call.headers.authorization!.replace("bearer ", "").split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEYID12345" });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({ iat: 1791201600, iss: "TEAMID1234" });
    expect(verify("sha256", Buffer.from(`${header}.${claims}`), { dsaEncoding: "ieee-p1363", key: publicKey }, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("sends a high-priority visible alert to the sandbox for development builds", async () => {
    const send = transport();
    const alert: ApplePushRequest = {
      ...request,
      message: { body: "Your game has an update", kind: "alert", title: "Murph" },
      target: { ...request.target, environment: "development", topic: "ai.withmurph.app.dev" },
    };
    expect(await sendApplePush(alert, { credentials, transport: send })).toBe("sent");
    const call = send.mock.calls[0]![0];
    expect(call.origin).toBe("https://api.sandbox.push.apple.com");
    expect(call.headers).toMatchObject({ "apns-priority": "10", "apns-push-type": "alert", "apns-topic": "ai.withmurph.app.dev" });
    expect(JSON.parse(call.body).aps).toEqual({ alert: { body: "Your game has an update", title: "Murph" }, "content-available": 1, sound: "default" });
  });

  it("omits the alert title when the message has none", async () => {
    const send = transport();
    const alert: ApplePushRequest = { ...request, message: { body: "New note on your post.", kind: "alert" } };
    expect(await sendApplePush(alert, { credentials, transport: send })).toBe("sent");
    expect(JSON.parse(send.mock.calls[0]![0].body).aps).toEqual({ alert: { body: "New note on your post." }, "content-available": 1, sound: "default" });
  });

  it("plays the default sound on every alert without being asked, and never on a background wake", async () => {
    const send = transport();
    await sendApplePush({ ...request, message: { kind: "alert", title: "Walk", body: "Still time today." } }, { credentials, transport: send });
    expect(JSON.parse(send.mock.calls[0]![0].body).aps.sound).toBe("default");
    await sendApplePush(request, { credentials, transport: send });
    expect(send.mock.calls[1]![0].headers).toMatchObject({ "apns-priority": "5", "apns-push-type": "background" });
    expect(JSON.parse(send.mock.calls[1]![0].body).aps).toEqual({ "content-available": 1 });
  });

  it("adds a thread and interruption level only when requested on an alert", async () => {
    const send = transport();
    const options = { threadId: "murph.sync-interruption-reminder", interruptionLevel: "time-sensitive" } as const;
    await sendApplePush({ ...request, ...options, message: { kind: "alert", title: "Open Murph", body: "Reopen Murph." } }, { credentials, transport: send });
    expect(JSON.parse(send.mock.calls[0]![0].body).aps).toEqual({
      alert: { body: "Reopen Murph.", title: "Open Murph" }, "content-available": 1, sound: "default",
      "thread-id": "murph.sync-interruption-reminder", "interruption-level": "time-sensitive",
    });
    await sendApplePush({ ...request, ...options }, { credentials, transport: send });
    expect(JSON.parse(send.mock.calls[1]![0].body).aps).toEqual({ "content-available": 1 });
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

  const kmsKeyVersion = "projects/test-project/locations/global/keyRings/test-ring/cryptoKeys/apns/cryptoKeyVersions/1";
  const rotatedKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
  function fakeKms() {
    kms.asymmetricSign.mockImplementation(async ({ keyVersionName, message }) => ({
      keyVersionName, signature: sign("sha256", message, rotatedKey.privateKey).toString("base64"),
    }));
  }

  it.each(["production", "development"] as const)("sends a verifiable KMS ES256 token to %s", async environment => {
    fakeKms();
    const send = transport();
    const keyId = `KMS-${environment}`;
    const now = Date.parse("2026-11-16T12:00:00Z");
    expect(await sendApplePush({ ...request, target: { ...request.target, environment } }, {
      credentials: { keyId, kmsKeyVersion, teamId: credentials.teamId }, now: () => now, transport: send,
    })).toBe("sent");
    const call = send.mock.calls[0]![0];
    expect(call.origin).toBe(environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
    const [header, claims, signature] = call.headers.authorization!.slice(7).split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "ES256", kid: keyId });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({ iat: now / 1000, iss: credentials.teamId });
    expect(Buffer.from(signature!, "base64url")).toHaveLength(64);
    expect(verify("sha256", Buffer.from(`${header}.${claims}`), { dsaEncoding: "ieee-p1363", key: rotatedKey.publicKey }, Buffer.from(signature!, "base64url"))).toBe(true);
    expect(keyId).not.toBe(credentials.keyId);
    expect(verify("sha256", Buffer.from(`${header}.${claims}`), { dsaEncoding: "ieee-p1363", key: publicKey }, Buffer.from(signature!, "base64url"))).toBe(false);
    expect(kms.asymmetricSign).toHaveBeenCalledExactlyOnceWith({ keyVersionName: kmsKeyVersion, message: Buffer.from(`${header}.${claims}`) });
  });

  it("never reads the PEM when KMS is selected, even if signing fails", async () => {
    const source = {
      APNS_KEY_ID: "KMS-NO-PEM", APNS_TEAM_ID: "TEAMID1234", APNS_KMS_KEY_VERSION: kmsKeyVersion,
      get APNS_PRIVATE_KEY(): string { throw new Error("PEM must not be read"); },
    };
    const selected = readApplePushCredentials(source);
    expect(selected).toEqual({ keyId: source.APNS_KEY_ID, teamId: source.APNS_TEAM_ID, kmsKeyVersion });
    kms.asymmetricSign.mockRejectedValue(new Error("unavailable"));
    const send = transport();
    expect(await sendApplePush(request, { credentials: selected, transport: send })).toBe("failed");
    expect(kms.asymmetricSign).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    fakeKms();
    expect(await sendApplePush(request, { credentials: selected, transport: send })).toBe("sent");
  });

  it("keeps the PEM configuration path until rotation", () => {
    const selected = readApplePushCredentials({
      APNS_KEY_ID: "PEM-TRANSITION", APNS_TEAM_ID: "TEAMID1234",
      APNS_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString().replaceAll("\n", "\\n"),
    });
    expect(selected && "privateKey" in selected && selected.privateKey.asymmetricKeyType).toBe("ec");
  });

  it("shares in-flight KMS signing, reuses for 40 minutes, and separates the rotation pair", async () => {
    const gate = deferred();
    kms.asymmetricSign.mockImplementation(async ({ keyVersionName, message }) => {
      await gate.promise;
      return { keyVersionName, signature: sign("sha256", message, privateKey).toString("base64") };
    });
    const now = Date.parse("2026-11-16T13:00:00Z");
    const selected = { keyId: "KMS-CACHE", teamId: "TEAMID1234", kmsKeyVersion };
    const first = prepareApplePushProviderToken({ credentials: selected, now: () => now });
    const second = prepareApplePushProviderToken({ credentials: selected, now: () => now });
    expect(kms.asymmetricSign).toHaveBeenCalledOnce();
    gate.resolve();
    expect(await first).toEqual(await second);
    expect(await prepareApplePushProviderToken({ credentials: selected, now: () => now + 40 * 60_000 - 1 })).toEqual(await first);
    expect(kms.asymmetricSign).toHaveBeenCalledOnce();
    expect(await prepareApplePushProviderToken({ credentials: selected, now: () => now + 40 * 60_000 })).not.toEqual(await first);
    expect(kms.asymmetricSign).toHaveBeenCalledTimes(2);
    await prepareApplePushProviderToken({ credentials: { ...selected, keyId: "KMS-ROTATED" }, now: () => now + 41 * 60_000 });
    await prepareApplePushProviderToken({ credentials: { ...selected, keyId: "KMS-ROTATED", kmsKeyVersion: kmsKeyVersion.replace(/1$/, "2") }, now: () => now + 41 * 60_000 });
    expect(kms.asymmetricSign).toHaveBeenCalledTimes(4);
  });

  it("does not reuse a PEM token after KMS is configured for the same key id", async () => {
    const selected = { ...credentials, keyId: "SAME-ID" };
    await prepareApplePushProviderToken({ credentials: selected });
    kms.asymmetricSign.mockRejectedValue(new Error("unavailable"));
    expect(await prepareApplePushProviderToken({ credentials: { keyId: selected.keyId, teamId: selected.teamId, kmsKeyVersion } })).toBeNull();
    expect(kms.asymmetricSign).toHaveBeenCalledOnce();
  });

  it("never refreshes a prepared token during sending, including failed or expired preparation", async () => {
    fakeKms();
    const selected = { keyId: "KMS-PREPARED", teamId: "TEAMID1234", kmsKeyVersion };
    const now = Date.now();
    const providerToken = await prepareApplePushProviderToken({ credentials: selected, now: () => now });
    const send = transport();
    expect(await sendApplePush(request, { providerToken, now: () => now + 41 * 60_000, transport: send })).toBe("sent");
    expect(await sendApplePush(request, { providerToken, now: () => now + 60 * 60_000, transport: send })).toBe("failed");
    expect(await sendApplePush(request, { providerToken: null, credentials: selected, transport: send })).toBe("failed");
    expect(kms.asymmetricSign).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it("turns malformed KMS signatures and malformed PEM configuration into failed sends", async () => {
    kms.asymmetricSign.mockResolvedValue({ keyVersionName: kmsKeyVersion, signature: "AA==" });
    const send = transport();
    expect(await sendApplePush(request, { credentials: { keyId: "KMS-MALFORMED", teamId: "TEAMID1234", kmsKeyVersion }, transport: send })).toBe("failed");
    vi.stubEnv("APNS_KMS_KEY_VERSION", ""); vi.stubEnv("APNS_KEY_ID", "INVALID-PEM"); vi.stubEnv("APNS_TEAM_ID", "TEAMID1234"); vi.stubEnv("APNS_PRIVATE_KEY", "invalid");
    expect(await sendApplePush(request, { transport: send })).toBe("failed");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("P-256 DER to JOSE", () => {
  it.each([
    [Buffer.concat([Buffer.from([0]), Buffer.alloc(32, 0x80)]), Buffer.from([1])],
    [Buffer.from([0x7f]), Buffer.concat([Buffer.from([0]), Buffer.alloc(32, 0xff)])],
    [Buffer.alloc(31, 0x7f), Buffer.from([0, 0x80])],
  ])("strips sign padding and left-pads short r and s", (r, s) => {
    const der = Buffer.concat([Buffer.from([0x30, r.length + s.length + 4, 2, r.length]), r, Buffer.from([2, s.length]), s]);
    const expected = (scalar: Buffer) => scalar.toString("hex").replace(/^00/, "").padStart(64, "0");
    expect(p256DerSignatureToJose(der).toString("hex")).toBe(expected(r) + expected(s));
  });

  it.each(["", "3006020180020101", "300702020001020101", "3006020100020101", "300602010102010100", "3006020101020201", "3006020101030101", "308106020101020101"])("rejects malformed or noncanonical DER %s", hex => {
    expect(() => p256DerSignatureToJose(Buffer.from(hex, "hex"))).toThrow("Invalid APNs P-256 signature.");
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
