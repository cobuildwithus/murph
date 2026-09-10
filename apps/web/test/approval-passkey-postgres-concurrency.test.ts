import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { issueHostedAppSession } from "./support/hosted-auth-session";
import { hostedAuthAdapter } from "../src/lib/better-auth/adapter";
import { lockHostedMemberRow } from "../src/lib/hosted-onboarding/shared";

vi.mock("server-only", () => ({}));

import { POST as authenticationOptionsRoute } from "../app/api/settings/approval-passkeys/authenticate/route";
import { getPrisma } from "@/src/lib/prisma";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { createInitialApprovalPasskeyRegistrationOptions, registerApprovalPasskey } from "@/src/lib/sensitive-actions/passkey-enrollment";
import { readApprovalPasskeyState, prepareApprovalPasskeyWrite, commitApprovalPasskeyWriteTx } from "@/src/lib/sensitive-actions/passkey-store";
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

describe.skipIf(!enabled)("approval passkey PostgreSQL commit boundary", () => {
  beforeEach(() => {
    vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "true");
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 9).toString("base64url"));
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 10).toString("base64url"));
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://www.withmurph.ai");
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
    const issued = await issueHostedAppSession({ memberId, primaryAuthenticatedAt: new Date() });
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
      const material = await createInitialApprovalPasskeyRegistrationOptions({ prisma, session });
      const key = authenticator();
      return {
        key,
        input: { authorization: undefined, initialToken: material.token, prisma, request,
          response: key.registration(true, material.options.challenge), session },
      };
    }
    return { challenge, enrollment, memberId, prisma, request, session };
  }

  it("binds options to the current browser and rejects missing cookies or another origin", () => withMember(async (f) => {
    const initial = await f.enrollment();
    await registerApprovalPasskey(initial.input);
    vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "false");
    const challenge = await f.challenge("vault.export");
    const other = await issueHostedAppSession({ memberId: f.memberId, primaryAuthenticatedAt: new Date() });
    const headers = { cookie: f.request.headers.get("cookie") ?? "", origin: "https://www.withmurph.ai" };
    async function options(customHeaders: Record<string, string>) {
      return authenticationOptionsRoute(new Request("https://www.withmurph.ai/api/settings/approval-passkeys/authenticate", {
        method: "POST", headers: { ...customHeaders, "content-type": "application/json" }, body: JSON.stringify({ token: challenge.token }),
      }));
    }
    const valid = await options(headers);
    expect(valid.status).toBe(200);
    const body: { method: string; options: { challenge: string; userVerification: string } } = await valid.json();
    expect(body).toMatchObject({ method: "passkey", options: { userVerification: "required" } });
    await expect(verifySensitiveActionChallenge({
      ...f, ...challenge,
      authorization: { method: "passkey", token: challenge.token, assertion: initial.key.assertion({ challenge: body.options.challenge }) },
    })).resolves.toMatchObject({ passkeys: [{ counter: 1 }] });
    expect((await options({ ...headers, cookie: other.cookie.split(";")[0] ?? "" })).status).toBe(410);
    expect((await options({ ...headers, cookie: "" })).status).toBe(401);
    expect((await options({ ...headers, origin: "https://untrusted.example" })).status).toBe(403);
    expect((await options({ cookie: headers.cookie })).status).toBe(403);
  }));

  it("keeps enrollment closed before compatible readers deploy", () => withMember(async (f) => {
    const enrollment = await f.enrollment();
    vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "false");
    await expect(createInitialApprovalPasskeyRegistrationOptions({ prisma: f.prisma, session: f.session })).rejects.toMatchObject({ code: "APPROVAL_PASSKEY_ENROLLMENT_UNAVAILABLE" });
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
    await expect(registerApprovalPasskey(winner.input)).rejects.toMatchObject({ code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED" });
    const challenge = await f.challenge("vault.export");
    await expect(verifySensitiveActionChallenge({
      ...f, ...challenge,
      authorization: { token: challenge.token, signature: `0x${"a".repeat(130)}` },
    })).rejects.toMatchObject({ code: "SENSITIVE_ACTION_AUTHORIZATION_REQUIRED" });
    expect(await f.prisma.hostedAuthRecord.count({ where: { model: "session", memberId: f.memberId } })).toBe(1);
  }));

  it("consumes a counterless assertion once under concurrent commits", () => withMember(async (f) => {
    const initial = await f.enrollment();
    await registerApprovalPasskey(initial.input);
    const challenge = await f.challenge("vault.export");
    const proof = await verifySensitiveActionChallenge({
      ...f, ...challenge,
      authorization: { method: "passkey", token: challenge.token, assertion: initial.key.assertion({ counter: 0, customMessage: challenge.message }) },
    });
    const outcomes = await Promise.allSettled([1, 2].map(() => consumeSensitiveActionChallenge({
      challenge: proof, prisma: f.prisma, session: { request: f.request, sessionId: f.session.sessionId, authProof: f.session.authProof },
    })));
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await f.prisma.hostedSensitiveActionChallenge.count({ where: { memberId: f.memberId } })).toBe(0);
  }));

  it("rolls back a prepared credential update when challenge consumption fails", () => withMember(async (f) => {
    const initial = await f.enrollment();
    await registerApprovalPasskey(initial.input);
    const challenge = await f.challenge("vault.export");
    const proof = await verifySensitiveActionChallenge({
      ...f, ...challenge,
      authorization: { method: "passkey", token: challenge.token, assertion: initial.key.assertion({ customMessage: challenge.message }) },
    });
    const before = await readApprovalPasskeyState(f);
    await f.prisma.hostedSensitiveActionChallenge.deleteMany({ where: { memberId: f.memberId } });
    await expect(consumeSensitiveActionChallenge({ challenge: proof, prisma: f.prisma, session: { request: f.request, sessionId: f.session.sessionId, authProof: f.session.authProof } })).rejects.toMatchObject({ code: "SENSITIVE_ACTION_UNAVAILABLE" });
    expect(await readApprovalPasskeyState(f)).toEqual(before);
  }));

  it.each(["revoked", "expired", "suspended", "deleted"])("rejects enrollment after the member/session becomes %s", (change) => withMember(async (f) => {
    const enrollment = await f.enrollment();
    if (change === "revoked") await f.prisma.hostedAuthRecord.delete({ where: { model_id: { model: "session", id: f.session.sessionId } } });
    if (change === "expired") await hostedAuthAdapter(f.prisma)({}).update({ model: "session", where: [{ field: "id", value: f.session.sessionId }], update: { expiresAt: new Date(0) } });
    if (change === "suspended") await f.prisma.hostedMember.update({ where: { id: f.memberId }, data: { suspendedAt: new Date() } });
    if (change === "deleted") await f.prisma.hostedMember.delete({ where: { id: f.memberId } });
    await expect(registerApprovalPasskey(enrollment.input)).rejects.toThrow();
    expect(await f.prisma.hostedMemberApprovalCredentials.count({ where: { memberId: f.memberId } })).toBe(0);
  }));

  it("fences stale prepared state and cascades credential removal with deletion", () => withMember(async (f) => {
    const enrollment = await f.enrollment();
    await registerApprovalPasskey(enrollment.input);
    const before = await readApprovalPasskeyState(f);
    const replacement = authenticator();
    const stale = await prepareApprovalPasskeyWrite({ state: before, credentials: [replacement.credential], prisma: f.prisma });
    const challenge = await f.challenge("vault.export");
    const proof = await verifySensitiveActionChallenge({
      ...f, ...challenge,
      authorization: { method: "passkey", token: challenge.token,
        assertion: enrollment.key.assertion({ customMessage: challenge.message }) },
    });
    await f.prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, f.memberId);
      await commitApprovalPasskeyWriteTx({ prepared: stale, prisma: tx });
    });
    await expect(consumeSensitiveActionChallenge({ challenge: { ...proof, credentialWrite: stale }, prisma: f.prisma, session: { request: f.request, sessionId: f.session.sessionId, authProof: f.session.authProof } }))
      .rejects.toMatchObject({ code: "SENSITIVE_ACTION_CREDENTIALS_CHANGED" });
    expect((await readApprovalPasskeyState(f)).credentials).toEqual([replacement.credential]);
    await f.prisma.hostedMember.delete({ where: { id: f.memberId } });
    expect(await f.prisma.hostedMemberApprovalCredentials.count({ where: { memberId: f.memberId } })).toBe(0);
  }));
});
