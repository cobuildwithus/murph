import { generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), create: vi.fn(), update: vi.fn(), asymmetricSign: vi.fn(), connect: vi.fn() }));
vi.mock("@/src/lib/hosted-crypto/env", () => ({ getHostedWebCryptoConfig: () => ({ gcpKms: { asymmetricSign: m.asymmetricSign } }) }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  $queryRaw: m.query, $transaction: m.transaction, appleHealthReopenPush: { updateMany: m.update },
}) }));
vi.mock("@/src/lib/hosted-onboarding/shared", () => ({ lockHostedMemberRow: async () => {} }));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: async () => true,
  readActiveHostedMemberAccessIds: async () => new Set(["member"]),
}));
vi.mock("node:http2", () => ({ connect: m.connect }));

import { sendDueAppleHealthReopenPushes } from "@/src/lib/device-sync/apple-health-reopen-push";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const now = new Date("2026-11-16T18:00:00Z");
const due = {
  environment: "production", episodeStartedAt: new Date(now.getTime() - 25 * 3_600_000), memberId: "member",
  reopenReminders: true, step: 1, timeZone: "UTC", token: "ab".repeat(32), topic: "ai.withmurph.app", waitDays: null,
};
let inTransaction = false;

describe("Apple Health signing and claim boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); inTransaction = false;
    vi.stubEnv("APNS_TEAM_ID", "TEAMID1234");
    vi.stubEnv("APNS_KMS_KEY_VERSION", "projects/test-project/locations/global/keyRings/test-ring/cryptoKeys/apns/cryptoKeyVersions/1");
    m.query.mockResolvedValue([due]); m.create.mockResolvedValue({ count: 1 }); m.update.mockResolvedValue({ count: 1 });
    m.transaction.mockImplementation(async callback => {
      inTransaction = true;
      try { return await callback({ $queryRaw: m.query, appleHealthReopenPush: { createMany: m.create } }); }
      finally { inTransaction = false; }
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("keeps the configured check separate and claims nothing when configuration is missing", async () => {
    vi.stubEnv("APNS_KEY_ID", "");
    expect(await sendDueAppleHealthReopenPushes({ now })).toMatchObject({ configured: false, claimed: 0 });
    expect(m.query).not.toHaveBeenCalled(); expect(m.transaction).not.toHaveBeenCalled(); expect(m.asymmetricSign).not.toHaveBeenCalled();
  });

  it("records a failed signing attempt without releasing or retrying its claim", async () => {
    vi.stubEnv("APNS_KEY_ID", "HEALTH-FAILURE");
    m.asymmetricSign.mockImplementation(async () => {
      expect(inTransaction).toBe(false); expect(m.create).toHaveBeenCalledOnce();
      throw new Error("unavailable");
    });
    expect(await sendDueAppleHealthReopenPushes({ now })).toMatchObject({ configured: true, claimed: 1, failed: 1, errors: 0 });
    expect(m.update).toHaveBeenCalledExactlyOnceWith({
      data: { outcome: "failed" }, where: { episodeStartedAt: due.episodeStartedAt, step: 1, userId: "member" },
    });
    expect(m.create).toHaveBeenCalledOnce(); expect(m.asymmetricSign).toHaveBeenCalledOnce(); expect(m.connect).not.toHaveBeenCalled();
  });

  it("sends with the prepared token after the final eligibility read and records success", async () => {
    vi.stubEnv("APNS_KEY_ID", "HEALTH-SUCCESS");
    m.asymmetricSign.mockImplementation(async ({ keyVersionName, message }) => {
      expect(inTransaction).toBe(false); expect(m.query).toHaveBeenCalledTimes(2);
      return { keyVersionName, signature: sign("sha256", message, privateKey).toString("base64") };
    });
    const stream = Object.assign(new EventEmitter(), {
      setEncoding: () => {},
      end: () => { stream.emit("response", { ":status": 200 }); stream.emit("end"); },
    });
    const session = Object.assign(new EventEmitter(), {
      close: vi.fn(), destroy: vi.fn(), request: vi.fn(() => stream),
    });
    m.connect.mockImplementation(() => {
      expect(inTransaction).toBe(false); expect(m.query).toHaveBeenCalledTimes(3);
      return session;
    });
    expect(await sendDueAppleHealthReopenPushes({ now })).toMatchObject({ configured: true, claimed: 1, sent: 1, errors: 0 });
    expect(m.asymmetricSign).toHaveBeenCalledOnce(); expect(m.connect).toHaveBeenCalledOnce();
    expect(session.request).toHaveBeenCalledWith(expect.objectContaining({ authorization: expect.stringMatching(/^bearer /) }));
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { outcome: "sent" } }));
  });

  it.each(["contact", "route", "window"])("rechecks %s after pending signing and retains the consumed claim", async reason => {
    vi.stubEnv("APNS_KEY_ID", `HEALTH-RACE-${reason}`);
    const started = deferred(), gate = deferred();
    m.asymmetricSign.mockImplementation(async ({ keyVersionName, message }) => {
      expect(inTransaction).toBe(false); expect(m.create).toHaveBeenCalledOnce();
      started.resolve(); await gate.promise;
      return { keyVersionName, signature: sign("sha256", message, privateKey).toString("base64") };
    });
    const result = sendDueAppleHealthReopenPushes({ now });
    await started.promise;
    // Only nomination and the locked claim have read eligibility so far.
    expect(m.query).toHaveBeenCalledTimes(2);
    if (reason === "contact") m.query.mockResolvedValue([]);
    if (reason === "route") m.query.mockResolvedValue([{ ...due, token: "cd".repeat(32) }]);
    if (reason === "window") vi.setSystemTime(new Date("2026-11-16T21:00:00Z"));
    gate.resolve();
    expect(await result).toMatchObject({ configured: true, claimed: 1, superseded: 1, errors: 0 });
    expect(m.query).toHaveBeenCalledTimes(3);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { outcome: "superseded" } }));
    expect(m.create).toHaveBeenCalledOnce(); expect(m.connect).not.toHaveBeenCalled();
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
