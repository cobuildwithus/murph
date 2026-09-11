import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";
import { authLookupKey, openAuthRecord, sealAuthRecord } from "../src/lib/better-auth/record-crypto";
import { parseAuthRecord } from "../src/lib/better-auth/record";

const prisma = getPrisma(); // The shared synthetic member codec does not access a database.
const dates = { createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") };
const verification = {
  id: "verification-synthetic", identifier: "sign-in-otp-synthetic@example.test",
  value: "synthetic-otp-digest:0", expiresAt: new Date("2026-01-01T00:05:00Z"), ...dates,
};
const session = { id: "session-synthetic", userId: "member-synthetic", token: "s".repeat(32), expiresAt: verification.expiresAt, ...dates };

beforeEach(() => vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url")));

describe("authentication record integrity", () => {
  it("uses real authenticated encryption for pre-member OTP state and blinded selectors", async () => {
    const row = await sealAuthRecord("verification", verification, prisma);
    expect(row.payloadEncrypted).not.toContain("synthetic");
    expect(row.lookupKey).not.toContain("synthetic");
    expect(await openAuthRecord(row, prisma)).toEqual(verification);
    expect(authLookupKey("user", "email", "synthetic@example.test"))
      .not.toBe(authLookupKey("verification", "identifier", "synthetic@example.test"));
  });

  it.each(["id", "lookupKey", "secondaryLookupKey", "createdAt", "updatedAt", "expiresAt"] as const)(
    "rejects a forged OTP %s before returning its value", async (field) => {
      const row = await sealAuthRecord("verification", verification, prisma);
      const forged = { ...row, [field]: field.endsWith("At") ? new Date("2030-01-01") : "forged" };
      await expect(openAuthRecord(forged, prisma)).rejects.toThrow();
    },
  );

  it.each(["id", "memberId", "lookupKey", "expiresAt"] as const)(
    "binds member-owned session %s to the complete encrypted record", async (field) => {
      const row = await sealAuthRecord("session", session, prisma);
      const forged = { ...row, [field]: field === "expiresAt" ? new Date("2030-01-01") : "forged" };
      await expect(openAuthRecord(forged, prisma)).rejects.toThrow();
    },
  );

  it("rejects corrupted ciphertext and the wrong storage key", async () => {
    const row = await sealAuthRecord("verification", verification, prisma);
    const parts = row.payloadEncrypted.split(".");
    parts[2] = Buffer.from("corrupt").toString("base64url");
    await expect(openAuthRecord({ ...row, payloadEncrypted: parts.join(".") }, prisma)).rejects.toThrow();
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 18).toString("base64url"));
    await expect(openAuthRecord(row, prisma)).rejects.toThrow();
  });

  it("refuses provider credentials, non-numeric Telegram identities, and session IP storage", () => {
    const account = { id: "account-synthetic", userId: session.userId, accountId: "123456789", providerId: "telegram", ...dates };
    expect(() => parseAuthRecord("account", { ...account, accessToken: "provider-secret" })).toThrow();
    expect(() => parseAuthRecord("account", { ...account, accountId: "username" })).toThrow();
    expect(() => parseAuthRecord("session", { ...session, ipAddress: "192.0.2.1" })).toThrow();
  });
});
