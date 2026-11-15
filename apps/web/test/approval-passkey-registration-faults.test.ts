import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { SimpleWebAuthnError, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedAppSession } from "@/src/lib/hosted-onboarding/app-session";

const m = vi.hoisted(() => ({ register: vi.fn(), prepareWrite: vi.fn(), readState: vi.fn(), decrypt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-web/public-url", () => ({ resolveHostedPublicOrigin: () => "https://www.withmurph.ai" }));
vi.mock("@/src/lib/better-auth/bound-reauthentication", () => ({
  prepareHostedBoundLogin: async () => ({ fingerprint: "synthetic-fingerprint", current: { user: { credentialsChangedAt: null } } }),
}));
vi.mock("@/src/lib/better-auth/session-limit", () => ({ prepareHostedAuthSessionSet: async () => ({}) }));
vi.mock("@/src/lib/hosted-web/encryption", () => ({ decryptHostedWebNullableString: m.decrypt, encryptHostedWebNullableString: vi.fn() }));
vi.mock("@/src/lib/sensitive-actions/passkey-store", () => ({ prepareApprovalPasskeyWrite: m.prepareWrite, readApprovalPasskeyState: m.readState }));
vi.mock("@/src/lib/sensitive-actions/webauthn", async (original) => ({
  ...await original<typeof import("@/src/lib/sensitive-actions/webauthn")>(), verifyApprovalPasskeyRegistration: m.register,
}));

import { INITIAL_APPROVAL_ENROLLMENT_KIND, registerInitialApprovalEnrollment } from "@/src/lib/sensitive-actions/initial-passkey-enrollment";
import { recoverApprovalPasskey } from "@/src/lib/sensitive-actions/passkey-recovery";

const memberId = "member_synthetic";
const sessionId = "session_synthetic";
const token = `sac_${randomBytes(24).toString("base64url")}`;
const recoveryKey = randomBytes(32).toString("base64url");
const response = { id: "credential_synthetic" } as RegistrationResponseJSON;
const configFault = () => new SimpleWebAuthnError({ code: "BAD_ARGUMENT", message: "Synthetic expected origin fault." });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function session(): HostedAppSession {
  return {
    authProof: { kind: "synthetic" }, expiresAt: new Date(Date.now() + 60_000), member: { id: memberId },
    primaryAuthenticatedAt: new Date(), sessionId,
  } as unknown as HostedAppSession;
}

function prismaWith(challenge: { bindingHash: string; kind: string }) {
  return {
    hostedAuthRecord: { findUnique: async () => ({ memberId }) },
    hostedMemberApprovalCredentials: { findUnique: async () => challenge.kind === INITIAL_APPROVAL_ENROLLMENT_KIND
      ? null : { credentialsEncrypted: "synthetic-credentials", recoveryHashEncrypted: "synthetic-recovery" } },
    hostedSensitiveActionChallenge: { findUnique: async () => ({
      ...challenge, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), memberId, tokenHash: digest(token),
    }) },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "true");
  vi.stubEnv("HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED", "true");
  m.readState.mockResolvedValue({ credentials: [], encrypted: "synthetic-credentials", memberId });
  m.decrypt.mockResolvedValue(digest(recoveryKey));
});

describe("approval passkey registration failures", () => {
  function registerInitial() {
    const current = session();
    const bindingHash = digest(JSON.stringify([
      "murph-initial-approval-enrollment-v1", memberId, sessionId, current.primaryAuthenticatedAt!.toISOString(), "synthetic-fingerprint",
    ]));
    return registerInitialApprovalEnrollment({
      prisma: prismaWith({ bindingHash, kind: INITIAL_APPROVAL_ENROLLMENT_KIND }),
      request: new Request("https://www.withmurph.ai/api/settings/approval-passkeys/register"), response, session: current, token,
    });
  }

  function recover() {
    return recoverApprovalPasskey({
      key: recoveryKey,
      prisma: prismaWith({ bindingHash: digest(JSON.stringify(["murph-approval-recovery-v1", memberId, sessionId, "synthetic-recovery"])), kind: "approval.passkey.recover" }),
      request: new Request("https://www.withmurph.ai/api/settings/approval-passkeys/recovery"), response, session: session(), token,
    });
  }

  it("keeps a rejected first passkey a 403 and lets a verifier configuration fault through", async () => {
    m.register.mockRejectedValueOnce(new Error("Passkey registration could not be verified."));
    await expect(registerInitial()).rejects.toMatchObject({ code: "SENSITIVE_ACTION_REGISTRATION_INVALID", httpStatus: 403 });
    m.register.mockRejectedValueOnce(configFault());
    await expect(registerInitial()).rejects.toMatchObject({ name: "SimpleWebAuthnError", code: "BAD_ARGUMENT" });
    expect(m.register).toHaveBeenCalledTimes(2);
    expect(m.prepareWrite).not.toHaveBeenCalled();
  });

  it("keeps a rejected recovery passkey a 403 and lets a verifier configuration fault through", async () => {
    m.register.mockRejectedValueOnce(new Error("Passkey registration could not be verified."));
    await expect(recover()).rejects.toMatchObject({ code: "APPROVAL_RECOVERY_INVALID", httpStatus: 403 });
    m.register.mockRejectedValueOnce(configFault());
    await expect(recover()).rejects.toMatchObject({ name: "SimpleWebAuthnError", code: "BAD_ARGUMENT" });
    expect(m.register).toHaveBeenCalledTimes(2);
    expect(m.prepareWrite).not.toHaveBeenCalled();
  });
});
