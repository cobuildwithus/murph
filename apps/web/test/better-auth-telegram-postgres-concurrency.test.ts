import { randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ key: vi.fn() }));
vi.mock("jose", async (original) => ({ ...await original<typeof import("jose")>(), createRemoteJWKSet: () => mocks.key }));
vi.mock("../src/lib/hosted-crypto/domain-root-store", async (original) => ({
  ...await original<typeof import("../src/lib/hosted-crypto/domain-root-store")>(),
  provisionActiveHostedDomainRootEnvelopeForUserOnly: async () => undefined,
  prepareHostedDomainRootForWeb: async ({ userId }: { userId: string }) => ({ domain: "control", userId, rootKeyId: "synthetic-root" }),
  revalidatePreparedHostedDomainRootForWebTx: async () => ({ rootKeyId: "synthetic-root", root: Promise.resolve({ rootKey: Buffer.alloc(32, 7) }) }),
}));

import { generateKeyPair, SignJWT } from "jose";
import { POST as start } from "../app/api/auth/telegram/start/route";
import { POST as verify } from "../app/api/auth/telegram/verify/route";
import { POST as complete } from "../app/api/auth/complete/route";
import { getPrisma } from "../src/lib/prisma";
import { getHostedAppSessionFromRequest } from "../src/lib/hosted-onboarding/app-session";
import { readHostedMemberRoutingState, upsertHostedMemberTelegramRoutingBindingTx } from "../src/lib/hosted-onboarding/hosted-member-routing-store";
import { upsertHostedMemberIdentity } from "../src/lib/hosted-onboarding/hosted-member-identity-store";
import { claimHostedSignupReferralLink, issueHostedSignupReferralLink } from "../src/lib/hosted-growth/signup-referral";
import { prepareHostedAuthTelegramMember } from "../src/lib/better-auth/telegram-member";
import { commitHostedAuthSession } from "../src/lib/better-auth/verified-session";
import { authLookupKey, openAuthRecord } from "../src/lib/better-auth/record-crypto";
import { POST as startCredential } from "../app/api/settings/login-methods/telegram/start/route";
import { POST as prepareCredential } from "../app/api/settings/login-methods/telegram/prepare/route";
import { POST as verifyCredential } from "../app/api/settings/login-methods/telegram/verify/route";
import { POST as removeCredential } from "../app/api/settings/login-methods/remove/route";
import { POST as credentialChallenge } from "../app/api/settings/login-methods/challenge/route";
import { POST as initialPasskeyOptions } from "../app/api/settings/approval-passkeys/initial-options/route";
import { POST as registerPasskey } from "../app/api/settings/approval-passkeys/register/route";
import { authenticator } from "./approval-webauthn-fixture";
import { prepareHostedAuthOtpMember } from "../src/lib/better-auth/member";
import { sendHostedAuthOtp } from "../src/lib/better-auth/send-otp";
import { commitHostedAuthOtp } from "../src/lib/better-auth/otp-transaction";
import { createHostedLinqParticipantContact } from "../src/lib/hosted-onboarding/linq-participant-contact";
import { readHostedLoginMethods } from "../src/lib/better-auth/credential-change";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.searchParams.has("host") || !["/murph_dev_better_auth_adoption", "/murph_dev_better_auth_retirement"].includes(url.pathname)) throw new Error("Telegram proof requires its isolated local task database.");
}
const baseURL = "http://localhost:3000";
const clientId = "123456789";
const secret = Buffer.alloc(32, 29).toString("base64url");

describe.skipIf(!enabled)("Telegram public login PostgreSQL composition", () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let ip = "";
  const memberIds = new Set<string>();
  const telegramIds = new Set<string>();
  const nonces = new Set<string>();
  beforeAll(async () => { keys = await generateKeyPair("ES256"); });
  beforeEach(() => {
    mocks.key.mockResolvedValue(keys.publicKey);
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "true"); vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", secret);
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", baseURL); vi.stubEnv("HOSTED_AUTH_TELEGRAM_CLIENT_ID", clientId);
    vi.stubEnv("VERCEL", "1");
    ip = `2001:db8::${randomInt(1, 65535).toString(16)}`;
  });
  afterEach(async () => {
    const prisma = getPrisma();
    const accounts = await prisma.hostedAuthRecord.findMany({ where: { model: "account", lookupKey: {
      in: [...telegramIds].map((id) => authLookupKey("account", "accountId", id)),
    } }, select: { memberId: true }, take: 20 });
    for (const account of accounts) if (account.memberId) memberIds.add(account.memberId);
    await prisma.hostedMember.deleteMany({ where: { id: { in: [...memberIds] } } });
    await prisma.hostedAuthRecord.deleteMany({ where: { model: "verification", OR: [
      { lookupKey: { in: [...nonces].map((nonce) => authLookupKey("verification", "identifier", `telegram-login:${nonce}`)) } },
      { id: { in: ["start", "verify"].map((operation) => `arl_${authLookupKey("verification", "rate-limit", `telegram:${operation}:ip:${ip}`)}`) } },
    ] } });
    memberIds.clear(); telegramIds.clear(); nonces.clear();
  });
  afterAll(async () => { if (enabled) await getPrisma().$disconnect(); });

  function request(path: string, body?: unknown, cookie?: string) {
    return new Request(`${baseURL}${path}`, { method: "POST", headers: {
      origin: baseURL, "content-type": "application/json", "x-vercel-forwarded-for": ip, ...(cookie ? { cookie } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function begin(id = String(randomInt(100_000_000, 999_999_999))) {
    telegramIds.add(id);
    const response = await start(request("/api/auth/telegram/start"));
    expect(response.status).toBe(200);
    const { nonce } = await response.json(); nonces.add(nonce);
    const cookie = response.headers.getSetCookie()[0].split(";")[0];
    const idToken = await new SignJWT({ id: Number(id), nonce, email: "untrusted@example.test", phone_number: "+12025550111" })
      .setProtectedHeader({ alg: "ES256" }).setIssuer("https://oauth.telegram.org").setAudience(clientId)
      .setSubject("different-oidc-subject").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
    return { id, nonce, cookie, idToken };
  }
  const finish = (flow: Awaited<ReturnType<typeof begin>>, extra: Record<string, unknown> = {}) =>
    verify(request("/api/auth/telegram/verify", { idToken: flow.idToken, ...extra }, flow.cookie));

  async function credentialMember() {
    const prisma = getPrisma();
    const contact = createHostedLinqParticipantContact({ kind: "email", value: `telegram-settings-${randomUUID()}@example.test` });
    if (!contact) throw new Error("Invalid synthetic email");
    const login = async () => {
      let code = "";
      await sendHostedAuthOtp({ baseURL, secret, prisma, contact, delivery: { email: async (delivery) => { code = delivery.code; }, sms: async () => { throw new Error("Unexpected SMS"); } } });
      const prepared = await prepareHostedAuthOtpMember({ contact, prisma });
      const issued = await commitHostedAuthOtp({ baseURL, secret, prisma, ...prepared, otp: { kind: "email", address: contact.value, code } });
      memberIds.add(issued.memberId);
      return { memberId: issued.memberId, cookie: issued.headers.getSetCookie().find((cookie) => cookie.startsWith("murph-auth-session="))!.split(";")[0] };
    };
    const member = await login();
    vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "true");
    const initial = await (await initialPasskeyOptions(request("/api/settings/approval-passkeys/initial-options", {}, member.cookie))).json();
    const key = authenticator("synthetic Telegram settings", baseURL);
    expect((await registerPasskey(request("/api/settings/approval-passkeys/register", {
      initialToken: initial.token, response: key.registration(true, initial.options.challenge),
    }, member.cookie))).status).toBe(200);
    return { ...member, login, approve(challenge: { message: string; token: string }) {
      return { method: "passkey", token: challenge.token, assertion: key.assertion({ counter: 0, customMessage: challenge.message }) };
    } };
  }

  async function beginCredential(member: Awaited<ReturnType<typeof credentialMember>>, id = String(randomInt(100_000_000, 999_999_999))) {
    telegramIds.add(id);
    const started = await startCredential(request("/api/settings/login-methods/telegram/start", {}, member.cookie));
    expect(started.status).toBe(200);
    const { nonce } = await started.json(); nonces.add(nonce);
    const nonceCookie = started.headers.getSetCookie()[0].split(";")[0];
    const cookie = `${member.cookie}; ${nonceCookie}`;
    const idToken = await new SignJWT({ id: Number(id), nonce })
      .setProtectedHeader({ alg: "ES256" }).setIssuer("https://oauth.telegram.org").setAudience(clientId)
      .setSubject("different-oidc-subject").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
    return { id, idToken, nonceCookie, cookie };
  }

  async function prepareLink(member: Awaited<ReturnType<typeof credentialMember>>, flow: Awaited<ReturnType<typeof beginCredential>>) {
    const response = await prepareCredential(request("/api/settings/login-methods/telegram/prepare", { idToken: flow.idToken }, flow.cookie));
    const result = await response.json();
    expect(result, `Telegram prepare status ${response.status}`).toHaveProperty("challenge.token");
    return { idToken: flow.idToken, change: result.change, authorization: member.approve(result.challenge) };
  }

  it("adds and removes Telegram through current-session approval with canonical readback", async () => {
    const prisma = getPrisma(); const member = await credentialMember(); const other = await member.login();
    const flow = await beginCredential(member);
    const completion = await prepareLink(member, flow);
    expect((await verifyCredential(request("/api/settings/login-methods/telegram/verify", completion, flow.cookie))).status).toBe(200);
    expect((await readHostedLoginMethods(prisma, member.memberId)).methods.telegram).toBe(flow.id);
    expect((await readHostedMemberRoutingState({ memberId: member.memberId, prisma }))?.telegramUserId).toBe(flow.id);
    expect((await prepareHostedAuthTelegramMember({ prisma, telegramUserId: flow.id })).memberId).toBe(member.memberId);
    expect((await getHostedAppSessionFromRequest(request("/home", {}, other.cookie)))?.member.id).toBe(member.memberId);
    expect((await verifyCredential(request("/api/settings/login-methods/telegram/verify", completion, flow.cookie))).status).toBe(401);
    const change = { method: "telegram", operation: "remove", expectedIdentity: flow.id, value: null };
    const challenge = await (await credentialChallenge(request("/api/settings/login-methods/challenge", { change }, member.cookie))).json();
    expect((await removeCredential(request("/api/settings/login-methods/remove", { change, authorization: member.approve(challenge) }, member.cookie))).status).toBe(200);
    expect((await readHostedLoginMethods(prisma, member.memberId)).methods.telegram).toBeNull();
    expect((await readHostedMemberRoutingState({ memberId: member.memberId, prisma }))?.telegramUserId).toBeNull();
    expect(await getHostedAppSessionFromRequest(request("/home", {}, other.cookie))).toBeNull();
    expect((await getHostedAppSessionFromRequest(request("/home", {}, member.cookie)))?.member.id).toBe(member.memberId);
  });

  it("never exchanges Telegram login and credential nonces or browser sessions", async () => {
    const member = await credentialMember(); const other = await member.login();
    const login = await begin();
    expect((await prepareCredential(request("/api/settings/login-methods/telegram/prepare", { idToken: login.idToken }, `${member.cookie}; ${login.cookie}`))).status).toBe(401);
    const flow = await beginCredential(member);
    expect((await verify(request("/api/auth/telegram/verify", { idToken: flow.idToken }, flow.cookie))).status).toBe(401);
    expect((await prepareCredential(request("/api/settings/login-methods/telegram/prepare", { idToken: flow.idToken }, `${other.cookie}; ${flow.nonceCookie}`))).status).toBe(401);
    const completion = await prepareLink(member, flow);
    expect((await verifyCredential(request("/api/settings/login-methods/telegram/verify", completion, `${other.cookie}; ${flow.nonceCookie}`))).status).toBe(401);
    expect((await verifyCredential(request("/api/settings/login-methods/telegram/verify", completion, flow.cookie))).status).toBe(200);
  });

  it("requires Telegram proof to match the approved replacement and revokes other sessions", async () => {
    const prisma = getPrisma(); const member = await credentialMember();
    const first = await beginCredential(member);
    expect((await verifyCredential(request("/api/settings/login-methods/telegram/verify", await prepareLink(member, first), first.cookie))).status).toBe(200);
    const other = await member.login();
    const replacement = await beginCredential(member);
    const completion = await prepareLink(member, replacement);
    expect((await verifyCredential(request("/api/settings/login-methods/telegram/verify", { ...completion, change: { ...completion.change, value: "123456789" } }, replacement.cookie))).status).toBe(400);
    expect((await verifyCredential(request("/api/settings/login-methods/telegram/verify", completion, replacement.cookie))).status).toBe(200);
    expect((await readHostedLoginMethods(prisma, member.memberId)).methods.telegram).toBe(replacement.id);
    expect((await readHostedMemberRoutingState({ memberId: member.memberId, prisma }))?.telegramUserId).toBe(replacement.id);
    expect(await getHostedAppSessionFromRequest(request("/home", {}, other.cookie))).toBeNull();
    expect(await prisma.hostedAuthRecord.count({ where: { model: "account", lookupKey: authLookupKey("account", "accountId", first.id) } })).toBe(0);
  });

  it("rejects Telegram identity already owned by another canonical member", async () => {
    const member = await credentialMember(); const existing = await begin();
    const existingResponse = await finish(existing); expect(existingResponse.status).toBe(200);
    const existingMember = await existingResponse.json(); memberIds.add(existingMember.memberId);
    const flow = await beginCredential(member, existing.id);
    const response = await prepareCredential(request("/api/settings/login-methods/telegram/prepare", { idToken: flow.idToken }, flow.cookie));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_CONTACT_IN_USE" } });
    expect((await readHostedLoginMethods(getPrisma(), member.memberId)).methods.telegram).toBeNull();
    expect((await readHostedLoginMethods(getPrisma(), existingMember.memberId)).methods.telegram).toBe(existing.id);
  });

  it("creates a canonical member, completes onboarding, and keeps provider contacts out of login authority", async () => {
    const prisma = getPrisma(); const flow = await begin();
    const response = await finish(flow, { timeZone: "America/Denver" });
    expect(response.status).toBe(200);
    const body = await response.json(); memberIds.add(body.memberId);
    expect(Object.keys(body).sort()).toEqual(["memberId", "ok"]);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("murph-auth-session="))?.split(";")[0];
    expect(cookie).toBeDefined();
    const session = await getHostedAppSessionFromRequest(new Request(`${baseURL}/home`, { headers: { cookie: cookie! } }));
    expect(session?.member.id).toBe(body.memberId); expect(session?.primaryAuthenticatedAt).toBeInstanceOf(Date);
    const user = await openAuthRecord(await prisma.hostedAuthRecord.findUniqueOrThrow({ where: { model_id: { model: "user", id: body.memberId } } }), prisma);
    expect(user.email).toMatch(/@auth\.invalid$/u); expect(user.emailVerified).toBe(false); expect(user.phoneNumber).toBeUndefined();
    expect((await readHostedMemberRoutingState({ memberId: body.memberId, prisma }))?.telegramUserId).toBe(flow.id);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await complete(request("/api/auth/complete", undefined, cookie));
      expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ ok: true, launchConsentGranted: false });
    }
    expect((await prisma.hostedMember.findUniqueOrThrow({ where: { id: body.memberId } })).billingStatus).toBe("not_started");
  });

  it("reuses the same member on repeat login and rejects a consumed nonce", async () => {
    const flow = await begin(); const first = await finish(flow); expect(first.status).toBe(200);
    const body = await first.json(); memberIds.add(body.memberId);
    expect((await finish(flow)).status).toBe(401);
    const again = await finish(await begin(flow.id)); expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ memberId: body.memberId });
    expect(await getPrisma().hostedAuthRecord.count({ where: { model: "session", memberId: body.memberId } })).toBe(2);
  });

  it("binds Telegram proof to this browser and rejects cross-origin completion", async () => {
    const first = await begin(); const second = await begin(first.id);
    expect((await finish({ ...first, cookie: second.cookie })).status).toBe(401);
    expect((await verify(request("/api/auth/telegram/verify", { idToken: first.idToken }))).status).toBe(401);
    expect((await finish({ ...first, cookie: `${first.cookie}; ${first.cookie}` })).status).toBe(401);
    const foreign = request("/api/auth/telegram/verify", { idToken: first.idToken }, first.cookie);
    foreign.headers.set("origin", "https://untrusted.example.test");
    expect((await verify(foreign)).status).toBe(403);
    expect((await finish(first)).status).toBe(200);
  });

  it("preserves an existing independently reconciled Telegram member", async () => {
    const prisma = getPrisma(); const memberId = `telegram-existing-${randomUUID()}`; memberIds.add(memberId);
    const flow = await begin();
    await prisma.hostedMember.create({ data: { id: memberId } });
    await prisma.$transaction(async (tx) => {
      await upsertHostedMemberIdentity({ memberId, prisma: tx, phoneNumber: null, phoneNumberVerifiedAt: null,
        phoneLookupKey: null, maskedPhoneNumberHint: null, signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null, signupPhoneCodeSentAt: null, signupPhoneNumber: null });
      await upsertHostedMemberTelegramRoutingBindingTx({ memberId, telegramUserId: flow.id, prisma: tx });
    });
    const response = await finish(flow); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ memberId });
    expect((await finish(await begin(flow.id))).status).toBe(200);
  });

  it("rolls back referral claim and nonce consumption when session creation fails, then retries the same proof", async () => {
    const prisma = getPrisma(); const referrerMemberId = `telegram-referrer-${randomUUID()}`; memberIds.add(referrerMemberId);
    await prisma.hostedMember.create({ data: { id: referrerMemberId } });
    const referral = await issueHostedSignupReferralLink({ referrerMemberId, prisma, publicBaseUrl: baseURL });
    const claim = await claimHostedSignupReferralLink({ referralCode: new URL(referral.signupUrl).pathname.split("/").at(-1)!, prisma, publicBaseUrl: baseURL });
    const inviteCode = new URL(claim.signupUrl).pathname.split("/").at(-1)!;
    const invite = await prisma.hostedInvite.findUniqueOrThrow({ where: { inviteCode } }); memberIds.add(invite.memberId);
    const flow = await begin();
    if (!/^[A-Za-z0-9_-]+$/u.test(invite.memberId)) throw new Error("Unsafe synthetic trigger target");
    await prisma.$executeRawUnsafe("CREATE FUNCTION auth_test_reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.member_id = TG_ARGV[0] THEN RAISE EXCEPTION 'synthetic session failure'; END IF; RETURN NEW; END $$");
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER auth_test_reject_session BEFORE INSERT ON hosted_auth_record FOR EACH ROW WHEN (NEW.model = 'session') EXECUTE FUNCTION auth_test_reject_session('${invite.memberId}')`);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect((await finish(flow, { inviteCode })).status).toBe(500);
      expect(await prisma.hostedAuthRecord.count({ where: { memberId: invite.memberId } })).toBe(0);
      expect(await readHostedMemberRoutingState({ memberId: invite.memberId, prisma })).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS auth_test_reject_session ON hosted_auth_record");
      await prisma.$executeRawUnsafe("DROP FUNCTION auth_test_reject_session()");
    }
    const response = await finish(flow, { inviteCode }); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ memberId: invite.memberId });
    expect(await prisma.hostedInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({ memberId: invite.memberId, referrerMemberId });
  });

  it("cannot issue a session from a Telegram credential removed after preparation", async () => {
    const prisma = getPrisma(); const flow = await begin(); const response = await finish(flow); expect(response.status).toBe(200);
    const { memberId } = await response.json(); memberIds.add(memberId);
    const prepared = await prepareHostedAuthTelegramMember({ prisma, telegramUserId: flow.id });
    await prisma.hostedAuthRecord.deleteMany({ where: { memberId, model: "account" } });
    await expect(commitHostedAuthSession({ ...prepared, prisma, baseURL, secret, primaryAuthenticatedAt: new Date() })).rejects.toMatchObject({ code: "AUTH_IDENTITY_RECONCILIATION_REQUIRED" });
    expect(await prisma.hostedAuthRecord.count({ where: { memberId, model: "session" } })).toBe(1);
    // Canonical messaging routing alone cannot restore a removed login account.
    expect((await finish(await begin(flow.id))).status).toBe(409);
  });
});
