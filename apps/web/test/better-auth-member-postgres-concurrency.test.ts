import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ read: vi.fn(), signal: vi.fn(), codes: new Map<string, string>() }));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", async (original) => ({
  ...await original<typeof import("../src/lib/hosted-orchestration/signal-runtime")>(), signalHostedMailboxAppendRuntime: provider.signal,
}));
vi.mock("../src/lib/better-auth/delivery", () => ({ hostedAuthDelivery: () => ({
  email: async ({ address, code }: { address: string; code: string }) => { provider.codes.set(address, code); },
}) }));
vi.mock("../src/lib/better-auth/twilio-verify", () => ({ hostedAuthSmsVerification: () => sms }));
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

import { POST as initialPasskeyOptions } from "../app/api/settings/approval-passkeys/initial-options/route";
import { POST as registerPasskey } from "../app/api/settings/approval-passkeys/register/route";
import { POST as rotateRecoveryKey } from "../app/api/settings/approval-passkeys/recovery-key/route";
import { POST as recoveryOptions } from "../app/api/settings/approval-passkeys/recovery/options/route";
import { POST as recoveryRegister } from "../app/api/settings/approval-passkeys/recovery/register/route";
import { POST as settingsChallenge } from "../app/api/settings/sensitive-action-challenge/route";
import { readApprovalPasskeyState, prepareApprovalPasskeyWrite, commitApprovalPasskeyWriteTx } from "../src/lib/sensitive-actions/passkey-store";
import { lockHostedMemberRow } from "../src/lib/hosted-onboarding/shared";
import { readHostedMailboxWakeByItemId } from "../src/lib/hosted-mailbox/store";
import { authenticator } from "./approval-webauthn-fixture";
import { POST as credentialChallenge } from "../app/api/settings/login-methods/challenge/route";
import { POST as sendCredentialCode } from "../app/api/settings/login-methods/otp/send/route";
import { POST as verifyCredentialCode } from "../app/api/settings/login-methods/otp/verify/route";
import { POST as removeCredential } from "../app/api/settings/login-methods/remove/route";
import { POST as credentialAuthenticationOptions } from "../app/api/settings/approval-passkeys/authenticate/route";
import { GET as loginMethods } from "../app/api/settings/login-methods/route";
import { readHostedLoginMethods, type HostedCredentialChange } from "../src/lib/better-auth/credential-change";

import { POST as sendBrowserCode } from "../app/api/auth/otp/send/route";
import { POST as verifyBrowserCode } from "../app/api/auth/otp/verify/route";
import { POST as logoutBrowser } from "../app/api/auth/logout/route";
import { POST as renewBrowser } from "../app/api/auth/session/route";
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
import { prepareHostedAuthSmsOtp } from "../src/lib/better-auth/sms-otp";
import { syntheticSmsVerification } from "./support/better-auth-sms-verification";
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
import { readHostedMemberEmailAuthorization, upsertHostedMemberEmailAuthorization } from "../src/lib/hosted-onboarding/hosted-member-store";
import { buildHostedMemberPhoneIdentityFields } from "../src/lib/hosted-onboarding/member-identity-fields";

let sms = syntheticSmsVerification(provider.codes);
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.search || !/^\/(?:murph_dev_better_auth_login|murph_dev_better_auth_adoption|murph_dev_twilio_verify|murph_test(?:_[a-z0-9_]+)?)$/u.test(url.pathname)) {
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
    provider.signal.mockReset();
    provider.codes.clear();
    sms = syntheticSmsVerification(provider.codes);
  });
  afterAll(async () => { if (enabled) await getPrisma().$disconnect(); });

  async function send(kind: "email" | "phone", value: string) {
    let code = "";
    await sendHostedAuthOtp({ ...configuration(), contact: contact(kind, value),
      delivery: { email: async (input) => { code = input.code; } }, smsVerification: sms,
    });
    if (kind === "phone") code = provider.codes.get(value)!;
    const otp: HostedAuthOtp = kind === "email" ? { kind, address: value, code } : { kind, phoneNumber: value, code,
      verificationId: await prepareHostedAuthSmsOtp({ prisma: getPrisma(), phoneNumber: value, code, verification: sms }) };
    return otp;
  }
  function contact(kind: "email" | "phone", value: string) {
    const result = createHostedLinqParticipantContact({ kind, value });
    if (!result) throw new Error("Invalid synthetic contact");
    return result;
  }

  async function withInitialPasskeyMember(run: (f: {
    prisma: ReturnType<typeof getPrisma>; memberId: string; token: string;
    request(body: unknown, cookieOverride?: string): Request;
    loginAgain(): Promise<string>;
  }) => Promise<void>, initialKind: "email" | "phone" = "email") {
    const prisma = getPrisma();
    const secret = Buffer.alloc(32, 29).toString("base64url");
    const baseURL = "https://www.withmurph.ai";
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", secret);
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", baseURL);
    vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "true");
    const value = initialKind === "email" ? `initial-passkey-${randomUUID()}@example.test` : "+12025550179";
    const prepared = await prepareHostedAuthOtpMember({ prisma, contact: contact(initialKind, value) });
    const issue = async () => commitHostedAuthOtp({ baseURL, secret, prisma,
      ...await prepareHostedAuthOtpMember({ prisma, contact: contact(initialKind, value) }), otp: await send(initialKind, value),
    });
    // Use the originally prepared member for first issuance; a second prepare
    // before commit would generate another canonical ID for an unclaimed email.
    const issued = await commitHostedAuthOtp({ baseURL, secret, prisma, ...prepared, otp: await send(initialKind, value) });
    const cookieFor = (headers: Headers) => headers.getSetCookie().find((value) => value.startsWith("murph-auth-session="))?.split(";")[0] ?? "";
    const cookie = cookieFor(issued.headers);
    expect(cookie).not.toBe("");
    try {
      await run({ prisma, memberId: issued.memberId, token: issued.token,
        request: (body, cookieOverride = cookie) => new Request(`${baseURL}/api/settings/approval-passkeys/register`, {
          method: "POST", headers: { origin: baseURL, cookie: cookieOverride, "content-type": "application/json" }, body: JSON.stringify(body),
        }),
        loginAgain: async () => cookieFor((await issue()).headers),
      });
    } finally { await prisma.hostedMember.deleteMany({ where: { id: issued.memberId } }); }
  }

  async function initialEnrollment(request: (body: unknown) => Request) {
    const optionsResponse = await initialPasskeyOptions(request({}));
    expect(optionsResponse.status).toBe(200);
    const result: { token: string; options: { challenge: string } } = await optionsResponse.json();
    const key = authenticator("synthetic initial enrollment");
    return { initialToken: result.token, response: key.registration(true, result.options.challenge) };
  }

  async function withCredentialMember(run: (f: {
    memberId: string; prisma: ReturnType<typeof getPrisma>; email: string | null;
    request(path: string, body: unknown, cookie?: string): Request;
    loginAgain(): Promise<string>;
    authorize(change: HostedCredentialChange): Promise<{ method: "passkey"; token: string; assertion: ReturnType<ReturnType<typeof authenticator>["assertion"]> }>;
    send(change: HostedCredentialChange): Promise<string>;
    recoveryKey(): Promise<string>;
  }) => Promise<void>, initialKind: "email" | "phone" = "email") {
    return withInitialPasskeyMember(async (f) => {
      vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "true");
      vi.stubEnv("VERCEL", "1");
      const ip = `2001:db8::${randomUUID().slice(0, 4)}`;
      const baseURL = "https://www.withmurph.ai";
      const request = (path: string, body: unknown, cookie = f.request({}).headers.get("cookie") ?? "") => new Request(`${baseURL}${path}`, {
        method: "POST", headers: { origin: baseURL, cookie, "content-type": "application/json", "x-vercel-forwarded-for": ip }, body: JSON.stringify(body),
      });
      const initial: { token: string; options: { challenge: string } } = await (await initialPasskeyOptions(f.request({}))).json();
      const key = authenticator();
      expect((await registerPasskey(f.request({ initialToken: initial.token, response: key.registration(true, initial.options.challenge) }))).status).toBe(200);
      const initialMethods = await (await loginMethods(request("/api/settings/login-methods", {}))).json();
      const email: string | null = initialMethods.methods.email;
      const initialUserEmail = (await readHostedLoginMethods(f.prisma, f.memberId)).user.email;
      const touchedCodes: HostedCredentialChange[] = [];
      try {
        await run({ ...f, email, request,
          recoveryKey: async () => {
            const challenge = await (await settingsChallenge(request("/api/settings/sensitive-action-challenge", { kind: "approval.recovery-key.rotate" }))).json();
            const authorization = { method: "passkey", token: challenge.token, assertion: key.assertion({ counter: 0, customMessage: challenge.message }) };
            const response = await rotateRecoveryKey(request("/api/settings/approval-passkeys/recovery-key", { authorization }));
            const body = await response.json();
            expect(body, `recovery key status ${response.status}`).toHaveProperty("key");
            return body.key;
          },
          authorize: async (change) => {
            const response = await credentialChallenge(request("/api/settings/login-methods/challenge", { change }));
            const challenge = await response.json();
            expect(challenge, `credential challenge status ${response.status}`).toHaveProperty("token");
            const optionsResponse = await credentialAuthenticationOptions(request("/api/settings/approval-passkeys/authenticate", { token: challenge.token, credentialChange: change }));
            const options = await optionsResponse.json();
            expect(options, `credential options status ${optionsResponse.status}`).toHaveProperty("options.challenge");
            return { method: "passkey", token: challenge.token, assertion: key.assertion({ counter: 0, challenge: options.options.challenge }) };
          },
          send: async (change) => {
            touchedCodes.push(change);
            const rateIds = [`send:contact:${change.method}:${change.value}`, `verify:contact:${change.method}:${change.value}`, `send:cooldown:${change.method}:${change.value}`]
              .map((value) => `arl_${authLookupKey("verification", "rate-limit", value)}`);
            await f.prisma.hostedAuthRecord.deleteMany({ where: { model: "verification", id: { in: rateIds } } });
            const response = await sendCredentialCode(request("/api/settings/login-methods/otp/send", { change }));
            expect(await response.json(), `send status ${response.status}`).toEqual({ ok: true });
            const code = provider.codes.get(change.value!);
            expect(code).toMatch(/^\d{6}$/u);
            return code!;
          },
        });
      } finally {
        for (const change of touchedCodes) {
          const identifier = change.method === "phone" ? change.value! : `change-email-otp-${initialUserEmail}-${change.value}`;
          await hostedAuthAdapter(f.prisma)({}).deleteMany({ model: "verification", where: [{ field: "identifier", value: identifier }] });
        }
      }
    }, initialKind);
  }

  it("adds a verified phone with bound approval and preserves existing first-party sessions", () => withCredentialMember(async (f) => {
    const otherCookie = await f.loginAgain();
    const change: HostedCredentialChange = { method: "phone", operation: "set", expectedIdentity: null, value: "+12025550171" };
    const code = await f.send(change);
    const authorization = await f.authorize(change);
    const response = await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization }));
    expect(await response.json()).toEqual({ ok: true });
    expect(await readHostedMemberIdentity(f)).toMatchObject({ phoneNumber: change.value, privyUserId: null });
    expect((await (await loginMethods(f.request("/api/settings/login-methods", {}))).json()).methods).toEqual({ email: f.email, phone: change.value, telegram: null });
    expect((await getHostedAppSessionFromRequest(f.request("/home", {}, otherCookie)))?.member.id).toBe(f.memberId);
    expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization }))).status).toBe(409);
    const prepared = await prepareHostedAuthOtpMember({ prisma: f.prisma, contact: contact("phone", change.value!) });
    expect(prepared.memberId).toBe(f.memberId);
    expect(provider.read).not.toHaveBeenCalled();
  }));

  it("creates an independently approved recovery key without revoking sessions or retaining plaintext", () => withCredentialMember(async (f) => {
    const otherCookie = await f.loginAgain();
    expect((await rotateRecoveryKey(f.request("/api/settings/approval-passkeys/recovery-key", {}))).status).toBe(400);
    expect((await rotateRecoveryKey(f.request("/api/settings/approval-passkeys/recovery-key", { authorization: null }))).status).toBe(400);
    const key = await f.recoveryKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const row = await f.prisma.hostedMemberApprovalCredentials.findUniqueOrThrow({ where: { memberId: f.memberId } });
    expect(row.recoveryHashEncrypted).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(key);
    expect((await getHostedAppSessionFromRequest(f.request("/home", {}, otherCookie)))?.member.id).toBe(f.memberId);
    expect(provider.read).not.toHaveBeenCalled();
  }));

  it("uses a saved key once to replace lost passkeys and revoke other first-party sessions", () => withCredentialMember(async (f) => {
    const otherCookie = await f.loginAgain();
    const old = await readApprovalPasskeyState({ memberId: f.memberId, prisma: f.prisma });
    const key = await f.recoveryKey();
    const result = await recoveryOptions(f.request("/api/settings/approval-passkeys/recovery/options", { key }));
    const options = await result.json();
    expect(result.status).toBe(200);
    const replacement = authenticator();
    const payload = { key, token: options.token, response: replacement.registration(true, options.options.challenge) };
    expect((await recoveryRegister(f.request("/api/settings/approval-passkeys/recovery/register", payload))).status).toBe(200);
    const current = await readApprovalPasskeyState({ memberId: f.memberId, prisma: f.prisma });
    expect(current.credentials.map((entry) => entry.id)).toEqual([replacement.credential.id]);
    expect(current.credentials[0].id).not.toBe(old.credentials[0].id);
    expect((await f.prisma.hostedMemberApprovalCredentials.findUniqueOrThrow({ where: { memberId: f.memberId } })).recoveryHashEncrypted).toBeNull();
    expect(await getHostedAppSessionFromRequest(f.request("/home", {}, otherCookie))).toBeNull();
    expect((await getHostedAppSessionFromRequest(f.request("/home", {})))?.member.id).toBe(f.memberId);
    expect((await recoveryRegister(f.request("/api/settings/approval-passkeys/recovery/register", payload))).status).toBe(403);
    const material = await (await settingsChallenge(f.request("/api/settings/sensitive-action-challenge", { kind: "approval.recovery-key.rotate" }))).json();
    const authorization = { method: "passkey", token: material.token, assertion: replacement.assertion({ counter: 0, customMessage: material.message }) };
    expect((await rotateRecoveryKey(f.request("/api/settings/approval-passkeys/recovery-key", { authorization }))).status).toBe(200);
  }));

  it("rejects a wrong key, foreign member, changed browser, and missing user verification without consuming recovery", () => withCredentialMember(async (f) => withCredentialMember(async (other) => {
    const key = await f.recoveryKey();
    expect((await recoveryOptions(f.request("/api/settings/approval-passkeys/recovery/options", { key: Buffer.alloc(32, 2).toString("base64url") }))).status).toBe(403);
    expect((await recoveryOptions(other.request("/api/settings/approval-passkeys/recovery/options", { key }))).status).toBe(403);
    const result = await (await recoveryOptions(f.request("/api/settings/approval-passkeys/recovery/options", { key }))).json();
    const replacement = authenticator();
    const payload = { key, token: result.token, response: replacement.registration(true, result.options.challenge) };
    expect((await recoveryRegister(f.request("/api/settings/approval-passkeys/recovery/register", payload, await f.loginAgain()))).status).toBe(403);
    expect((await recoveryRegister(f.request("/api/settings/approval-passkeys/recovery/register", { ...payload, response: replacement.registration(false, result.options.challenge) }))).status).toBe(403);
    expect((await recoveryRegister(f.request("/api/settings/approval-passkeys/recovery/register", payload))).status).toBe(200);
  })));

  it("invalidates a rotated key and its outstanding registration options", () => withCredentialMember(async (f) => {
    const key = await f.recoveryKey();
    const result = await (await recoveryOptions(f.request("/api/settings/approval-passkeys/recovery/options", { key }))).json();
    const newKey = await f.recoveryKey();
    expect(newKey).not.toBe(key);
    const payload = { key, token: result.token, response: authenticator().registration(true, result.options.challenge) };
    expect((await recoveryRegister(f.request("/api/settings/approval-passkeys/recovery/register", payload))).status).toBe(403);
    expect((await recoveryOptions(f.request("/api/settings/approval-passkeys/recovery/options", { key: newKey }))).status).toBe(200);
  }));

  it("admits one concurrent recovery and keeps only its new factor", () => withCredentialMember(async (f) => {
    const key = await f.recoveryKey();
    const result = await (await recoveryOptions(f.request("/api/settings/approval-passkeys/recovery/options", { key }))).json();
    const replacements = [authenticator(), authenticator()];
    const responses = await Promise.all(replacements.map((replacement) => recoveryRegister(f.request("/api/settings/approval-passkeys/recovery/register", {
      key, token: result.token, response: replacement.registration(true, result.options.challenge),
    }))));
    // A loser that reads after the winning commit rejects the consumed key
    // before reaching the transaction's credential-generation conflict.
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 403 || response.status === 409)).toHaveLength(1);
    expect((await f.prisma.hostedMemberApprovalCredentials.findUniqueOrThrow({ where: { memberId: f.memberId } })).recoveryHashEncrypted).toBeNull();
    expect((await readApprovalPasskeyState({ memberId: f.memberId, prisma: f.prisma })).credentials.map((entry) => entry.id))
      .toEqual([replacements[responses.findIndex((response) => response.status === 200)].credential.id]);
  }));

  it("rolls back recovery-key consumption, factor replacement and revocation together on storage failure", () => withCredentialMember(async (f) => {
    const otherCookie = await f.loginAgain();
    const key = await f.recoveryKey();
    const result = await (await recoveryOptions(f.request("/api/settings/approval-passkeys/recovery/options", { key }))).json();
    const payload = { key, token: result.token, response: authenticator().registration(true, result.options.challenge) };
    const before = await f.prisma.hostedMemberApprovalCredentials.findUniqueOrThrow({ where: { memberId: f.memberId } });
    if (!/^[A-Za-z0-9_-]+$/u.test(f.memberId)) throw new Error("Unsafe synthetic trigger target");
    await f.prisma.$executeRawUnsafe("CREATE FUNCTION auth_test_reject_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = TG_ARGV[0] THEN RAISE EXCEPTION 'synthetic recovery failure'; END IF; RETURN NEW; END $$");
    try {
      await f.prisma.$executeRawUnsafe(`CREATE TRIGGER auth_test_reject_recovery BEFORE UPDATE ON hosted_auth_record FOR EACH ROW WHEN (NEW.model = 'user') EXECUTE FUNCTION auth_test_reject_recovery('${f.memberId}')`);
      expect((await recoveryRegister(f.request("/api/settings/approval-passkeys/recovery/register", payload))).status).toBe(500);
      expect(await f.prisma.hostedMemberApprovalCredentials.findUniqueOrThrow({ where: { memberId: f.memberId } })).toEqual(before);
      expect((await getHostedAppSessionFromRequest(f.request("/home", {}, otherCookie)))?.member.id).toBe(f.memberId);
    } finally {
      await f.prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS auth_test_reject_recovery ON hosted_auth_record");
      await f.prisma.$executeRawUnsafe("DROP FUNCTION auth_test_reject_recovery()");
    }
    expect((await recoveryRegister(f.request("/api/settings/approval-passkeys/recovery/register", payload))).status).toBe(200);
  }));

  it.each(["stale", "silent", "suspended"] as const)("rejects %s recovery authority", (state) => withCredentialMember(async (f) => {
    const key = await f.recoveryKey();
    const session = await getHostedAppSessionFromRequest(f.request("/home", {}));
    expect(session).not.toBeNull();
    if (state === "suspended") await f.prisma.hostedMember.update({ where: { id: f.memberId }, data: { suspendedAt: new Date() } });
    else await hostedAuthAdapter(f.prisma)({ session: { additionalFields: { primaryAuthenticatedAt: { type: "date" } } } }).update({
      model: "session", where: [{ field: "id", value: session!.sessionId }], update: { primaryAuthenticatedAt: state === "silent" ? null : new Date(Date.now() - 6 * 60_000) },
    });
    expect((await recoveryOptions(f.request("/api/settings/approval-passkeys/recovery/options", { key }))).status).toBe(403);
    expect((await f.prisma.hostedMemberApprovalCredentials.findUniqueOrThrow({ where: { memberId: f.memberId } })).recoveryHashEncrypted).toBeTruthy();
  }));

  it.each([false, true])("replaces verified email atomically with existing reply alias = %s", (withAlias) => withCredentialMember(async (f) => {
    if (withAlias) await f.prisma.hostedMemberRouting.update({ where: { memberId: f.memberId }, data: { replyAliasGeneration: 4, replyAliasLookupKey: "0123456789abcdef0123456789abcdef" } });
    const otherCookie = await f.loginAgain();
    const change: HostedCredentialChange = { method: "email", operation: "set", expectedIdentity: f.email, value: `replacement-${randomUUID()}@example.test` };
    const code = await f.send(change);
    const authorization = await f.authorize(change);
    const response = await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization }));
    expect(await response.json()).toEqual({ ok: true });
    expect((await readHostedMemberEmailAuthorization(f))?.verifiedEmail?.address).toBe(change.value);
    expect((await f.prisma.hostedMemberRouting.findUniqueOrThrow({ where: { memberId: f.memberId } })).replyAliasGeneration).toBe(withAlias ? 5 : 0);
    expect(await getHostedAppSessionFromRequest(f.request("/home", {}, otherCookie))).toBeNull();
    expect((await getHostedAppSessionFromRequest(f.request("/home", {})))?.member.id).toBe(f.memberId);
    expect((await (await loginMethods(f.request("/api/settings/login-methods", {}))).json()).methods.email).toBe(change.value);
    expect((await prepareHostedAuthOtpMember({ prisma: f.prisma, contact: contact("email", change.value!) })).memberId).toBe(f.memberId);
  }));

  it("binds credential approval to the target, original identity and browser session", () => withCredentialMember(async (f) => {
    const change: HostedCredentialChange = { method: "phone", operation: "set", expectedIdentity: null, value: "+12025550172" };
    const code = await f.send(change);
    const authorization = await f.authorize(change);
    const path = "/api/settings/login-methods/otp/verify";
    expect((await verifyCredentialCode(f.request(path, { change: { ...change, value: "+12025550173" }, code, authorization }))).status).toBe(410);
    expect((await verifyCredentialCode(f.request(path, { change, code, authorization }, await f.loginAgain()))).status).toBe(410);
    expect((await verifyCredentialCode(f.request(path, { change, code, authorization }))).status).toBe(200);
  }));

  it.each(["email", "phone"] as const)("commits %s wrong-code budgets without consuming credential approval", (method) => withCredentialMember(async (f) => {
    const change: HostedCredentialChange = { method, operation: "set", expectedIdentity: method === "email" ? f.email : null,
      value: method === "email" ? `budget-${randomUUID()}@example.test` : "+12025550182" };
    const code = await f.send(change);
    const authorization = await f.authorize(change);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, authorization, code: wrong }))).status).toBe(400);
    expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, authorization, code }))).status).toBe(400);
    expect((await readHostedMemberEmailAuthorization(f))?.verifiedEmail?.address).toBe(f.email);
    if (method === "phone") {
      expect(sms.check).toHaveBeenCalledTimes(3);
      expect((await readHostedMemberIdentity(f))?.phoneNumber).toBeNull();
    }
    const resent = await f.send(change);
    expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, authorization, code: resent }))).status).toBe(200);
  }));

  it("rejects a phone approval superseded during the provider check and accepts the new generation", () => withCredentialMember(async (f) => {
    const change: HostedCredentialChange = { method: "phone", operation: "set", expectedIdentity: null, value: "+12025550183" };
    const code = await f.send(change);
    const authorization = await f.authorize(change);
    const check = sms.check.getMockImplementation()!;
    let replacementCode = "";
    sms.check.mockImplementationOnce(async (input) => {
      const approved = await check(input);
      replacementCode = await f.send(change);
      return approved;
    });
    const path = "/api/settings/login-methods/otp/verify";
    expect((await verifyCredentialCode(f.request(path, { change, authorization, code }))).status).toBe(400);
    expect((await readHostedLoginMethods(f.prisma, f.memberId)).methods.phone).toBeNull();
    expect((await verifyCredentialCode(f.request(path, { change, authorization, code: replacementCode }))).status).toBe(200);
    expect((await readHostedLoginMethods(f.prisma, f.memberId)).methods.phone).toBe(change.value);
  }));

  it("refuses to remove the last sign-in and requires existing approval", () => withCredentialMember(async (f) => {
    const change: HostedCredentialChange = { method: "email", operation: "remove", expectedIdentity: f.email, value: null };
    const response = await removeCredential(f.request("/api/settings/login-methods/remove", { change, authorization: {} }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "LINKED_ACCOUNT_LAST_SIGN_IN" } });
    const phone: HostedCredentialChange = { method: "phone", operation: "set", expectedIdentity: null, value: "+12025550174" };
    const code = await f.send(phone);
    expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change: phone, code, authorization: {} }))).status).toBe(400);
    expect((await readHostedMemberIdentity(f))?.phoneNumber).toBeNull();
  }));

  it("adds email to a phone-only account without retiring the original app session", () => withCredentialMember(async (f) => {
    expect(f.email).toBeNull();
    const otherCookie = await f.loginAgain();
    const change: HostedCredentialChange = { method: "email", operation: "set", expectedIdentity: null, value: `added-${randomUUID()}@example.test` };
    const code = await f.send(change);
    const authorization = await f.authorize(change);
    expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization }))).status).toBe(200);
    expect((await readHostedMemberEmailAuthorization(f))?.verifiedEmail?.address).toBe(change.value);
    expect((await getHostedAppSessionFromRequest(f.request("/home", {}, otherCookie)))?.member.id).toBe(f.memberId);
    expect((await readHostedLoginMethods(f.prisma, f.memberId)).methods).toEqual({ email: change.value, phone: "+12025550179", telegram: null });
  }, "phone"));

  it("removes a phone atomically and revokes other sessions while preserving the authorizing browser", () => withCredentialMember(async (f) => {
    const add: HostedCredentialChange = { method: "phone", operation: "set", expectedIdentity: null, value: "+12025550175" };
    const code = await f.send(add);
    expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change: add, code, authorization: await f.authorize(add) }))).status).toBe(200);
    const otherCookie = await f.loginAgain();
    const change: HostedCredentialChange = { method: "phone", operation: "remove", expectedIdentity: add.value, value: null };
    const authorization = await f.authorize(change);
    expect((await removeCredential(f.request("/api/settings/login-methods/remove", { change, authorization }))).status).toBe(200);
    expect((await readHostedMemberIdentity(f))?.phoneNumber).toBeNull();
    expect((await readHostedLoginMethods(f.prisma, f.memberId)).methods).toEqual({ email: f.email, phone: null, telegram: null });
    expect(await getHostedAppSessionFromRequest(f.request("/home", {}, otherCookie))).toBeNull();
    expect((await getHostedAppSessionFromRequest(f.request("/home", {})))?.member.id).toBe(f.memberId);
    expect((await removeCredential(f.request("/api/settings/login-methods/remove", { change, authorization }))).status).toBe(409);
  }));

  it.each(["email", "phone"] as const)("rolls back %s proof, canonical writes, approval and revocation on a database failure", (method) => withCredentialMember(async (f) => {
    const change: HostedCredentialChange = { method, operation: "set", expectedIdentity: method === "email" ? f.email : null,
      value: method === "email" ? `rollback-${randomUUID()}@example.test` : "+12025550176" };
    const code = await f.send(change);
    const authorization = await f.authorize(change);
    const otherCookie = await f.loginAgain();
    const before = await readHostedLoginMethods(f.prisma, f.memberId);
    // The trigger belongs to this test and names only its synthetic member.
    if (!/^[A-Za-z0-9_-]+$/u.test(f.memberId)) throw new Error("Unsafe synthetic trigger target");
    await f.prisma.$executeRawUnsafe("CREATE FUNCTION auth_test_reject_credential() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = TG_ARGV[0] THEN RAISE EXCEPTION 'synthetic credential failure'; END IF; RETURN NEW; END $$");
    try {
      await f.prisma.$executeRawUnsafe(`CREATE TRIGGER auth_test_reject_credential BEFORE UPDATE ON hosted_auth_record FOR EACH ROW WHEN (NEW.model = 'user') EXECUTE FUNCTION auth_test_reject_credential('${f.memberId}')`);
      const failed = await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization }));
      expect(failed.status).toBe(500);
      if (method === "phone") expect(sms.check).toHaveBeenCalledTimes(1);
      expect(await readHostedLoginMethods(f.prisma, f.memberId)).toEqual(before);
      expect((await readHostedMemberIdentity(f))?.phoneNumber).toBeNull();
      expect((await readHostedMemberEmailAuthorization(f))?.verifiedEmail?.address).toBe(f.email);
      expect((await getHostedAppSessionFromRequest(f.request("/home", {}, otherCookie)))?.member.id).toBe(f.memberId);
    } finally {
      await f.prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS auth_test_reject_credential ON hosted_auth_record");
      await f.prisma.$executeRawUnsafe("DROP FUNCTION auth_test_reject_credential()");
    }
    expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization }))).status).toBe(200);
    if (method === "phone") expect(sms.check).toHaveBeenCalledTimes(1);
  }));

  it("accepts one concurrent credential completion and rejects replay", () => withCredentialMember(async (f) => {
    const change: HostedCredentialChange = { method: "phone", operation: "set", expectedIdentity: null, value: "+12025550177" };
    const code = await f.send(change);
    const authorization = await f.authorize(change);
    const results = await Promise.all([0, 1].map(() => verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization }))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400 || r.status === 409)).toHaveLength(1);
    expect((await readHostedLoginMethods(f.prisma, f.memberId)).methods.phone).toBe(change.value);
    expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization }))).status).toBe(409);
  }));

  it("commits the active member's channel wake even when its best-effort runtime signal fails", () => withCredentialMember(async (f) => {
    await f.prisma.hostedMember.update({ where: { id: f.memberId }, data: { billingStatus: "active" } });
    provider.signal.mockRejectedValue(new Error("Synthetic signal outage"));
    const change: HostedCredentialChange = { method: "phone", operation: "set", expectedIdentity: null, value: "+12025550180" };
    const code = await f.send(change);
    const authorization = await f.authorize(change);
    const response = await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization }));
    expect(await response.json()).toEqual({ ok: true });
    const rows = await f.prisma.hostedMailboxItem.findMany({ where: { userId: f.memberId }, select: { id: true, kind: true }, take: 2 });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("member.channels.updated");
    const wake = await readHostedMailboxWakeByItemId({ prisma: f.prisma, mailboxItemId: rows[0].id });
    expect(wake).toMatchObject({ kind: "member.channels.updated", userId: f.memberId, memberChannels: { email: true, telegram: false } });
    expect(provider.signal).toHaveBeenCalledWith({ expectedUserId: f.memberId, mailboxItemId: rows[0].id });
  }));

  it("normalizes legacy canonical email casing before admitting a credential change", () => withCredentialMember(async (f) => {
    await f.prisma.$transaction((tx) => upsertHostedMemberEmailAuthorization({
      memberId: f.memberId, prisma: tx, verifiedEmail: { address: f.email!.toUpperCase(), verifiedAt: new Date() },
      preparedControlRoot: { domain: "control", userId: f.memberId, rootKeyId: "synthetic-root" },
    }));
    const change: HostedCredentialChange = { method: "phone", operation: "set", expectedIdentity: null, value: "+12025550181" };
    const code = await f.send(change);
    expect((await verifyCredentialCode(f.request("/api/settings/login-methods/otp/verify", { change, code, authorization: await f.authorize(change) }))).status).toBe(200);
  }));

  it("does not let contact proof or another member's approval transfer a credential", () => withCredentialMember(async (a) => withCredentialMember(async (b) => {
    const claimed: HostedCredentialChange = { method: "email", operation: "set", expectedIdentity: a.email, value: b.email };
    const response = await credentialChallenge(a.request("/api/settings/login-methods/challenge", { change: claimed }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_CONTACT_IN_USE" } });
    const change: HostedCredentialChange = { method: "phone", operation: "set", expectedIdentity: null, value: "+12025550178" };
    const code = await a.send(change);
    const authorization = await a.authorize(change);
    expect((await verifyCredentialCode(b.request("/api/settings/login-methods/otp/verify", { change, code, authorization }))).status).toBe(410);
    expect((await verifyCredentialCode(a.request("/api/settings/login-methods/otp/verify", { change, code, authorization }))).status).toBe(200);
    expect((await readHostedLoginMethods(b.prisma, b.memberId)).methods.phone).toBeNull();
  })));

  it("enrolls the first approval passkey after real OTP login and cannot use initial setup to replace it", () => withInitialPasskeyMember(async (f) => {
    const registration = await initialEnrollment(f.request);
    expect((await registerPasskey(f.request(registration))).status).toBe(200);
    expect((await readApprovalPasskeyState(f)).credentials).toHaveLength(1);
    expect((await initialPasskeyOptions(f.request({}))).status).toBe(403);
    expect((await registerPasskey(f.request(registration))).status).toBe(403);
    expect(await f.prisma.hostedSensitiveActionChallenge.count({ where: { memberId: f.memberId } })).toBe(0);
    expect(provider.read).not.toHaveBeenCalled();
  }));

  it("admits only one concurrent first-factor enrollment", () => withInitialPasskeyMember(async (f) => {
    const registrations = await Promise.all([initialEnrollment(f.request), initialEnrollment(f.request)]);
    const results = await Promise.all(registrations.map((registration) => registerPasskey(f.request(registration))));
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect((await readApprovalPasskeyState(f)).credentials).toHaveLength(1);
  }));

  it.each(["exchanged", "stale", "future"] as const)("rejects %s primary proof for initial factor setup", (kind) => withInitialPasskeyMember(async (f) => {
    const primaryAuthenticatedAt = kind === "exchanged" ? null : new Date(Date.now() + (kind === "stale" ? -6 : 6) * 60_000);
    await hostedAuthAdapter(f.prisma)({ session: { additionalFields: { primaryAuthenticatedAt: { type: "date" } } } }).update({
      model: "session", where: [{ field: "token", value: f.token }], update: { primaryAuthenticatedAt },
    });
    expect((await initialPasskeyOptions(f.request({}))).status).toBe(403);
    expect(await f.prisma.hostedMemberApprovalCredentials.count({ where: { memberId: f.memberId } })).toBe(0);
  }));

  it("rejects initial setup for a fresh login once a legacy identity is bound", () => withInitialPasskeyMember(async (f) => {
    const registration = await initialEnrollment(f.request);
    await f.prisma.$transaction((tx) => upsertHostedMemberIdentity({
      maskedPhoneNumberHint: null, phoneLookupKey: null, phoneNumber: null, memberId: f.memberId,
      privyUserId: `did:privy:${f.memberId}`, phoneNumberVerifiedAt: null,
      signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null, signupPhoneNumber: null,
      preparedControlRoot: { domain: "control", userId: f.memberId, rootKeyId: "synthetic-root" }, prisma: tx,
    }));
    expect((await initialPasskeyOptions(f.request({}))).status).toBe(403);
    expect((await registerPasskey(f.request(registration))).status).toBe(403);
    expect(await f.prisma.hostedMemberApprovalCredentials.count({ where: { memberId: f.memberId } })).toBe(0);
    expect(provider.read).not.toHaveBeenCalled();
  }));

  it("selects legacy factor restoration only for the canonical session identity", () => withInitialPasskeyMember(async (f) => {
    const { token } = await (await initialPasskeyOptions(f.request({}))).json();
    expect((await credentialAuthenticationOptions(f.request({ token }))).status).toBe(403);
    const expectedUserId = `did:privy:${f.memberId}`;
    await f.prisma.$transaction((tx) => upsertHostedMemberIdentity({
      maskedPhoneNumberHint: null, phoneLookupKey: null, phoneNumber: null, memberId: f.memberId,
      privyUserId: expectedUserId, phoneNumberVerifiedAt: null,
      signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null, signupPhoneNumber: null,
      preparedControlRoot: { domain: "control", userId: f.memberId, rootKeyId: "synthetic-root" }, prisma: tx,
    }));
    const response = await credentialAuthenticationOptions(f.request({ token, privyUserId: "did:privy:synthetic-other-member" }));
    expect(await response.json()).toEqual({ method: "wallet", privyUserId: expectedUserId });
    expect(await f.prisma.hostedMemberApprovalCredentials.count({ where: { memberId: f.memberId } })).toBe(0);
    expect(provider.read).not.toHaveBeenCalled();
  }));

  it("binds initial registration to the original session and rechecks revocation", () => withInitialPasskeyMember(async (f) => {
    const registration = await initialEnrollment(f.request);
    const secondCookie = await f.loginAgain();
    expect((await registerPasskey(f.request(registration, secondCookie))).status).toBe(403);
    expect((await logoutBrowser(f.request({}))).status).toBe(200);
    expect((await registerPasskey(f.request(registration))).status).toBe(401);
    expect(await f.prisma.hostedMemberApprovalCredentials.count({ where: { memberId: f.memberId } })).toBe(0);
  }));

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
        expect(Object.keys(result).sort()).toEqual(["expiresAt", "memberId", "ok", "token"]);
        expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
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
      await sendHostedAuthOtp({ ...configuration(), contact: selected, delivery: { email: deliver }, smsVerification: {
        ...sms, send: async (input) => {
          const sid = await sms.send(input);
          await deliver({ code: provider.codes.get(value)! });
          return sid;
        },
      } });
      expect(deliveredAfterCommit).toBe(true);
      if (kind === "phone" || old.code !== code) await expect(commitHostedAuthOtp({ ...configuration(), ...prepared, otp: old })).rejects.toThrow();
      const otp: HostedAuthOtp = kind === "email" ? { kind, address: value, code } : { kind, phoneNumber: value, code,
        verificationId: await prepareHostedAuthSmsOtp({ prisma, phoneNumber: value, code, verification: sms }) };
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

  it.each(["credential removal", "passkey recovery"])("keeps imported native sessions on an addition, then fences old authority on %s", (operation) => legacyFixture(async (memberId, phone) => {
    const prisma = getPrisma(); const baseURL = "https://www.withmurph.ai";
    const secret = Buffer.alloc(32, 29).toString("base64url");
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", secret); vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", baseURL);
    const legacy = await issueHostedAppSession({ memberId, privyUserId: `did:privy:${memberId}` });
    const prepared = await prepareHostedAuthOtpMember({ prisma, contact: contact("phone", phone) });
    const issued = await commitHostedAuthOtp({ baseURL, secret, prisma, ...prepared, otp: await send("phone", phone) });
    const cookie = issued.headers.getSetCookie().find((value) => value.startsWith("murph-auth-session="))!.split(";")[0];
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "true"); vi.stubEnv("VERCEL", "1");
    const ip = `2001:db8::${randomUUID().slice(0, 4)}`;
    const request = (path: string, body: unknown) => new Request(`${baseURL}${path}`, { method: "POST", body: JSON.stringify(body), headers: {
      origin: baseURL, cookie, "content-type": "application/json", "x-vercel-forwarded-for": ip,
    } });
    const key = authenticator();
    // Represent a factor already migrated by the separately tested enrollment
    // owner; this journey starts with an established approval credential.
    const credential = await prepareApprovalPasskeyWrite({ prisma, credentials: [key.credential], state: await readApprovalPasskeyState({ memberId, prisma }) });
    await prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, memberId);
      await commitApprovalPasskeyWriteTx({ prepared: credential, prisma: tx });
    });
    const approve = async (change: HostedCredentialChange) => {
      const challenge = await (await credentialChallenge(request("/api/settings/login-methods/challenge", { change }))).json();
      return { method: "passkey", token: challenge.token, assertion: key.assertion({ counter: 0, customMessage: challenge.message }) };
    };
    const legacyRequest = new Request(`${baseURL}/api/device-sync/companion/bootstrap`, { headers: { authorization: `Bearer ${identityToken(memberId)}` } });
    const oldBrowser = new Request(`${baseURL}/home`, { headers: { cookie: legacy.cookie.split(";")[0] } });
    const change: HostedCredentialChange = { method: "email", operation: "set", expectedIdentity: null, value: `legacy-add-${randomUUID()}@example.test` };
    expect((await sendCredentialCode(request("/api/settings/login-methods/otp/send", { change }))).status).toBe(200);
    expect((await verifyCredentialCode(request("/api/settings/login-methods/otp/verify", { change, code: provider.codes.get(change.value!), authorization: await approve(change) }))).status).toBe(200);
    expect((await readHostedLoginMethods(prisma, memberId)).user.credentialsChangedAt).toBeNull();
    expect((await readHostedNativeMemberAuth(legacyRequest, prisma)).member.id).toBe(memberId);
    expect((await getHostedAppSessionFromRequest(oldBrowser))?.member.id).toBe(memberId);
    const removal: HostedCredentialChange = { method: "phone", operation: "remove", expectedIdentity: phone, value: null };
    if (operation === "credential removal") {
      expect((await removeCredential(request("/api/settings/login-methods/remove", { change: removal, authorization: await approve(removal) }))).status).toBe(200);
    } else {
      vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "true");
      const challenge = await (await settingsChallenge(request("/api/settings/sensitive-action-challenge", { kind: "approval.recovery-key.rotate" }))).json();
      const authorization = { method: "passkey", token: challenge.token, assertion: key.assertion({ counter: 0, customMessage: challenge.message }) };
      const recovery = await (await rotateRecoveryKey(request("/api/settings/approval-passkeys/recovery-key", { authorization }))).json();
      expect(recovery).toHaveProperty("key");
      expect((await readHostedNativeMemberAuth(legacyRequest, prisma)).member.id).toBe(memberId);
      const options = await (await recoveryOptions(request("/api/settings/approval-passkeys/recovery/options", { key: recovery.key }))).json();
      expect((await recoveryRegister(request("/api/settings/approval-passkeys/recovery/register", { key: recovery.key, token: options.token, response: authenticator().registration(true, options.options.challenge) }))).status).toBe(200);
      expect((await removeCredential(request("/api/settings/login-methods/remove", { change: removal, authorization: await approve(removal) }))).status).toBe(403);
    }
    expect((await readHostedLoginMethods(prisma, memberId)).user.credentialsChangedAt).toBeInstanceOf(Date);
    await expect(readHostedNativeMemberAuth(legacyRequest, prisma)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(await getHostedAppSessionFromRequest(oldBrowser)).toBeNull();
    expect((await getHostedAppSessionFromRequest(request("/home", {})))?.member.id).toBe(memberId);
    expect(await importHostedAuthMember({ prisma, memberId })).toBe("already_owned");
    expect((await readHostedLoginMethods(prisma, memberId)).methods.phone).toBe(operation === "credential removal" ? null : phone);
    expect(provider.read).toHaveBeenCalledTimes(1);
  }));

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
    const beforeRenewal = await prisma.hostedWebSession.findUniqueOrThrow({ where: { id: legacy.sessionId } });
    const legacyRenewal = await renewBrowser(new Request("http://localhost:3000/api/auth/session", {
      method: "POST", headers: { cookie: oldCookie, origin: "http://localhost:3000" },
    }));
    expect(legacyRenewal.status).toBe(200);
    expect(legacyRenewal.headers.getSetCookie()).toEqual([]);
    expect(await prisma.hostedWebSession.findUniqueOrThrow({ where: { id: legacy.sessionId } })).toEqual(beforeRenewal);
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
