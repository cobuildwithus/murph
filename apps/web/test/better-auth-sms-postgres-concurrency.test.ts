import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hostedAuthAdapter, hostedAuthTransactionAdapter } from "../src/lib/better-auth/adapter";
import { lockHostedAuthOtpTx } from "../src/lib/better-auth/otp-store";
import { authLookupKey } from "../src/lib/better-auth/record-crypto";
import type { AuthRecord } from "../src/lib/better-auth/record";
import { prepareHostedAuthSmsOtp, sendHostedAuthSmsOtp, verifyHostedAuthSmsOtpTx } from "../src/lib/better-auth/sms-otp";
import { getPrisma } from "../src/lib/prisma";
import { syntheticSmsVerification } from "./support/better-auth-sms-verification";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.search || !/^\/(?:murph_dev_better_auth_login|murph_dev_twilio_verify|murph_test(?:_[a-z0-9_]+)?)$/u.test(url.pathname)) {
    throw new Error("SMS challenge proof requires an isolated local test database.");
  }
}

describe.skipIf(!enabled)("Twilio Verify challenge PostgreSQL composition", () => {
  beforeEach(() => vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url")));
  afterAll(async () => { if (enabled) await getPrisma().$disconnect(); });

  async function fixture(run: (input: ReturnType<typeof setup>) => Promise<void>) {
    const input = setup();
    try { await run(input); } finally {
      await input.prisma.hostedAuthRecord.deleteMany({ where: {
        model: "verification", lookupKey: authLookupKey("verification", "identifier", input.phoneNumber),
      } });
    }
  }
  function setup() {
    const prisma = getPrisma(); const phoneNumber = "+12025550149";
    const verification = syntheticSmsVerification();
    const input = { prisma, phoneNumber, verification };
    const adapter = hostedAuthAdapter(prisma)({});
    const read = () => adapter.findOne<AuthRecord>({ model: "verification", where: [{ field: "identifier", value: phoneNumber }] });
    const prepare = (code = verification.codes.get(phoneNumber)!) => prepareHostedAuthSmsOtp({ ...input, code });
    const expire = async () => {
      const record = await read();
      await adapter.update({ model: "verification", where: [{ field: "id", value: record!.id }], update: { expiresAt: new Date(Date.now() - 1) } });
    };
    const verify = (verificationId: string, code = verification.codes.get(phoneNumber)!) => prisma.$transaction(async (tx) => {
      await lockHostedAuthOtpTx(tx, phoneNumber);
      return verifyHostedAuthSmsOtpTx({ adapter: hostedAuthTransactionAdapter(prisma, tx, {}), phoneNumber, code, verificationId });
    });
    return { ...input, adapter, read, prepare, expire, verify };
  }

  it("reserves at most three checks under contention and blocks further checks", () => fixture(async (input) => {
    await sendHostedAuthSmsOtp(input);
    input.verification.check.mockResolvedValue(false);
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => input.prepare("999999")));
    expect(outcomes.every((result) => result.status === "rejected")).toBe(true);
    expect(input.verification.check).toHaveBeenCalledTimes(3);
    await expect(input.prepare()).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    expect(input.verification.check).toHaveBeenCalledTimes(3);
  }));

  it("keeps approval bound to the code and generation while permitting a DB retry", () => fixture(async (input) => {
    await sendHostedAuthSmsOtp(input);
    const code = input.verification.codes.get(input.phoneNumber)!;
    const id = await input.prepare(code);
    expect(await input.prepare(code)).toBe(id);
    const wrong = `${code[0] === "0" ? "1" : "0"}${code.slice(1)}`;
    await expect(input.prepare(wrong)).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    expect(await input.verify(id, wrong)).toBe(false);
    expect(await input.verify(randomUUID(), code)).toBe(false);
    expect(await input.verify(id, code)).toBe(true);
    expect(input.verification.check).toHaveBeenCalledTimes(1);
    await sendHostedAuthSmsOtp(input);
    expect(await input.verify(id, code)).toBe(false);
  }));

  it("rejects expired approval and expired pending challenges before provider work", () => fixture(async (input) => {
    await sendHostedAuthSmsOtp(input);
    await input.expire();
    await expect(input.prepare()).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    expect(input.verification.check).not.toHaveBeenCalled();
    await sendHostedAuthSmsOtp(input);
    const id = await input.prepare();
    await input.expire();
    await expect(input.prepare()).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    await expect(input.verify(id)).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    expect(input.verification.check).toHaveBeenCalledTimes(1);
  }));

  it("replaces local authority when Verify reuses its pending SID and code", () => fixture(async (input) => {
    await sendHostedAuthSmsOtp(input);
    const old = await input.read();
    const sid = await input.verification.send.mock.results[0]!.value;
    input.verification.send.mockResolvedValueOnce(sid);
    await sendHostedAuthSmsOtp(input);
    const id = await input.prepare();
    expect(id).not.toBe(old!.id);
    expect(await input.verify(old!.id)).toBe(false);
    expect(await input.verify(id)).toBe(true);
  }));

  it("fences delayed send and approval responses after a resend", () => fixture(async (input) => {
    const send = input.verification.send.getMockImplementation()!;
    input.verification.send.mockImplementationOnce(async (value) => {
      const sid = await send(value);
      // A new request commits while the old request is outside its transaction.
      await sendHostedAuthSmsOtp(input);
      return sid;
    });
    await expect(sendHostedAuthSmsOtp(input)).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    const check = input.verification.check.getMockImplementation()!;
    input.verification.check.mockImplementationOnce(async (value) => {
      const approved = await check(value);
      await sendHostedAuthSmsOtp(input);
      return approved;
    });
    await expect(input.prepare()).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    expect(await input.verify(await input.prepare())).toBe(true);
  }));

  it("does not authenticate failed sends or ambiguous provider checks", () => fixture(async (input) => {
    input.verification.send.mockRejectedValueOnce(new Error("Synthetic unavailable provider"));
    await expect(sendHostedAuthSmsOtp(input)).rejects.toThrow();
    await expect(input.prepare("012345")).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    expect(input.verification.check).not.toHaveBeenCalled();
    await sendHostedAuthSmsOtp(input);
    const check = input.verification.check.getMockImplementation()!;
    input.verification.check.mockImplementationOnce(async (value) => {
      await check(value); // Upstream consumed the code, but the reply was lost.
      throw new Error("Synthetic connection loss");
    });
    await expect(input.prepare()).rejects.toThrow();
    await expect(input.prepare()).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    await sendHostedAuthSmsOtp(input);
    expect(await input.verify(await input.prepare())).toBe(true);
  }));

  it("rejects the retired local SMS code format", () => fixture(async (input) => {
    await input.adapter.create({ model: "verification", forceAllowId: true, data: {
      id: randomUUID(), identifier: input.phoneNumber, value: "012345:0",
      createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    } });
    await expect(input.prepare("012345")).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
    expect(input.verification.check).not.toHaveBeenCalled();
    await sendHostedAuthSmsOtp(input);
    expect(await input.verify(await input.prepare())).toBe(true);
  }));
});
