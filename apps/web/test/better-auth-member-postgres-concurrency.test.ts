import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ read: vi.fn(), codes: new Map<string, string>() }));
vi.mock("../src/lib/better-auth/delivery", () => ({ hostedAuthDelivery: () => ({
  email: async ({ address, code }: { address: string; code: string }) => { provider.codes.set(address, code); },
  sms: async ({ phoneNumber, code }: { phoneNumber: string; code: string }) => { provider.codes.set(phoneNumber, code); },
}) }));
vi.mock("../src/lib/hosted-onboarding/privy", async (original) => ({
  ...await original<typeof import("../src/lib/hosted-onboarding/privy")>(),
  readHostedPrivyUserById: provider.read,
}));
// This suite proves PostgreSQL/canonical composition. KMS preparation is a
// synthetic port; the shared member codec checks member/field binding.
vi.mock("../src/lib/hosted-crypto/domain-root-store", async (original) => ({
  ...await original<typeof import("../src/lib/hosted-crypto/domain-root-store")>(),
  provisionActiveHostedDomainRootEnvelopeForUserOnly: async () => undefined,
  prepareHostedDomainRootForWeb: async ({ userId }: { userId: string }) => ({ domain: "control", userId, rootKeyId: "synthetic-root" }),
  revalidatePreparedHostedDomainRootForWebTx: async () => ({ rootKeyId: "synthetic-root", root: Promise.resolve({ rootKey: Buffer.alloc(32, 7) }) }),
}));

import { POST as sendBrowserCode } from "../app/api/auth/otp/send/route";
import { POST as verifyBrowserCode } from "../app/api/auth/otp/verify/route";
import { POST as logoutBrowser } from "../app/api/auth/logout/route";
import { POST as logoutNative } from "../app/api/device-sync/companion/auth/logout/route";
import { POST as completeBrowserAuthentication } from "../app/api/auth/complete/route";
import { claimHostedSignupReferralLink, issueHostedSignupReferralLink } from "../src/lib/hosted-growth/signup-referral";
import { POST as sendNativeCode } from "../app/api/device-sync/companion/auth/otp/send/route";
import { POST as verifyNativeCode } from "../app/api/device-sync/companion/auth/otp/verify/route";
import { getPrisma } from "../src/lib/prisma";
import { runWithHostedDomainRootProviderCallsDisabled } from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import { readHostedNativeMemberAuth, assertHostedNativeMemberAuthCurrentTx } from "../src/lib/better-auth/native-auth";
import { exchangeHostedAuthSession, readHostedAuthSessionResponse, logoutHostedAuth } from "../src/lib/better-auth/routes";
import { upsertHostedMemberPendingLinqParticipantContactTx } from "../src/lib/hosted-onboarding/hosted-member-routing-store";
import { issueHostedInvite } from "../src/lib/hosted-onboarding/invite-service";
import { sendHostedAuthOtp } from "../src/lib/better-auth/send-otp";
import { hostedAuthOtpIdentifier } from "../src/lib/better-auth/otp-store";
import { authLookupKey } from "../src/lib/better-auth/record-crypto";
import { hostedAuthAdapter } from "../src/lib/better-auth/adapter";
import { exchangeHostedLegacyNativeSession } from "../src/lib/better-auth/native-exchange";
import { issueHostedAppSession, getHostedAppSessionFromRequest, revokeHostedAppSessionFromRequest, assertHostedAppSessionCurrentTx } from "../src/lib/hosted-onboarding/app-session";
import { readHostedAuthSession } from "../src/lib/better-auth/session";
import { classifyHostedNativeCredential } from "../src/lib/better-auth/transport";
import { removeHostedMemberLinkedAccountProjectionTx } from "../src/lib/hosted-onboarding/linked-account-removal";
import { commitHostedAuthOtp, type HostedAuthOtp } from "../src/lib/better-auth/otp-transaction";
import { prepareHostedAuthOtpMember } from "../src/lib/better-auth/member";
import { importHostedAuthMember, lockHostedAuthImportContacts, revalidateHostedAuthImportTx } from "../src/lib/better-auth/import";
import { prepareHostedAuthImport } from "../src/lib/better-auth/migration-source";
import { createHostedLinqParticipantContact } from "../src/lib/hosted-onboarding/linq-participant-contact";
import { readHostedMemberIdentity, upsertHostedMemberIdentity } from "../src/lib/hosted-onboarding/hosted-member-identity-store";
import { readHostedMemberEmailAuthorization } from "../src/lib/hosted-onboarding/hosted-member-store";
import { buildHostedMemberPhoneIdentityFields } from "../src/lib/hosted-onboarding/member-identity-fields";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.search || !/^\/(?:murph_dev_better_auth_login|murph_test(?:_[a-z0-9_]+)?)$/u.test(url.pathname)) {
    throw new Error("Canonical auth proof requires an isolated local test database.");
  }
}
const configuration = () => ({ baseURL: "https://www.withmurph.ai", secret: "synthetic-better-auth-secret-for-tests-only", prisma: getPrisma() });
const jwtKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
function identityToken(memberId: string, changes: Record<string, unknown> = {}) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "ES256", typ: "JWT" })}.${encode({
    iss: "privy.io", aud: "synthetic-auth-app", sub: `did:privy:${memberId}`,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
    cr: "1700000000", linked_accounts: JSON.stringify([{ type: "email", address: "unrelated@example.test", lv: 1_700_000_000 }]),
    ...changes,
  })}`;
  return `${content}.${sign("sha256", Buffer.from(content), { key: jwtKeys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

describe.skipIf(!enabled)("Better Auth canonical member PostgreSQL composition", () => {
  beforeEach(() => {
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "synthetic-auth-app");
    vi.stubEnv("PRIVY_VERIFICATION_KEY", jwtKeys.publicKey.export({ type: "spki", format: "pem" }).toString());
    vi.stubEnv("HOSTED_PRIVY_NATIVE_ENABLED", "true");
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "false");
    vi.stubEnv("VERCEL", "");
    provider.read.mockReset();
    provider.codes.clear();
  });
  afterAll(async () => { if (enabled) await getPrisma().$disconnect(); });

  async function send(kind: "email" | "phone", value: string) {
    let code = "";
    await sendHostedAuthOtp({ ...configuration(), contact: contact(kind, value),
      delivery: { email: async (input) => { code = input.code; }, sms: async (input) => { code = input.code; } },
    });
    const otp: HostedAuthOtp = kind === "email" ? { kind, address: value, code } : { kind, phoneNumber: value, code };
    return otp;
  }
  function contact(kind: "email" | "phone", value: string) {
    const result = createHostedLinqParticipantContact({ kind, value });
    if (!result) throw new Error("Invalid synthetic contact");
    return result;
  }

  it.each(["email", "phone"] as const)("creates one canonical %s member and reuses it on subsequent login", async (kind) => {
    const prisma = getPrisma();
    const value = kind === "email" ? `auth-${randomUUID()}@example.test` : "+12025550141";
    const prepared = await prepareHostedAuthOtpMember({ prisma, contact: contact(kind, value) });
    expect(await prisma.hostedMember.findUnique({ where: { id: prepared.memberId } })).toBeNull();
    try {
      const first = await commitHostedAuthOtp({ ...configuration(), ...prepared, otp: await send(kind, value) });
      expect(first.memberId).toBe(prepared.memberId);
      const canonical = kind === "email"
        ? (await readHostedMemberEmailAuthorization({ memberId: first.memberId, prisma }))?.verifiedEmail?.address
        : (await readHostedMemberIdentity({ memberId: first.memberId, prisma }))?.phoneNumber;
      expect(canonical).toBe(value);
      const next = await prepareHostedAuthOtpMember({ prisma, contact: contact(kind, value) });
      const second = await commitHostedAuthOtp({ ...configuration(), ...next, otp: await send(kind, value) });
      expect(second.memberId).toBe(first.memberId);
      expect(await prisma.hostedAuthRecord.count({ where: { model: "session", memberId: first.memberId } })).toBe(2);
      expect(provider.read).not.toHaveBeenCalled();
    } finally { await prisma.hostedMember.deleteMany({ where: { id: prepared.memberId } }); }
  });

  it.each([["browser", "http://localhost:3000"], ["browser", "https://local.withmurph.ai:3443"], ["native", "http://localhost:3000"]] as const)("completes the public %s OTP routes at %s with canonical signup context", async (transport, baseURL) => {
    const prisma = getPrisma();
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "true");
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 29).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", baseURL);
    vi.stubEnv("VERCEL", "1");
    const value = transport === "browser" ? `route-${randomUUID()}@example.test` : "+12025550146";
    const kind = transport === "browser" ? "email" : "phone";
    // Reset only this fixture's synthetic contact budgets in its owned database.
    const rateIds = [`send:contact:${kind}:${value}`, `verify:contact:${kind}:${value}`, `send:cooldown:${kind}:${value}`]
      .map((key) => `arl_${authLookupKey("verification", "rate-limit", key)}`);
    await prisma.hostedAuthRecord.deleteMany({ where: { model: "verification", id: { in: rateIds } } });
    const ip = `2001:db8::${randomUUID().slice(0, 4)}`;
    const request = (body: unknown) => new Request(`${baseURL}/api/auth/otp/verify`, {
      method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: baseURL, "x-vercel-forwarded-for": ip },
    });
    const send = transport === "browser" ? sendBrowserCode : sendNativeCode;
    const verify = transport === "browser" ? verifyBrowserCode : verifyNativeCode;
    expect((await send(request({ kind, value }))).status).toBe(200);
    const response = await verify(request({ kind, value, code: provider.codes.get(value), timeZone: "America/Denver", userId: "untrusted-member", credentialsChangedAt: null }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.memberId).not.toBe("untrusted-member");
    try {
      const member = await prisma.hostedMember.findUniqueOrThrow({ where: { id: result.memberId } });
      expect(member.pendingActivationTimeZone).toBe("America/Denver");
      expect(member.billingStatus).toBe("not_started");
      expect(member.initialOnboardingCompletedAt).toBeNull();
      if (transport === "browser") {
        expect(Object.keys(result).sort()).toEqual(["memberId", "ok"]);
        const cookie = response.headers.getSetCookie().find((value) => value.startsWith("murph-auth-session="));
        expect(cookie).toBeDefined();
        const current = await getHostedAppSessionFromRequest(new Request(`${baseURL}/home`, {
          headers: { cookie: cookie?.split(";")[0] ?? "" },
        }));
        expect(current?.member.id).toBe(result.memberId);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const completion = await completeBrowserAuthentication(new Request(`${baseURL}/api/auth/complete`, {
            method: "POST", headers: { origin: baseURL, cookie: cookie?.split(";")[0] ?? "" },
          }));
          expect(completion.status).toBe(200);
          expect(await completion.json()).toMatchObject({ ok: true, launchConsentGranted: false });
        }
        expect(await readHostedMemberIdentity({ memberId: result.memberId, prisma })).toMatchObject({ privyUserId: null });
        expect((await prisma.hostedMember.findUniqueOrThrow({ where: { id: result.memberId } })).billingStatus).toBe("not_started");
      } else {
        expect(Object.keys(result).sort()).toEqual(["memberId", "ok", "token"]);
        expect(result.token).toMatch(/^murph_auth_v1\.[A-Za-z0-9]{32}$/u);
        expect(response.headers.getSetCookie()).toEqual([]);
      }
      const replay = await verify(request({ kind, value, code: provider.codes.get(value) }));
      expect(replay.status).toBe(400);
    } finally {
      await prisma.hostedMember.deleteMany({ where: { id: result.memberId } });
      await prisma.hostedAuthRecord.deleteMany({ where: { model: "verification", id: { in: rateIds } } });
    }
  });

  it.each(["email", "phone"] as const)("claims a pristine referral member with %s proof without losing attribution", async (kind) => {
    const prisma = getPrisma(); const referrerMemberId = `auth-referrer-${randomUUID()}`;
    const value = kind === "email" ? `referral-${randomUUID()}@example.test` : "+12025550147";
    await prisma.hostedMember.create({ data: { id: referrerMemberId } });
    let memberId = "";
    try {
      const referral = await issueHostedSignupReferralLink({ referrerMemberId, prisma, publicBaseUrl: configuration().baseURL });
      const claim = await claimHostedSignupReferralLink({
        referralCode: decodeURIComponent(new URL(referral.signupUrl).pathname.split("/").at(-1)!),
        prisma, publicBaseUrl: configuration().baseURL,
      });
      const inviteCode = decodeURIComponent(new URL(claim.signupUrl).pathname.split("/").at(-1)!);
      const invite = await prisma.hostedInvite.findUniqueOrThrow({ where: { inviteCode } });
      memberId = invite.memberId;
      const membersBefore = await prisma.hostedMember.count();
      const selected = contact(kind, value);
      const prepared = await prepareHostedAuthOtpMember({ contact: selected, prisma, inviteCode });
      expect(prepared.memberId).toBe(memberId);
      const otp = await send(kind, value);
      await prisma.hostedInvite.update({ where: { id: invite.id }, data: { expiresAt: new Date(0) } });
      await expect(commitHostedAuthOtp({ ...configuration(), ...prepared, otp })).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
      expect(await prisma.hostedAuthRecord.count({ where: { model: "user", memberId } })).toBe(0);
      await prisma.hostedInvite.update({ where: { id: invite.id }, data: { expiresAt: invite.expiresAt } });
      const result = await commitHostedAuthOtp({ ...configuration(), ...prepared, otp });
      expect(result.memberId).toBe(memberId);
      expect(await prisma.hostedMember.count()).toBe(membersBefore);
      expect(await prisma.hostedInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({ memberId, referrerMemberId });
    } finally { await prisma.hostedMember.deleteMany({ where: { id: { in: [memberId, referrerMemberId] } } }); }
  });

  it("claims the existing text-first email stub after proof and rejects a mismatched invite", async () => {
    const prisma = getPrisma(); const memberId = `auth-pending-${randomUUID()}`; const otherId = `auth-other-${randomUUID()}`;
    const address = `pending-${randomUUID()}@example.test`; const selected = contact("email", address);
    await prisma.hostedMember.createMany({ data: [{ id: memberId }, { id: otherId }] });
    try {
      await prisma.$transaction((tx) => upsertHostedMemberPendingLinqParticipantContactTx({ memberId, contact: selected, observedAt: new Date(), prisma: tx }));
      const invite = await issueHostedInvite({ memberId, channel: "linq", prisma });
      const otherInvite = await issueHostedInvite({ memberId: otherId, channel: "web", prisma });
      await expect(prepareHostedAuthOtpMember({ contact: selected, prisma, inviteCode: otherInvite.inviteCode })).rejects.toMatchObject({ code: "AUTH_IDENTITY_RECONCILIATION_REQUIRED" });
      const prepared = await prepareHostedAuthOtpMember({ contact: selected, prisma, inviteCode: invite.inviteCode });
      expect(prepared.memberId).toBe(memberId);
      const otp = await send("email", address);
      await prisma.hostedInvite.update({ where: { id: invite.id }, data: { expiresAt: new Date(0) } });
      await expect(commitHostedAuthOtp({ ...configuration(), ...prepared, otp })).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
      expect(await prisma.hostedAuthRecord.count({ where: { model: "user", memberId } })).toBe(0);
      // A stale/expired invite cannot consume the code or create a new member.
      const current = await prepareHostedAuthOtpMember({ contact: selected, prisma });
      expect((await commitHostedAuthOtp({ ...configuration(), ...current, otp })).memberId).toBe(memberId);
      expect((await readHostedMemberEmailAuthorization({ memberId, prisma }))?.verifiedEmail?.address).toBe(address);
    } finally { await prisma.hostedMember.deleteMany({ where: { id: { in: [memberId, otherId] } } }); }
  });

  it("rejects stale signup selection without losing the code or selecting a different member", async () => {
    const prisma = getPrisma(); const value = "+12025550142"; const selected = contact("phone", value);
    const stale = await prepareHostedAuthOtpMember({ prisma, contact: selected });
    const winner = await prepareHostedAuthOtpMember({ prisma, contact: selected });
    try {
      await commitHostedAuthOtp({ ...configuration(), ...winner, otp: await send("phone", value) });
      const otp = await send("phone", value);
      await expect(commitHostedAuthOtp({ ...configuration(), ...stale, otp })).rejects.toThrow();
      expect(await prisma.hostedMember.findUnique({ where: { id: stale.memberId } })).toBeNull();
      const current = await prepareHostedAuthOtpMember({ prisma, contact: selected });
      expect((await commitHostedAuthOtp({ ...configuration(), ...current, otp })).memberId).toBe(winner.memberId);
    } finally { await prisma.hostedMember.deleteMany({ where: { id: { in: [stale.memberId, winner.memberId] } } }); }
  });

  it.each(["email", "phone"] as const)("resends %s codes atomically and delivers only after commit", async (kind) => {
    const prisma = getPrisma(); const value = kind === "email" ? `auth-${randomUUID()}@example.test` : "+12025550145";
    const selected = contact(kind, value); const prepared = await prepareHostedAuthOtpMember({ prisma, contact: selected });
    const old = await send(kind, value);
    let code = ""; let deliveredAfterCommit = false;
    const deliver = async (input: { code: string }) => {
      code = input.code;
      // A separate connection can see the committed generation at delivery.
      const rows = await prisma.hostedAuthRecord.findMany({ where: {
        model: "verification", lookupKey: authLookupKey("verification", "identifier", hostedAuthOtpIdentifier(selected)),
      } });
      deliveredAfterCommit = rows.length === 1;
    };
    try {
      await sendHostedAuthOtp({ ...configuration(), contact: selected, delivery: { email: deliver, sms: deliver } });
      expect(deliveredAfterCommit).toBe(true);
      if (old.code !== code) await expect(commitHostedAuthOtp({ ...configuration(), ...prepared, otp: old })).rejects.toThrow();
      const otp: HostedAuthOtp = kind === "email" ? { kind, address: value, code } : { kind, phoneNumber: value, code };
      expect((await commitHostedAuthOtp({ ...configuration(), ...prepared, otp })).memberId).toBe(prepared.memberId);
    } finally { await prisma.hostedMember.deleteMany({ where: { id: prepared.memberId } }); }
  });

  async function legacyFixture(run: (memberId: string, phone: string) => Promise<void>) {
    const prisma = getPrisma(); const memberId = `auth-import-${randomUUID()}`; const phone = "+12025550143";
    const principal = `did:privy:${memberId}`;
    await prisma.hostedMember.create({ data: { id: memberId } });
    try {
      await prisma.$transaction((tx) => upsertHostedMemberIdentity({
        ...buildHostedMemberPhoneIdentityFields(phone), memberId, privyUserId: principal, phoneNumberVerifiedAt: new Date(),
        signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null, signupPhoneCodeSentAt: null, signupPhoneNumber: null,
        preparedControlRoot: { domain: "control", userId: memberId, rootKeyId: "synthetic-root" }, prisma: tx,
      }));
      provider.read.mockResolvedValue({ id: principal, linked_accounts: [{ type: "phone", number: phone, verified_at: 1_700_000_000 }] });
      await run(memberId, phone);
    } finally { await prisma.hostedMember.deleteMany({ where: { id: memberId } }); }
  }

  it("imports an independently reconciled member once and never refreshes credentials from Privy afterward", () => legacyFixture(async (memberId, phone) => {
    const prisma = getPrisma();
    expect(await importHostedAuthMember({ memberId, prisma })).toBe("imported");
    const row = await prisma.hostedAuthRecord.findUniqueOrThrow({ where: { model_id: { model: "user", id: memberId } } });
    provider.read.mockRejectedValue(new Error("Provider must not be consulted after handoff"));
    expect(await importHostedAuthMember({ memberId, prisma })).toBe("already_owned");
    const prepared = await prepareHostedAuthOtpMember({ prisma, contact: contact("phone", phone) });
    expect((await commitHostedAuthOtp({ ...configuration(), ...prepared, otp: await send("phone", phone) })).memberId).toBe(memberId);
    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(row.memberId).toBe(memberId);
    await expect(issueHostedAppSession({ memberId, privyUserId: `did:privy:${memberId}` })).rejects.toMatchObject({ code: "AUTHORITY_MIGRATED" });
  }));

  it("preserves an old browser login, selects the replacement exclusively, and revokes both on logout", () => legacyFixture(async (memberId, phone) => {
    const prisma = getPrisma();
    const secret = Buffer.alloc(32, 29).toString("base64url");
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", secret);
    vi.stubEnv("HOSTED_APP_SESSION_HMAC_KEY", Buffer.alloc(32, 31).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "http://localhost:3000");
    const request = (cookie: string) => new Request("http://localhost:3000/settings", { headers: { cookie } });
    const legacy = await issueHostedAppSession({ memberId, privyUserId: `did:privy:${memberId}` });
    const oldCookie = legacy.cookie.split(";")[0];
    expect((await getHostedAppSessionFromRequest(request(oldCookie)))?.member.id).toBe(memberId);
    const prepared = await prepareHostedAuthOtpMember({ prisma, contact: contact("phone", phone) });
    const issued = await commitHostedAuthOtp({ ...configuration(), baseURL: "http://localhost:3000", secret, ...prepared, otp: await send("phone", phone) });
    const newCookie = issued.headers.getSetCookie().find((cookie) => cookie.startsWith("murph-auth-session="))?.split(";")[0];
    if (!newCookie) throw new Error("Expected the development auth cookie.");
    const both = request(`${oldCookie}; ${newCookie}`);
    const session = await getHostedAppSessionFromRequest(both);
    expect(session?.member.id).toBe(memberId);
    expect(session?.sessionId).not.toBe(legacy.sessionId);
    expect(session?.primaryAuthenticatedAt).toBeInstanceOf(Date);
    if (!session) throw new Error("Expected the replacement browser session.");
    await prisma.$transaction((tx) => assertHostedAppSessionCurrentTx({
      memberId, sessionId: session.sessionId, authProof: session.authProof, request: both, prisma: tx,
    }));
    await expect(prisma.$transaction((tx) => assertHostedAppSessionCurrentTx({
      memberId, sessionId: session.sessionId, request: both, prisma: tx,
    }))).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(await getHostedAppSessionFromRequest(request(`${oldCookie}; murph-auth-session=invalid`))).toBeNull();
    expect((await revokeHostedAppSessionFromRequest({ request: both, reason: "logout" }))).toHaveLength(2);
    expect(await getHostedAppSessionFromRequest(both)).toBeNull();
    expect(await getHostedAppSessionFromRequest(request(oldCookie))).toBeNull();
    await expect(prisma.$transaction((tx) => assertHostedAppSessionCurrentTx({
      memberId, sessionId: session.sessionId, authProof: session.authProof, request: both, prisma: tx,
    }))).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  }));

  it.each(["browser", "native"] as const)("durably revokes %s logout when renewal wins the first deletion race", (transport) => legacyFixture(async (memberId, phone) => {
    const { prisma, issued, browserRequest, nativeRequest, options } = await logoutFixture(memberId, phone);
    const token = issued.token;
    const adapter = hostedAuthAdapter(prisma)({});
    await adapter.update({ model: "session", where: [{ field: "token", value: token }], update: {
      updatedAt: new Date(Date.now() - 2 * 86_400_000), expiresAt: new Date(Date.now() + 28 * 86_400_000),
    } });
    const before = await readHostedNativeMemberAuth(nativeRequest, prisma);
    const originalDelete = prisma.hostedAuthRecord.deleteMany.bind(prisma.hostedAuthRecord);
    const deletion = vi.spyOn(prisma.hostedAuthRecord, "deleteMany").mockImplementationOnce((args) => {
      const pending = (async () => {
      const renewed = await readHostedAuthSession({ ...options, credential: token, transport: "native", refresh: true });
      expect(renewed.session?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
        return originalDelete(args);
      })();
      return {
        then: pending.then.bind(pending), catch: pending.catch.bind(pending), finally: pending.finally.bind(pending),
        [Symbol.toStringTag]: "PrismaPromise",
      };
    });
    try {
      const response = await (transport === "browser" ? logoutBrowser(browserRequest) : logoutNative(nativeRequest));
      expect(response.status).toBe(200);
      expect(await getHostedAppSessionFromRequest(browserRequest)).toBeNull();
      expect(deletion).toHaveBeenCalledTimes(2);
      await expect(readHostedNativeMemberAuth(nativeRequest, prisma)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
      await expect(prisma.$transaction((tx) => assertHostedNativeMemberAuthCurrentTx(before, tx))).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
      expect((await (transport === "browser" ? logoutBrowser(browserRequest) : logoutNative(nativeRequest))).status).toBe(200);
    } finally { deletion.mockRestore(); }
  }));

  it.each(["browser", "native"] as const)("does not acknowledge %s logout after a storage deletion failure", (transport) => legacyFixture(async (memberId, phone) => {
    const { prisma, browserRequest, nativeRequest } = await logoutFixture(memberId, phone);
    const deletion = vi.spyOn(prisma.hostedAuthRecord, "deleteMany").mockRejectedValueOnce(new Error("Synthetic session deletion failure"));
    try {
      const response = await (transport === "browser" ? logoutBrowser(browserRequest) : logoutNative(nativeRequest));
      expect(response.status).toBe(500);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect((await getHostedAppSessionFromRequest(browserRequest))?.member.id).toBe(memberId);
      expect((await readHostedNativeMemberAuth(nativeRequest, prisma)).member.id).toBe(memberId);
    } finally { deletion.mockRestore(); }
  }));

  async function logoutFixture(memberId: string, phone: string) {
    const prisma = getPrisma();
    const secret = Buffer.alloc(32, 29).toString("base64url");
    const baseURL = "http://localhost:3000";
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", secret);
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", baseURL);
    const prepared = await prepareHostedAuthOtpMember({ prisma, contact: contact("phone", phone) });
    const issued = await commitHostedAuthOtp({ ...configuration(), baseURL, secret, ...prepared, otp: await send("phone", phone) });
    expect(issued.memberId).toBe(memberId);
    const cookie = issued.headers.getSetCookie().find((value) => value.startsWith("murph-auth-session="))?.split(";")[0];
    if (!cookie) throw new Error("Expected a browser session credential.");
    const browserRequest = new Request(`${baseURL}/api/auth/logout`, { method: "POST", headers: { cookie, origin: baseURL } });
    const nativeRequest = new Request(`${baseURL}/api/device-sync/companion/auth/logout`, {
      method: "POST", headers: { authorization: `Bearer murph_auth_v1.${issued.token}` },
    });
    return { prisma, issued, browserRequest, nativeRequest, options: { baseURL, secret, prisma } };
  }

  it("rejects provider disagreement and a stale canonical snapshot", () => legacyFixture(async (memberId) => {
    const prisma = getPrisma();
    provider.read.mockResolvedValueOnce({ id: `did:privy:${memberId}`, linked_accounts: [{ type: "phone", number: "+12025550144", verified_at: 1_700_000_000 }] });
    await expect(importHostedAuthMember({ memberId, prisma })).rejects.toThrow("reconciliation");
    provider.read.mockResolvedValueOnce({ id: `did:privy:${memberId}`, linked_accounts: [{ type: "phone", number: "+12025550143", verified_at: null }] });
    await expect(importHostedAuthMember({ memberId, prisma })).rejects.toThrow();
    const prepared = await prepareHostedAuthImport({ memberId, prisma });
    if (prepared.kind !== "prepared") throw new Error("Expected a prepared import");
    await prisma.hostedMemberIdentity.update({ where: { memberId }, data: { phoneNumberVerifiedAt: new Date("2025-01-01") } });
    await expect(prisma.$transaction(async (tx) => {
      await lockHostedAuthImportContacts(tx, prepared);
      await revalidateHostedAuthImportTx(tx, prepared);
    })).rejects.toThrow("reconciliation");
    expect(await prisma.hostedAuthRecord.count({ where: { memberId } })).toBe(0);
  }));

  it("keeps native sessions usable through an issuance pause and checks revocation at commit", () => legacyFixture(async (memberId) => {
    const prisma = getPrisma();
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 29).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "http://localhost:3000");
    vi.stubEnv("HOSTED_PRIVY_NATIVE_ENABLED", "true");
    vi.stubEnv("VERCEL", "1");
    const ip = `2001:db8::${randomUUID().slice(0, 4)}`;
    const req = (token: string) => new Request("http://localhost:3000/api/device-sync/companion/auth/exchange", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "x-vercel-forwarded-for": ip },
    });
    const legacyRequest = req(identityToken(memberId));
    const observedStages: string[] = [];
    const legacy = await readHostedNativeMemberAuth(legacyRequest, prisma, { runStage: async (stage, run) => { observedStages.push(stage); return run(); } });
    expect(observedStages).toEqual(["identity_token_verification", "member_lookup"]);
    await prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(() => assertHostedNativeMemberAuthCurrentTx(legacy, tx)));
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "false");
    await expect(exchangeHostedAuthSession(legacyRequest)).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "true");
    const exchanged = await exchangeHostedAuthSession(legacyRequest);
    expect(exchanged.headers.get("set-cookie")).toBeNull();
    const issued = await exchanged.json();
    expect(Object.keys(issued).sort()).toEqual(["expiresAt", "memberId", "ok", "token"]);
    expect(issued.memberId).toBe(memberId);
    const currentRequest = req(issued.token);
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "false");
    const auth = await readHostedNativeMemberAuth(currentRequest, prisma);
    expect(auth.kind).toBe("better-auth");
    await prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(() => assertHostedNativeMemberAuthCurrentTx(auth, tx)));
    expect((await readHostedAuthSessionResponse(currentRequest, "native", true)).status).toBe(200);
    vi.stubEnv("HOSTED_PRIVY_NATIVE_ENABLED", "false");
    await expect(readHostedNativeMemberAuth(legacyRequest, prisma)).rejects.toMatchObject({ code: "AUTH_CLIENT_UPGRADE_REQUIRED" });
    expect((await readHostedAuthSessionResponse(currentRequest, "native")).status).toBe(200);
    expect((await logoutHostedAuth(currentRequest, "native")).status).toBe(200);
    await expect(readHostedAuthSessionResponse(currentRequest, "native")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(prisma.$transaction((tx) => assertHostedNativeMemberAuthCurrentTx(auth, tx))).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  }));

  it("silently exchanges a real signed legacy principal for the same member without fresh-auth authority", () => legacyFixture(async (memberId, phone) => {
    const prisma = getPrisma(); const token = identityToken(memberId);
    const issued = await exchangeHostedLegacyNativeSession({ token, prisma });
    expect(issued.memberId).toBe(memberId);
    const credential = classifyHostedNativeCredential({ authorization: `Bearer ${issued.token}`, cookie: null, legacyAllowed: false });
    expect(credential.kind).toBe("better-auth");
    const read = await readHostedAuthSession({ ...configuration(), credential: credential.token, transport: "native" });
    expect(read.session?.member.id).toBe(memberId);
    expect(read.session?.primaryAuthenticatedAt).toBeNull();
    expect((await readHostedMemberIdentity({ memberId, prisma }))?.phoneNumber).toBe(phone);
    // A lost response can be retried with valid SDK-restored authority.
    expect((await exchangeHostedLegacyNativeSession({ token, prisma })).memberId).toBe(memberId);
    expect(provider.read).toHaveBeenCalledTimes(1);
    await expect(prisma.$transaction((tx) => removeHostedMemberLinkedAccountProjectionTx({
      memberId, method: "phone", expectedIdentity: phone, prisma: tx,
    }))).rejects.toMatchObject({ code: "AUTHORITY_MIGRATED" });
    await hostedAuthAdapter(prisma)({ user: { additionalFields: { credentialsChangedAt: { type: "date" } } } }).update({
      model: "user", where: [{ field: "id", value: memberId }], update: { credentialsChangedAt: new Date() },
    });
    await expect(exchangeHostedLegacyNativeSession({ token, prisma })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  }));

  it("rejects wrong-audience, expired and unbound signed native principals before import", () => legacyFixture(async (memberId) => {
    const prisma = getPrisma();
    for (const token of [
      identityToken(memberId, { aud: "another-synthetic-app" }),
      identityToken(memberId, { exp: Math.floor(Date.now() / 1000) - 1 }),
      identityToken("unbound-synthetic-member"),
    ]) await expect(exchangeHostedLegacyNativeSession({ token, prisma })).rejects.toThrow();
    expect(provider.read).not.toHaveBeenCalled();
    expect(await prisma.hostedAuthRecord.count({ where: { memberId } })).toBe(0);
  }));
});
