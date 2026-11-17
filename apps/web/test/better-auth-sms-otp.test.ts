import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRecord } from "../src/lib/better-auth/record";
import type { HostedAuthSmsVerification } from "../src/lib/better-auth/twilio-verify";

const m = vi.hoisted(() => ({ findOne: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/better-auth/adapter", () => ({ hostedAuthTransactionAdapter: () => ({ findOne: m.findOne, update: m.update }) }));
vi.mock("../src/lib/better-auth/otp-store", () => ({ lockHostedAuthOtpTx: async () => undefined }));

import { prepareHostedAuthSmsOtp } from "../src/lib/better-auth/sms-otp";

const phoneNumber = "+12025550149";
const prisma = { $transaction: async (run: (tx: object) => Promise<unknown>) => run({}) } as unknown as PrismaClient;
const verification = { send: vi.fn<HostedAuthSmsVerification["send"]>(), check: vi.fn<HostedAuthSmsVerification["check"]>() };
const prepare = () => prepareHostedAuthSmsOtp({ prisma, phoneNumber, code: "123456", verification });

function stored(value: string): AuthRecord {
  const now = new Date();
  return { id: "verification_synthetic", identifier: phoneNumber, value, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60_000) };
}
function challenge(state: { verificationSid: string | null; attempts: number }) {
  return stored(JSON.stringify({ version: "twilio-verify-v1", approvedCode: null, ...state }));
}

describe("hosted SMS challenge reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
  });

  // An unreadable stored challenge is answered like a missing one on purpose:
  // the member's way out is to request a new code, which replaces it.
  it("answers a missing, unsent, exhausted or unreadable challenge as the caller's invalid code", async () => {
    for (const record of [null, challenge({ verificationSid: null, attempts: 0 }), challenge({ verificationSid: `VE${"0".repeat(32)}`, attempts: 3 }),
      stored("{"), challenge({ verificationSid: null, attempts: 9 })]) {
      m.findOne.mockResolvedValueOnce(record);
      await expect(prepare()).rejects.toMatchObject({ code: "AUTH_CODE_INVALID", httpStatus: 400 });
    }
    expect(verification.check).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
});
