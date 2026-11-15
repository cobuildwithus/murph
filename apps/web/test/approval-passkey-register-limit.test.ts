import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ read: vi.fn(), verify: vi.fn(), register: vi.fn(), prepare: vi.fn(), consume: vi.fn(), origin: vi.fn() }));
vi.mock("@/src/lib/sensitive-actions/passkey-http", () => ({ readApprovalPasskeyRequest: m.read, parseApprovalPasskeyRegistration: (value: unknown) => value }));
vi.mock("@/src/lib/sensitive-actions/passkey-rollout", () => ({ requireApprovalPasskeyEnrollmentEnabled: () => undefined }));
vi.mock("@/src/lib/hosted-web/public-url", () => ({ resolveHostedPublicOrigin: m.origin }));
vi.mock("@/src/lib/sensitive-actions/server", async original => ({
  requireSensitiveActionOrigin: (await original<typeof import("@/src/lib/sensitive-actions/server")>()).requireSensitiveActionOrigin,
  buildSensitiveActionMessage: () => "synthetic", buildSettingsSensitiveActionBinding: () => "synthetic",
  verifySensitiveActionChallenge: m.verify, consumeSensitiveActionChallengeTx: m.consume,
}));
vi.mock("@/src/lib/sensitive-actions/shared", () => ({ parseSensitiveActionAuthorization: () => ({ token: "synthetic" }) }));
vi.mock("@/src/lib/sensitive-actions/webauthn", async original => ({ ...await original<typeof import("@/src/lib/sensitive-actions/webauthn")>(), verifyApprovalPasskeyRegistration: m.register }));
vi.mock("@/src/lib/sensitive-actions/passkey-store", () => ({ prepareApprovalPasskeyWrite: m.prepare }));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({ assertHostedAppSessionCurrentTx: async () => undefined }));
import { POST } from "../app/api/settings/approval-passkeys/register/route";

beforeEach(() => {
  vi.clearAllMocks();
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
  m.read.mockResolvedValue({ body: { authorization: {}, response: {} }, session: { member: { id: "member_synthetic" }, sessionId: "session_synthetic" }, prisma: { $transaction: async (run: (tx: unknown) => Promise<void>) => run(tx) } });
  m.register.mockResolvedValue({ id: "new_credential", publicKey: "synthetic", counter: 0 });
  m.prepare.mockResolvedValue({});
  m.origin.mockReturnValue("https://example.test");
});

it.each([7, 8])("preserves registration behavior with %i existing credentials", async count => {
  m.verify.mockResolvedValue({ passkeys: Array.from({ length: count }, (_, index) => ({ id: `credential_${index}`, publicKey: "synthetic", counter: 0 })), credentialWrite: { expectedEncrypted: "synthetic" } });
  const response = await POST(new Request("https://example.test/api/settings/approval-passkeys/register", { method: "POST" }));
  expect(response.status).toBe(count === 8 ? 409 : 200);
  if (count === 8) {
    expect(await response.json()).toEqual({ error: { code: "SENSITIVE_ACTION_PASSKEY_LIMIT", message: "This account already has eight approval passkeys.", retryable: false } });
    expect(m.prepare).not.toHaveBeenCalled();
    expect(m.consume).not.toHaveBeenCalled();
  } else expect(m.consume).toHaveBeenCalledOnce();
  expect(m.verify).toHaveBeenCalledOnce();
  expect(m.register).toHaveBeenCalledOnce();
});

it("answers a missing public origin as approval being unavailable, not as missing approval", async () => {
  m.origin.mockReturnValue(null);
  const response = await POST(new Request("https://example.test/api/settings/approval-passkeys/register", { method: "POST" }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "SENSITIVE_ACTION_UNAVAILABLE", message: "Secure approval is temporarily unavailable.", retryable: true } });
  expect(m.verify).not.toHaveBeenCalled();
  expect(m.register).not.toHaveBeenCalled();
});
