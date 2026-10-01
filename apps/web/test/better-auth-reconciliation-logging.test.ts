import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only storage, provider, crypto and lock boundaries are synthetic. The four
// reconciliation owners and both composed HTTP error owners execute unchanged.
const ports = vi.hoisted(() => ({
  core: vi.fn(), identity: vi.fn(), email: vi.fn(), routing: vi.fn(),
  lookupEmail: vi.fn(), lookupPhone: vi.fn(), lookupTelegram: vi.fn(),
  provider: vi.fn(), invite: vi.fn(), open: vi.fn(), root: vi.fn(),
  revalidateRoot: vi.fn(), memberLock: vi.fn(), contactLock: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@prisma/client", () => ({
  HostedBillingStatus: { not_started: "not_started", active: "active" },
  Prisma: { PrismaClientKnownRequestError: class extends Error {}, PrismaClientInitializationError: class extends Error {} },
}));
vi.mock("../src/lib/hosted-crypto/domain-root-store", () => ({
  prepareHostedDomainRootForWeb: ports.root, revalidatePreparedHostedDomainRootForWebTx: ports.revalidateRoot,
}));
vi.mock("../src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: ports.core, readHostedMemberEmailAuthorization: ports.email,
  lookupHostedMemberByVerifiedEmailAddress: ports.lookupEmail,
}));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: ports.identity, lookupHostedMemberIdentityByPhoneNumber: ports.lookupPhone,
}));
vi.mock("../src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: ports.routing, lookupHostedMemberRoutingByTelegramUserId: ports.lookupTelegram,
}));
vi.mock("../src/lib/hosted-onboarding/member-identity-service", () => ({ assertHostedPrivyAccountDeletionNotPending: async () => {} }));
vi.mock("../src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyUserById: ports.provider, resolveHostedPrivyIdentityFromVerifiedUser: (user: unknown) => user,
}));
vi.mock("../src/lib/hosted-onboarding/invite-service", () => ({ requireHostedInviteForAuthentication: ports.invite }));
vi.mock("../src/lib/hosted-onboarding/shared", () => ({ lockHostedMemberRow: ports.memberLock }));
vi.mock("../src/lib/hosted-onboarding/linq-participant-contact", () => ({
  acquireHostedLinqParticipantContactLockTx: ports.contactLock,
  createHostedLinqParticipantContact: (contact: { kind: string; value: string }) => ({ ...contact, lookupKey: "synthetic-contact-index" }),
  createHostedLinqParticipantContactLookupKeyReadCandidates: () => ["synthetic-contact-index"],
}));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", async () => import("../src/lib/hosted-onboarding/contact-normalization"));
vi.mock("../src/lib/hosted-onboarding/billing-plans", () => ({ HOSTED_STANDARD_CHECKOUT_OFFER: "standard" }));
vi.mock("../src/lib/better-auth/record-crypto", () => ({
  authLookupKey: () => "synthetic-auth-index", openAuthRecord: ports.open,
}));

import { HostedAuthMigrationConflictError, prepareHostedAuthImport } from "../src/lib/better-auth/migration-source";
import { revalidateHostedAuthImportTx } from "../src/lib/better-auth/import";
import { prepareHostedAuthOtpMember } from "../src/lib/better-auth/member";
import { prepareHostedAuthTelegramMember } from "../src/lib/better-auth/telegram-member";
import { HostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "../src/lib/hosted-onboarding/http";

const memberId = "synthetic-member";
const contact = { kind: "email" as const, value: "synthetic-member@example.test", lookupKey: "synthetic-contact-index" };
const member = { id: memberId, suspendedAt: null, billingStatus: "not_started" };
const user = { id: memberId, email: contact.value, emailVerified: true };
const userRow = { id: memberId, model: "user", payloadEncrypted: "synthetic-credential-ciphertext" };
const provider = { userId: "did:privy:synthetic-member", email: { address: contact.value, verifiedAt: new Date(0) } };
const message = "Authentication identity needs reconciliation before migration.";
const code = "AUTH_IDENTITY_RECONCILIATION_REQUIRED";
const body = JSON.stringify({ error: { code, message, retryable: false } });
const db = {
  hostedAuthRecord: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  hostedMemberIdentity: { findUnique: vi.fn() },
  hostedMemberEmailAuthorization: { findUnique: vi.fn() },
  hostedMemberRouting: { findUnique: vi.fn(), findMany: vi.fn() },
};
// The exercised owners use only these explicit synthetic database methods.
const prisma = db as never;
const logs = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), log: vi.fn() };
const expectedLog = {
  errorType: "HostedAuthMigrationConflictError", errorMessage: message, errorCode: code,
  internalMessage: "Hosted onboarding route failed unexpectedly.", requestMethod: "POST",
  errorResponseCode: code, errorResponseStatus: 409, errorResponseRetryable: false,
};
const request = () => new Request("https://synthetic.example.test/api/auth/otp/verify?private=synthetic-query", {
  method: "POST", headers: { authorization: "Bearer synthetic-token", cookie: "synthetic-cookie" },
  body: JSON.stringify({ value: contact.value, code: "654321", private: "synthetic-body" }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  for (const level of ["warn", "error", "info", "log"] as const) vi.spyOn(console, level).mockImplementation(logs[level]);
  ports.core.mockResolvedValue(member);
  ports.identity.mockResolvedValue({ privyUserId: provider.userId, phoneNumber: null, phoneNumberVerifiedAt: null });
  ports.email.mockResolvedValue({ verifiedEmail: { address: contact.value } });
  ports.routing.mockResolvedValue(null);
  ports.lookupEmail.mockResolvedValue(null);
  ports.lookupPhone.mockResolvedValue(null);
  ports.lookupTelegram.mockResolvedValue(null);
  ports.provider.mockResolvedValue(provider);
  ports.open.mockResolvedValue(user);
  ports.root.mockResolvedValue({ domain: "control", userId: memberId, rootKeyId: "synthetic-root" });
  db.hostedAuthRecord.findFirst.mockResolvedValue(null);
  db.hostedAuthRecord.findUnique.mockResolvedValue(null);
  db.hostedMemberIdentity.findUnique.mockResolvedValue({ privyUserIdEncrypted: "synthetic-identity-ciphertext" });
  db.hostedMemberEmailAuthorization.findUnique.mockResolvedValue({ verifiedEmailAddressEncrypted: "synthetic-email-ciphertext" });
  db.hostedMemberRouting.findUnique.mockResolvedValue(null);
  db.hostedMemberRouting.findMany.mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function expectConflict(run: () => Promise<unknown>, reason?: string, errorType = "HostedAuthMigrationConflictError") {
  let failure: unknown;
  const response = await withJsonError<[Request]>(async () => {
    try { await run(); return jsonOk({ ok: true }); }
    catch (error) {
      failure = error;
      if (error instanceof Error) Object.assign(error, {
        identity: contact.value, providerPayload: "synthetic-private-provider-body", credential: "synthetic-private-credential",
      });
      throw error;
    }
  })(request());
  expect(failure).toBeInstanceOf(HostedOnboardingError);
  expect(failure).toMatchObject({ code, message, retryable: false });
  expect(failure).toHaveProperty("details", undefined);
  if (reason && failure instanceof Error) expect(failure.stack).not.toContain(reason);
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await response.text()).toBe(body);
  expect(logs.warn).toHaveBeenCalledTimes(1);
  expect(logs.error).not.toHaveBeenCalled();
  expect(logs.info).not.toHaveBeenCalled();
  expect(logs.log).not.toHaveBeenCalled();
  expect(db.hostedAuthRecord.create).not.toHaveBeenCalled();
  expect(JSON.stringify(logs.warn.mock.calls)).not.toMatch(/synthetic-|example\.test|654321|ciphertext/);
  // Keep the observation assertion last: on the base, all public response,
  // privacy and event-count assertions pass before the missing reason fails.
  expect(logs.warn.mock.calls[0]).toEqual(["Hosted onboarding route failed.", {
    ...expectedLog, errorType, ...(reason ? { authIdentityReconciliationReason: reason } : {}),
  }]);
}

const prepareImport = () => prepareHostedAuthImport({ memberId, prisma });
const prepareOtp = (inviteCode?: string) => prepareHostedAuthOtpMember({ contact, prisma, inviteCode });

describe("authentication reconciliation guard-to-route diagnostics", () => {
  it("identifies a missing import member without changing the mapped response or log volume", async () => {
    ports.core.mockResolvedValue(null);
    await expectConflict(prepareImport, "member_missing");
    expect(ports.provider).not.toHaveBeenCalled();
  });

  it("distinguishes provider/canonical disagreement from a changed source snapshot", async () => {
    ports.provider.mockResolvedValue({ ...provider, email: { ...provider.email, address: "synthetic-other@example.test" } });
    await expectConflict(prepareImport, "provider_binding_mismatch");
    expect(ports.provider).toHaveBeenCalledTimes(1);
    expect(ports.root).not.toHaveBeenCalled();
  });

  it("identifies an empty verified credential set", async () => {
    ports.email.mockResolvedValue(null);
    ports.provider.mockResolvedValue({ ...provider, email: null });
    await expectConflict(prepareImport, "verified_credential_missing");
    expect(db.hostedMemberIdentity.findUnique).toHaveBeenCalledTimes(1);
  });

  it("identifies the source snapshot guard after matching provider evidence", async () => {
    db.hostedMemberIdentity.findUnique.mockResolvedValueOnce({ privyUserIdEncrypted: "synthetic-before" }).mockResolvedValue({ privyUserIdEncrypted: "synthetic-after" });
    await expectConflict(prepareImport, "source_snapshot_changed");
    expect(db.hostedMemberIdentity.findUnique).toHaveBeenCalledTimes(2);
    expect(ports.provider).toHaveBeenCalledTimes(1);
    expect(ports.root).not.toHaveBeenCalled();
  });

  it("identifies a credential removed from an already owned OTP member", async () => {
    ports.lookupEmail.mockResolvedValue({ core: member });
    db.hostedAuthRecord.findUnique.mockResolvedValue(userRow);
    await expectConflict(() => prepareOtp(), "credential_not_in_projection");
    expect(ports.provider).not.toHaveBeenCalled();
  });

  it("identifies an invitation bound to another member", async () => {
    db.hostedAuthRecord.findFirst.mockResolvedValue(userRow);
    ports.invite.mockResolvedValue({ member: { id: "synthetic-other-member" } });
    await expectConflict(() => prepareOtp("synthetic-invite"), "invite_member_mismatch");
  });

  it("revalidates the actual source snapshot under the import commit lock", async () => {
    const prepared = await prepareImport();
    if (prepared.kind !== "prepared") throw new Error("Synthetic import was not prepared.");
    db.hostedMemberIdentity.findUnique.mockResolvedValue({ privyUserIdEncrypted: "synthetic-changed-ciphertext" });
    await expectConflict(() => revalidateHostedAuthImportTx(prisma, prepared), "source_snapshot_changed");
    expect(ports.memberLock).toHaveBeenCalledTimes(1);
    expect(ports.revalidateRoot).not.toHaveBeenCalled();
  });

  it("identifies a login projection changed after OTP preparation", async () => {
    db.hostedAuthRecord.findFirst.mockResolvedValue(userRow);
    const prepared = await prepareOtp();
    db.hostedAuthRecord.findUnique.mockResolvedValue({ ...userRow, payloadEncrypted: "synthetic-replaced-credential" });
    await expectConflict(() => prepared.commitMember(prisma), "prepared_state_changed");
    expect(ports.contactLock).toHaveBeenCalledTimes(1);
    expect(ports.memberLock).toHaveBeenCalledTimes(1);
    expect(ports.revalidateRoot).not.toHaveBeenCalled();
  });

  it("identifies a Telegram account binding mismatch", async () => {
    db.hostedAuthRecord.findFirst.mockResolvedValue({ id: "synthetic-account", model: "account" });
    ports.open.mockResolvedValue({ userId: memberId, accountId: "synthetic-other-telegram" });
    await expectConflict(() => prepareHostedAuthTelegramMember({ prisma, telegramUserId: "42117" }), "credential_binding_mismatch");
  });

  it("does not restore a removed Telegram credential from canonical routing", async () => {
    ports.lookupTelegram.mockResolvedValue({ core: member });
    ports.routing.mockResolvedValue({ telegramUserId: "42117" });
    db.hostedAuthRecord.findUnique.mockResolvedValue(userRow);
    await expectConflict(() => prepareHostedAuthTelegramMember({ prisma, telegramUserId: "42117" }), "credential_not_in_projection");
    expect(ports.provider).not.toHaveBeenCalled();
  });

  it("keeps successful owned OTP preparation and commit silent", async () => {
    db.hostedAuthRecord.findFirst.mockResolvedValue(userRow);
    db.hostedAuthRecord.findUnique.mockResolvedValue(userRow);
    const response = await withJsonError<[Request]>(async () => {
      const prepared = await prepareOtp();
      await prepared.commitMember(prisma);
      return jsonOk({ ok: true });
    })(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(ports.revalidateRoot).toHaveBeenCalledTimes(1);
    for (const logger of Object.values(logs)) expect(logger).not.toHaveBeenCalled();
    expect(ports.provider).not.toHaveBeenCalled();
  });

  const unsafeReasons: unknown[] = [
    undefined, null, "unknown_future_reason", "member_missing synthetic-member@example.test",
    "provider_binding_mismatch\nsynthetic-private-credential", 42, true, ["member_missing"],
    { reason: "member_missing", credential: "synthetic-private-credential" }, { toString: () => "member_missing" },
  ];
  it.each(unsafeReasons.map((value) => ({ value })))("omits absent, unknown or unsafe diagnostic value $value", async ({ value }) => {
    const error = new HostedAuthMigrationConflictError();
    Object.defineProperty(error, "reconciliationReason", { value });
    await expectConflict(async () => { throw error; });
  });

  it("ignores a diagnostic getter without evaluating it", async () => {
    const error = new HostedAuthMigrationConflictError();
    const getter = vi.fn(() => { throw new Error("synthetic-private-credential"); });
    Object.defineProperty(error, "reconciliationReason", { get: getter });
    await expectConflict(async () => { throw error; });
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not trust a matching name/code/reason on another domain error class", async () => {
    const error = new HostedOnboardingError({ code, message, httpStatus: 409 });
    error.name = "HostedAuthMigrationConflictError";
    Object.defineProperty(error, "reconciliationReason", { value: "member_missing" });
    await expectConflict(async () => { throw error; }, undefined, "HostedOnboardingError");
  });
});
