import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../src/lib/prisma";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), lookup: vi.fn(), deletion: vi.fn(), open: vi.fn(), find: vi.fn() }));
vi.mock("../src/lib/hosted-onboarding/privy", () => ({ verifyHostedPrivyIdentityToken: mocks.verify }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ lookupHostedMemberIdentityByPrivyUserId: mocks.lookup }));
vi.mock("../src/lib/hosted-onboarding/member-identity-service", () => ({ assertHostedPrivyAccountDeletionNotPending: mocks.deletion }));
vi.mock("../src/lib/better-auth/record-crypto", () => ({ openAuthRecord: mocks.open }));
import { resolveHostedLegacyNativeMember } from "../src/lib/better-auth/legacy-native";

const prisma = getPrisma();
const principal = "did:privy:synthetic-native";
const member = { id: "synthetic-member", suspendedAt: null, billingStatus: "active" };
const token = `header.${Buffer.from(JSON.stringify({ exp: 4_000_000_000 })).toString("base64url")}.signature`;
const run = () => resolveHostedLegacyNativeMember({ token, prisma });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(prisma.hostedAuthRecord, "findUnique").mockImplementation(mocks.find);
  mocks.verify.mockResolvedValue({ id: principal, linked_accounts: [{ type: "email", address: "unrelated@example.test" }] });
  mocks.lookup.mockResolvedValue({ core: member, identity: { privyUserId: principal } });
  mocks.find.mockResolvedValue(null);
  mocks.deletion.mockResolvedValue(undefined);
});

describe("credential-read-only native legacy admission", () => {
  it("uses only the verified principal and the authenticated existing binding", async () => {
    expect(await run()).toMatchObject({ member, privyUserId: principal, expiresAt: new Date(4_000_000_000_000) });
    expect(mocks.lookup).toHaveBeenCalledWith({ prisma, privyUserId: principal });
    expect(mocks.deletion).toHaveBeenCalledWith({ prisma, privyUserId: principal });
    // Provider contact claims never reach the member lookup.
  });
  it("rejects an unbound principal instead of provisioning or matching a claimed contact", async () => {
    mocks.lookup.mockResolvedValue(null);
    await expect(run()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
  it("rejects a substituted blind-index owner whose encrypted principal differs", async () => {
    mocks.lookup.mockResolvedValue({ core: member, identity: { privyUserId: "did:privy:other" } });
    await expect(run()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
  it("preserves imported-session migration until new credentials change", async () => {
    mocks.find.mockResolvedValue({ id: member.id });
    mocks.open.mockResolvedValue({ credentialsChangedAt: null });
    expect((await run()).member.id).toBe(member.id);
    mocks.open.mockResolvedValue({ credentialsChangedAt: new Date() });
    await expect(run()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
  it("rejects unverifiable, deleting, suspended and corrupt authority", async () => {
    mocks.verify.mockRejectedValueOnce(new Error("invalid provider signature"));
    await expect(run()).rejects.toThrow("invalid provider signature");
    expect(mocks.lookup).not.toHaveBeenCalled();
    mocks.deletion.mockRejectedValueOnce(new Error("deletion pending"));
    await expect(run()).rejects.toThrow("deletion pending");
    mocks.lookup.mockResolvedValueOnce({ core: { ...member, suspendedAt: new Date() }, identity: { privyUserId: principal } });
    await expect(run()).rejects.toThrow();
    mocks.find.mockResolvedValue({ id: member.id }); mocks.open.mockRejectedValue(new Error("integrity mismatch"));
    await expect(run()).rejects.toThrow("integrity mismatch");
  });
});
