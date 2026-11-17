import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ route: vi.fn(), asymmetricSign: vi.fn(), connect: vi.fn() }));
vi.mock("@/src/lib/hosted-crypto/env", () => ({ getHostedWebCryptoConfig: () => ({ gcpKms: { asymmetricSign: m.asymmetricSign } }) }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ companionPushRoute: { findFirst: m.route } }) }));
vi.mock("node:http2", () => ({ connect: m.connect }));

import { deliverGamePush } from "@/src/lib/game/push-delivery";
import type { ApplePushRequest } from "@/src/lib/apple-push/send";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const request: ApplePushRequest = {
  collapseId: "game", data: { gameId: "synthetic-game" }, expiresAt: new Date("2026-11-16T19:00:00Z"),
  message: { kind: "alert", body: "New game check-in" },
  target: { environment: "production", topic: "ai.withmurph.app", token: "ab".repeat(32) },
};

describe("game authorization after KMS signing", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
    vi.stubEnv("APNS_TEAM_ID", "TEAMID1234");
    vi.stubEnv("APNS_KMS_KEY_VERSION", "projects/test-project/locations/global/keyRings/test-ring/cryptoKeys/apns/cryptoKeyVersions/1");
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each(["route", "session", "subject", "expiry"])("sends nothing if %s becomes invalid while signing is pending", async reason => {
    vi.stubEnv("APNS_KEY_ID", `GAME-RACE-${reason}`);
    const gate = deferred();
    m.asymmetricSign.mockImplementation(async ({ keyVersionName, message }) => {
      await gate.promise;
      return { keyVersionName, signature: sign("sha256", message, privateKey).toString("base64") };
    });
    const stillValid = vi.fn(async () => true);
    m.route.mockResolvedValue({ userId: "member" });
    const result = deliverGamePush({ memberId: "member", sessionId: "session", request }, stillValid);
    expect(m.asymmetricSign).toHaveBeenCalledOnce();
    expect(stillValid).not.toHaveBeenCalled();
    expect(m.route).not.toHaveBeenCalled();
    if (reason === "route" || reason === "session") m.route.mockResolvedValue(null);
    if (reason === "subject") stillValid.mockResolvedValue(false);
    if (reason === "expiry") vi.setSystemTime(request.expiresAt);
    gate.resolve();
    expect(await result).toBe("superseded");
    expect(m.connect).not.toHaveBeenCalled();
    if (reason === "session") expect(m.route).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      gameSessionId: "session", member: { suspendedAt: null, authRecords: { some: { model: "session", id: "session", expiresAt: { gt: new Date() } } } },
    }) }));
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
