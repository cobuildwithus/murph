import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BetterAuthOptions } from "better-auth";
import type { DBAdapter } from "better-auth/adapters";
import { deleteExpiredHostedAuthRecords } from "../src/lib/hosted-retention/cleanup";
import { getPrisma } from "../src/lib/prisma";
import { createHostedBetterAuth } from "../src/lib/better-auth/auth";
import { commitHostedAuthOtp, type HostedAuthOtp } from "../src/lib/better-auth/otp-transaction";
import { sendHostedAuthSmsOtp, prepareHostedAuthSmsOtp } from "../src/lib/better-auth/sms-otp";
import { syntheticSmsVerification } from "./support/better-auth-sms-verification";
import { hostedAuthAdapter } from "../src/lib/better-auth/adapter";
import { hostedAuthRateLimitStorage } from "../src/lib/better-auth/rate-limit";
import { authLookupKey } from "../src/lib/better-auth/record-crypto";
import { readHostedAuthSession, assertHostedAuthSessionCurrentTx } from "../src/lib/better-auth/session";
import { runWithHostedDomainRootProviderCallsDisabled } from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import type { AuthRecord } from "../src/lib/better-auth/record";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.search || !/^\/(?:murph_dev_better_auth_login|murph_dev_twilio_verify|murph_test(?:_[a-z0-9_]+)?)$/u.test(url.pathname)) {
    throw new Error("Authentication adapter proof requires an isolated local test database.");
  }
}
const options: BetterAuthOptions = {
  user: { additionalFields: {
    phoneNumber: { type: "string", required: false }, phoneNumberVerified: { type: "boolean", required: false },
  } },
};
const dates = () => ({ createdAt: new Date(), updatedAt: new Date() });

describe.skipIf(!enabled)("encrypted Better Auth adapter with PostgreSQL", () => {
  beforeEach(() => vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url")));
  afterAll(async () => { if (enabled) await getPrisma().$disconnect(); });

  async function fixture(run: (f: { adapter: DBAdapter; memberId: string; email: string; token: string }) => Promise<void>) {
    const prisma = getPrisma(); const memberId = `auth-proof-${randomUUID()}`;
    await prisma.hostedMember.create({ data: { id: memberId } });
    const adapter = hostedAuthAdapter(prisma)(options);
    const email = `${memberId}@example.test`; const token = randomUUID().replaceAll("-", "");
    try {
      await adapter.create({ model: "user", forceAllowId: true, data: { id: memberId, email, emailVerified: true, name: "", ...dates() } });
      await adapter.create({ model: "session", forceAllowId: true, data: {
        id: `session-${memberId}`, userId: memberId, token, expiresAt: new Date(Date.now() + 60_000), ...dates(),
      } });
      await run({ adapter, memberId, email, token });
    } finally { await prisma.hostedMember.deleteMany({ where: { id: memberId } }); }
  }

  it("atomically limits concurrent pre-authentication requests without retaining raw selectors", async () => {
    const prisma = getPrisma(); const key = `synthetic-limit-${randomUUID()}`;
    const digest = authLookupKey("verification", "rate-limit", key); const id = `arl_${digest}`;
    try {
      const storage = hostedAuthRateLimitStorage(prisma);
      const outcomes = await Promise.all(Array.from({ length: 8 }, () => storage.consume(key, { max: 2, window: 60 })));
      expect(outcomes.filter((result) => result.allowed)).toHaveLength(2);
      expect(outcomes.filter((result) => !result.allowed).every((result) => result.retryAfter && result.retryAfter > 0)).toBe(true);
      const row = await prisma.hostedAuthRecord.findUniqueOrThrow({ where: { model_id: { model: "verification", id } } });
      expect(JSON.stringify(row)).not.toContain(key);
      await prisma.hostedAuthRecord.update({ where: { model_id: { model: "verification", id } }, data: { expiresAt: new Date("2040-01-01") } });
      await expect(storage.consume(key, { max: 2, window: 60 })).rejects.toThrow();
    } finally { await prisma.hostedAuthRecord.deleteMany({ where: { model: "verification", id } }); }
  });

  it("runs the pinned Better Auth email OTP, secure cookie, bearer and logout paths", () => fixture(async ({ memberId, email }) => {
    vi.stubEnv("NODE_ENV", "production");
    let delivered = "";
    const auth = createHostedBetterAuth({
      baseURL: "https://www.withmurph.ai", secret: "synthetic-better-auth-secret-for-tests-only", prisma: getPrisma(),
      delivery: { email: async ({ address, code }) => { expect(address).toBe(email); delivered = code; } },
    });
    const headers = new Headers({ origin: "https://www.withmurph.ai" });
    await auth.api.sendVerificationOTP({ headers, body: { email, type: "sign-in" } });
    expect(delivered).toMatch(/^\d{6}$/u);
    const result = await auth.api.signInEmailOTP({ headers, body: { email, otp: delivered }, returnHeaders: true });
    expect(result.response.user.id).toBe(memberId);
    const cookie = result.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-murph-auth-session=");
    expect(cookie).toContain("Secure"); expect(cookie).toContain("HttpOnly"); expect(cookie).not.toContain("Domain=");
    const cookieHeaders = new Headers({ cookie: cookie.split(";")[0] });
    expect((await auth.api.getSession({ headers: cookieHeaders }))?.user.id).toBe(memberId);
    expect((await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${result.response.token}` }) }))?.user.id).toBe(memberId);
    await expect(auth.api.signInEmailOTP({ headers, body: { email, otp: delivered } })).rejects.toThrow();
    await auth.api.signOut({ headers: cookieHeaders });
    expect(await auth.api.getSession({ headers: cookieHeaders })).toBeNull();
  }));

  it("runs phone-only signup without marking its opaque email alias verified", () => fixture(async ({ memberId }) => {
    const prisma = getPrisma();
    await prisma.hostedAuthRecord.deleteMany({ where: { model: "user", id: memberId } });
    const phone = "+12025550123"; const verification = syntheticSmsVerification();
    await sendHostedAuthSmsOtp({ prisma, phoneNumber: phone, verification });
    const code = verification.codes.get(phone)!;
    const verificationId = await prepareHostedAuthSmsOtp({ prisma, phoneNumber: phone, code, verification });
    const configuration = { baseURL: "https://www.withmurph.ai", secret: "synthetic-better-auth-secret-for-tests-only", prisma };
    const otp: HostedAuthOtp = { kind: "phone", phoneNumber: phone, code, verificationId };
    await commitHostedAuthOtp({ ...configuration, memberId, otp, commitMember: async () => undefined });
    const user = await hostedAuthAdapter(prisma)(options).findOne<AuthRecord>({ model: "user", where: [{ field: "id", value: memberId }] });
    expect(user?.email).toMatch(/@auth\.invalid$/u);
    expect(user).toMatchObject({ id: memberId, emailVerified: false, phoneNumber: phone, phoneNumberVerified: true });
    await expect(commitHostedAuthOtp({ ...configuration, memberId, otp, commitMember: async () => undefined })).rejects.toThrow();
  }));

  it("enforces the pinned email plugin's failed-attempt budget", () => fixture(async ({ email }) => {
    let delivered = "";
    const auth = createHostedBetterAuth({
      baseURL: "https://www.withmurph.ai", secret: "synthetic-better-auth-secret-for-tests-only", prisma: getPrisma(),
      delivery: { email: async ({ code }) => { delivered = code; } },
    });
    await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const wrong = `${delivered[0] === "0" ? "1" : "0"}${delivered.slice(1)}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(auth.api.signInEmailOTP({ body: { email, otp: wrong } })).rejects.toThrow();
    }
    await expect(auth.api.signInEmailOTP({ body: { email, otp: delivered } })).rejects.toThrow();
  }));

  it("reads browser/native sessions and rechecks exact authenticated state without provider calls at commit", () => fixture(async ({ memberId, email, adapter }) => {
    const prisma = getPrisma();
    const configuration = { baseURL: "https://www.withmurph.ai", secret: "synthetic-better-auth-secret-for-tests-only", prisma };
    let code = "";
    const auth = createHostedBetterAuth({ ...configuration, delivery: {
      email: async (input) => { code = input.code; },
    } });
    await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const issued = await commitHostedAuthOtp({ ...configuration, memberId, otp: { kind: "email", address: email, code }, commitMember: async () => undefined });
    const cookie = (issued.headers.get("set-cookie") ?? "").split(";")[0].split("=").slice(1).join("=");
    const browser = await readHostedAuthSession({ ...configuration, credential: cookie, transport: "browser" });
    const native = await readHostedAuthSession({ ...configuration, credential: issued.token, transport: "native" });
    if (!browser.session || !native.session) throw new Error("Expected issued sessions");
    expect(browser.session.sessionId).toBe(native.session.sessionId);
    expect(native.session.primaryAuthenticatedAt).toBeInstanceOf(Date);
    const original = native.session;
    const assertCurrent = (credential = issued.token) => prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(() => assertHostedAuthSessionCurrentTx({
      credential, memberId, sessionId: original.sessionId, proof: original.proof, prisma: tx,
    })));
    await expect(assertCurrent()).resolves.toBeUndefined();
    await expect(assertCurrent("A".repeat(32))).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await adapter.update({ model: "session", where: [{ field: "id", value: original.sessionId }], update: {
      expiresAt: new Date(Date.now() + 27 * 86_400_000),
    } });
    await expect(assertCurrent()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    const renewed = await readHostedAuthSession({ ...configuration, credential: issued.token, transport: "native", refresh: true });
    expect(renewed.session?.primaryAuthenticatedAt).toEqual(original.primaryAuthenticatedAt);
    expect(renewed.session?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await auth.api.signOut({ headers: new Headers({ authorization: `Bearer ${issued.token}` }) });
    expect((await readHostedAuthSession({ ...configuration, credential: issued.token, transport: "native" })).session).toBeNull();
    await expect(assertCurrent()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  }));

  it.each(["email", "phone"] as const)("rolls back %s OTP consumption with canonical creation, then permits a retry", async (kind) => {
    const prisma = getPrisma(); const memberId = `auth-proof-${randomUUID()}`;
    const email = `${memberId}@example.test`; const phone = "+12025550128";
    let delivered = "";
    const configuration = { baseURL: "https://www.withmurph.ai", secret: "synthetic-better-auth-secret-for-tests-only", prisma };
    const auth = createHostedBetterAuth({ ...configuration,
      delivery: { email: async ({ code }) => { delivered = code; } },
    });
    const verification = syntheticSmsVerification();
    if (kind === "email") await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    else {
      await sendHostedAuthSmsOtp({ prisma, phoneNumber: phone, verification });
      delivered = verification.codes.get(phone)!;
    }
    const otp: HostedAuthOtp = kind === "email"
      ? { kind, address: email, code: delivered } : { kind, phoneNumber: phone, code: delivered,
          verificationId: await prepareHostedAuthSmsOtp({ prisma, phoneNumber: phone, code: delivered, verification }) };
    try {
      await expect(commitHostedAuthOtp({ ...configuration, memberId, otp, commitMember: async (tx) => {
        await tx.hostedMember.create({ data: { id: memberId } });
        throw new Error("Synthetic canonical write failure");
      } })).rejects.toThrow();
      expect(await prisma.hostedMember.findUnique({ where: { id: memberId } })).toBeNull();
      expect(await prisma.hostedAuthRecord.count({ where: { memberId } })).toBe(0);
      if (kind === "phone") {
        expect(await prepareHostedAuthSmsOtp({ prisma, phoneNumber: phone, code: delivered, verification })).toBe(otp.kind === "phone" && otp.verificationId);
        expect(verification.check).toHaveBeenCalledTimes(1);
      }
      const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => commitHostedAuthOtp({
        ...configuration, memberId, otp,
        commitMember: async (tx) => { await tx.hostedMember.create({ data: { id: memberId } }); },
      })));
      const success = attempts.filter((result) => result.status === "fulfilled");
      expect(success).toHaveLength(1);
      expect(await prisma.hostedAuthRecord.count({ where: { model: "session", memberId } })).toBe(1);
      const result = success[0];
      if (result?.status !== "fulfilled") throw new Error("Expected one completed login");
      expect((await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${result.value.token}` }) }))?.user.id).toBe(memberId);
    } finally { await prisma.hostedMember.deleteMany({ where: { id: memberId } }); }
  });

  it.each(["email", "phone"] as const)("commits failed %s OTP budgets without entering canonical completion", async (kind) => {
    const prisma = getPrisma(); const memberId = `auth-proof-${randomUUID()}`;
    const email = `${memberId}@example.test`; const phone = "+12025550129";
    let delivered = ""; const commitMember = vi.fn(async () => undefined);
    const configuration = { baseURL: "https://www.withmurph.ai", secret: "synthetic-better-auth-secret-for-tests-only", prisma };
    const auth = createHostedBetterAuth({ ...configuration,
      delivery: { email: async ({ code }) => { delivered = code; } },
    });
    const verification = syntheticSmsVerification();
    if (kind === "email") await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    else {
      await sendHostedAuthSmsOtp({ prisma, phoneNumber: phone, verification });
      delivered = verification.codes.get(phone)!;
    }
    const wrong = `${delivered[0] === "0" ? "1" : "0"}${delivered.slice(1)}`;
    for (const code of [wrong, wrong, wrong, delivered]) {
      if (kind === "phone") {
        await expect(prepareHostedAuthSmsOtp({ prisma, phoneNumber: phone, code, verification })).rejects.toMatchObject({ code: "AUTH_CODE_INVALID" });
      } else {
        await expect(commitHostedAuthOtp({ ...configuration, memberId, otp: { kind, address: email, code }, commitMember })).rejects.toThrow();
      }
    }
    expect(commitMember).not.toHaveBeenCalled();
    expect(await prisma.hostedMember.findUnique({ where: { id: memberId } })).toBeNull();
  });

  it("reclaims expired sessions and pre-auth state without removing live authority", () => fixture(async ({ adapter, memberId }) => {
    const id = `expired-${memberId}`; const now = new Date("2026-01-01T00:00:00Z");
    const expiresAt = new Date(now.getTime() - 1);
    try {
      await adapter.create({ model: "verification", forceAllowId: true, data: { id, identifier: id, value: "synthetic:0", expiresAt, ...dates() } });
      await adapter.create({ model: "session", forceAllowId: true, data: { id, userId: memberId, token: randomUUID().replaceAll("-", ""), expiresAt, ...dates() } });
      expect(await deleteExpiredHostedAuthRecords({ now, prisma: getPrisma() })).toBe(2);
      expect(await adapter.findOne({ model: "user", where: [{ field: "id", value: memberId }] })).not.toBeNull();
      expect(await adapter.count({ model: "session", where: [{ field: "userId", value: memberId }] })).toBe(1);
    } finally { await getPrisma().hostedAuthRecord.deleteMany({ where: { model: "verification", id } }); }
  }));

  it("covers actual factory create, partial read, blinded contact lookup, and update", () => fixture(async ({ adapter, memberId, email }) => {
    const selected = await adapter.findOne({ model: "user", where: [{ field: "email", value: email }], select: ["id"] });
    expect(selected).toEqual({ id: memberId });
    const row = await getPrisma().hostedAuthRecord.findUniqueOrThrow({ where: { model_id: { model: "user", id: memberId } } });
    expect(row.lookupKey).toBe(authLookupKey("user", "email", email));
    expect(row.payloadEncrypted).not.toContain(email);
    await adapter.update({ model: "user", where: [{ field: "id", value: memberId }], update: { name: "Synthetic" } });
    expect(await adapter.findOne({ model: "user", where: [{ field: "id", value: memberId }] })).toMatchObject({ name: "Synthetic" });
  }));

  it.each(["select", "count", "updateMany", "deleteMany"] as const)("authenticates full records before %s", (operation) => fixture(async ({ adapter, memberId }) => {
    const prisma = getPrisma(); const id = `session-${memberId}`;
    await prisma.hostedAuthRecord.update({ where: { model_id: { model: "session", id } }, data: { expiresAt: new Date("2040-01-01") } });
    const where = [{ field: "userId", value: memberId }];
    const run = () => {
      if (operation === "select") return adapter.findOne({ model: "session", where, select: ["id"] });
      if (operation === "count") return adapter.count({ model: "session", where });
      if (operation === "updateMany") return adapter.updateMany({ model: "session", where, update: { expiresAt: new Date("2030-01-01") } });
      return adapter.deleteMany({ model: "session", where });
    };
    await expect(run()).rejects.toThrow("integrity");
    expect(await prisma.hostedAuthRecord.count({ where: { model: "session", id } })).toBe(1);
  }));

  it("passes the protected adapter into real transaction callbacks and rolls back", () => fixture(async ({ adapter, memberId }) => {
    await expect(adapter.transaction(async (tx) => {
      await tx.update({ model: "user", where: [{ field: "id", value: memberId }], update: { name: "Rolled back" } });
      expect(await tx.findOne({ model: "user", where: [{ field: "id", value: memberId }], select: ["name"] })).toEqual({ name: "Rolled back" });
      throw new Error("abort proof");
    })).rejects.toThrow("abort proof");
    expect(await adapter.findOne({ model: "user", where: [{ field: "id", value: memberId }] })).toMatchObject({ name: "" });
  }));

  it("admits one concurrent consume and preserves consumed state on callback rollback", () => fixture(async ({ adapter, memberId }) => {
    const id = `verification-${memberId}`; const identifier = `otp-${memberId}`;
    const data = { id, identifier, value: "synthetic:0", expiresAt: new Date(Date.now() + 60_000), ...dates() };
    const where = [{ field: "id", value: id }];
    try {
      await adapter.create({ model: "verification", forceAllowId: true, data });
      await expect(adapter.transaction(async (tx) => { expect(await tx.consumeOne({ model: "verification", where })).not.toBeNull(); throw new Error("abort proof"); })).rejects.toThrow("abort proof");
      const outcomes = await Promise.all(Array.from({ length: 8 }, () => adapter.consumeOne({ model: "verification", where })));
      expect(outcomes.filter(Boolean)).toHaveLength(1);
    } finally { await getPrisma().hostedAuthRecord.deleteMany({ where: { model: "verification", id } }); }
  }));

  it("supports bounded authenticated list/count/bulk updates and canonical deletion cascade", () => fixture(async ({ adapter, memberId }) => {
    const where = [{ field: "userId", value: memberId }];
    const expiresAt = new Date(Date.now() + 120_000);
    expect(await adapter.updateMany({ model: "session", where, update: { expiresAt } })).toBe(1);
    const sessions = await adapter.findMany<AuthRecord>({ model: "session", where, limit: 20, sortBy: { field: "createdAt", direction: "desc" } });
    expect(sessions[0]?.expiresAt).toEqual(expiresAt);
    expect(await adapter.count({ model: "session", where })).toBe(1);
    await getPrisma().hostedMember.delete({ where: { id: memberId } });
    expect(await adapter.count({ model: "session", where })).toBe(0);
  }));

  it("rejects unbounded scans and unreviewed numeric counters; authenticates emulated joins", () => fixture(async ({ adapter, memberId }) => {
    await expect(adapter.findMany({ model: "user" })).rejects.toThrow("bounded");
    await expect(adapter.findMany({ model: "user", where: [{ field: "emailVerified", value: true }] })).rejects.toThrow("selector");
    const joined = await adapter.findOne({ model: "user", where: [{ field: "id", value: memberId }], join: { session: true } });
    expect(joined).toMatchObject({ session: [{ userId: memberId }] });
    await getPrisma().hostedAuthRecord.update({
      where: { model_id: { model: "session", id: `session-${memberId}` } }, data: { expiresAt: new Date("2040-01-01") },
    });
    await expect(adapter.findOne({ model: "user", where: [{ field: "id", value: memberId }], join: { session: true } })).rejects.toThrow("integrity");
    await expect(adapter.incrementOne({ model: "user", where: [{ field: "id", value: memberId }], increment: { attempts: 1 } })).rejects.toThrow();
  }));
});
