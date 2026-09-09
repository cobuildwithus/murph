import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

vi.mock("server-only", () => ({}));
const provider = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/privy", () => ({ readHostedPrivyUserById: provider.read }));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({ getHostedOnboardingEnvironment: () => ({ publicBaseUrl: "https://www.withmurph.ai", allowedMutationOrigins: [] }) }));
vi.mock("@/src/lib/hosted-web/public-url", () => ({ resolveHostedPublicOrigin: () => "https://www.withmurph.ai" }));

import { POST as authenticationOptionsRoute } from "../app/api/settings/approval-passkeys/authenticate/route";
import { getPrisma } from "@/src/lib/prisma";
import { issueHostedAppSession, requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { registerApprovalPasskey } from "@/src/lib/sensitive-actions/passkey-enrollment";
import { readApprovalPasskeyState, prepareApprovalPasskeyWrite } from "@/src/lib/sensitive-actions/passkey-store";
import {
  buildSettingsSensitiveActionBinding, createSensitiveActionChallenge,
  consumeSensitiveActionChallenge, verifySensitiveActionChallenge,
} from "@/src/lib/sensitive-actions/server";
import type { SettingsSensitiveActionKind } from "@/src/lib/sensitive-actions/shared";
import { authenticator } from "./approval-webauthn-fixture";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")
    || !/^\/murph_(?:dev_|test)/u.test(url.pathname)) {
    throw new Error("Approval concurrency proof requires an isolated local Murph test database.");
  }
}
const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const privyUserId = "did:privy:synthetic-approval";

describe.skipIf(!enabled)("approval passkey PostgreSQL commit boundary", () => {
  beforeEach(() => {
    vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "true");
    provider.read.mockReset();
    provider.read.mockResolvedValue({
      id: privyUserId,
      linked_accounts: [{ address: account.address, chain_type: "ethereum", connector_type: "embedded", type: "wallet", wallet_client_type: "privy", wallet_index: 0 }],
      mfa_methods: [{ type: "passkey" }],
    });
  });
  afterAll(async () => { if (enabled) await getPrisma().$disconnect(); });

  async function withMember(run: (fixture: Awaited<ReturnType<typeof createMember>>) => Promise<void>) {
    const fixture = await createMember();
    try { await run(fixture); }
    finally { await fixture.prisma.hostedMember.deleteMany({ where: { id: fixture.memberId } }); }
  }

  async function createMember() {
    const prisma = getPrisma();
    const memberId = `member_approval_test_${randomUUID()}`;
    await prisma.hostedMember.create({ data: { id: memberId } });
    const issued = await issueHostedAppSession({ memberId, privyUserId });
    const request = new Request("https://www.withmurph.ai/api/settings/approval-passkeys/register", {
      headers: { cookie: issued.cookie.split(";")[0] ?? "", origin: "https://www.withmurph.ai" },
    });
    const session = await requireHostedAppSessionFromRequest(request);
    async function challenge(kind: SettingsSensitiveActionKind = "approval.passkey.enroll") {
      const bindingHash = buildSettingsSensitiveActionBinding({ memberId, sessionId: session.sessionId, kind });
      const material = await createSensitiveActionChallenge({ bindingHash, kind, memberId, prisma });
      return { bindingHash, kind, ...material };
    }
    async function enrollment() {
      const material = await challenge();
      const key = authenticator(material.message);
      return {
        key,
        input: {
          authorization: { token: material.token, signature: await account.signMessage({ message: material.message }) },
          prisma, request, response: key.registration(), session,
        },
      };
    }
    return { challenge, enrollment, memberId, prisma, request, session };
  }

  it("binds options to the current browser and rejects missing cookies or another origin", () => withMember(async (f) => {
    const initial = await f.enrollment();
    await registerApprovalPasskey(initial.input);
    vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "false");
    const challenge = await f.challenge("vault.export");
    const other = await issueHostedAppSession({ memberId: f.memberId, privyUserId });
    const headers = { cookie: f.request.headers.get("cookie") ?? "", origin: "https://www.withmurph.ai" };
    async function options(customHeaders: Record<string, string>) {
      return authenticationOptionsRoute(new Request("https://www.withmurph.ai/api/settings/approval-passkeys/authenticate", {
        method: "POST", headers: { ...customHeaders, "content-type": "application/json" }, body: JSON.stringify({ token: challenge.token }),
      }));
    }
    const valid = await options(headers);
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({ method: "passkey", options: { userVerification: "required" } });
    expect((await options({ ...headers, cookie: other.cookie.split(";")[0] ?? "" })).status).toBe(410);
    expect((await options({ ...headers, cookie: "" })).status).toBe(401);
    expect((await options({ ...headers, origin: "https://untrusted.example" })).status).toBe(403);
    expect((await options({ cookie: headers.cookie })).status).toBe(403);
  }));

  it("keeps enrollment closed before compatible readers deploy", () => withMember(async (f) => {
    vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "false");
    const enrollment = await f.enrollment();
    await expect(registerApprovalPasskey(enrollment.input)).rejects.toMatchObject({ code: "APPROVAL_PASSKEY_ENROLLMENT_UNAVAILABLE" });
    expect(await f.prisma.hostedMemberApprovalCredentials.count({ where: { memberId: f.memberId } })).toBe(0);
  }));

  it("admits one concurrent first enrollment and permanently selects the new verifier", () => withMember(async (f) => {
    const attempts = await Promise.all([f.enrollment(), f.enrollment()]);
    const outcomes = await Promise.allSettled(attempts.map(({ input }) => registerApprovalPasskey(input)));
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const state = await readApprovalPasskeyState(f);
    expect(state.credentials).toHaveLength(1);
    const winner = attempts.find(({ key }) => key.credential.id === state.credentials[0]?.id);
    expect(winner).toBeDefined();
    if (!winner) throw new Error("Missing committed enrollment.");
    await expect(registerApprovalPasskey(winner.input)).rejects.toMatchObject({ code: "SENSITIVE_ACTION_UNAVAILABLE" });
    const challenge = await f.challenge("vault.export");
    provider.read.mockClear();
    await expect(verifySensitiveActionChallenge({
      ...f, ...challenge, privyUserId,
      authorization: { token: challenge.token, signature: await account.signMessage({ message: challenge.message }) },
    })).rejects.toMatchObject({ code: "SENSITIVE_ACTION_SETUP_REQUIRED" });
    expect(provider.read).not.toHaveBeenCalled();
    expect(await f.prisma.hostedWebSession.count({ where: { memberId: f.memberId } })).toBe(1);
  }));

  it("consumes a counterless assertion once under concurrent commits", () => withMember(async (f) => {
    const initial = await f.enrollment();
    await registerApprovalPasskey(initial.input);
    const challenge = await f.challenge("vault.export");
    const proof = await verifySensitiveActionChallenge({
      ...f, ...challenge, privyUserId,
      authorization: { method: "passkey", token: challenge.token, assertion: initial.key.assertion({ counter: 0, customMessage: challenge.message }) },
    });
    const outcomes = await Promise.allSettled([1, 2].map(() => consumeSensitiveActionChallenge({
      challenge: proof, prisma: f.prisma, session: { request: f.request, sessionId: f.session.sessionId },
    })));
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await f.prisma.hostedSensitiveActionChallenge.count({ where: { memberId: f.memberId } })).toBe(0);
  }));

  it("rolls back a prepared credential update when challenge consumption fails", () => withMember(async (f) => {
    const initial = await f.enrollment();
    await registerApprovalPasskey(initial.input);
    const challenge = await f.challenge("vault.export");
    const proof = await verifySensitiveActionChallenge({
      ...f, ...challenge, privyUserId,
      authorization: { method: "passkey", token: challenge.token, assertion: initial.key.assertion({ customMessage: challenge.message }) },
    });
    const before = await readApprovalPasskeyState(f);
    await f.prisma.hostedSensitiveActionChallenge.deleteMany({ where: { memberId: f.memberId } });
    await expect(consumeSensitiveActionChallenge({ challenge: proof, prisma: f.prisma, session: { request: f.request, sessionId: f.session.sessionId } })).rejects.toMatchObject({ code: "SENSITIVE_ACTION_UNAVAILABLE" });
    expect(await readApprovalPasskeyState(f)).toEqual(before);
  }));

  it.each(["revoked", "expired", "suspended", "deleted"])("rejects enrollment after the member/session becomes %s", (change) => withMember(async (f) => {
    const enrollment = await f.enrollment();
    if (change === "revoked") await f.prisma.hostedWebSession.update({ where: { id: f.session.sessionId }, data: { revokedAt: new Date() } });
    if (change === "expired") await f.prisma.hostedWebSession.update({ where: { id: f.session.sessionId }, data: { expiresAt: new Date(0) } });
    if (change === "suspended") await f.prisma.hostedMember.update({ where: { id: f.memberId }, data: { suspendedAt: new Date() } });
    if (change === "deleted") await f.prisma.hostedMember.delete({ where: { id: f.memberId } });
    await expect(registerApprovalPasskey(enrollment.input)).rejects.toThrow();
    expect(await f.prisma.hostedMemberApprovalCredentials.count({ where: { memberId: f.memberId } })).toBe(0);
  }));

  it("fences stale prepared state and cascades credential removal with deletion", () => withMember(async (f) => {
    const enrollment = await f.enrollment();
    const before = await readApprovalPasskeyState(f);
    const stale = await prepareApprovalPasskeyWrite({ state: before, credentials: [authenticator().credential], prisma: f.prisma });
    const challenge = await f.challenge("vault.export");
    const proof = await verifySensitiveActionChallenge({
      ...f, ...challenge, privyUserId,
      authorization: { token: challenge.token, signature: await account.signMessage({ message: challenge.message }) },
    });
    await registerApprovalPasskey(enrollment.input);
    await expect(consumeSensitiveActionChallenge({ challenge: { ...proof, credentialWrite: stale }, prisma: f.prisma, session: { request: f.request, sessionId: f.session.sessionId } }))
      .rejects.toMatchObject({ code: "SENSITIVE_ACTION_CREDENTIALS_CHANGED" });
    expect((await readApprovalPasskeyState(f)).credentials).toEqual([enrollment.key.credential]);
    await f.prisma.hostedMember.delete({ where: { id: f.memberId } });
    expect(await f.prisma.hostedMemberApprovalCredentials.count({ where: { memberId: f.memberId } })).toBe(0);
  }));
});
