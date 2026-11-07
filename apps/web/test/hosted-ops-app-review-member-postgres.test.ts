import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ activate: vi.fn(), consent: vi.fn(), prepareRoots: vi.fn() }));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (original) => ({
  ...await original<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(), prepareHostedCryptoDomainRootCandidates: mocks.prepareRoots,
  provisionActiveHostedDomainRootEnvelopeForUserOnly: async () => undefined,
}));
vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({ activateHostedMemberForPositiveSourceTx: mocks.activate }));
vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({ materializePendingHostedGroupJoinConfirmationsBestEffort: async () => undefined }));
vi.mock("@/src/lib/legal/consent", async (original) => ({ ...await original<typeof import("@/src/lib/legal/consent")>(),
  recordHostedLaunchRequiredConsent: mocks.consent,
  readHostedConsentStatus: async () => ({ launchScopes: [{ scope: "launch.legal", granted: true }, { scope: "launch.health-data", granted: true }] }),
}));
import { getPrisma } from "@/src/lib/prisma";
import { upsertHostedMemberEmailAuthorization } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { buildHostedMemberPhoneIdentityFields } from "@/src/lib/hosted-onboarding/member-identity-fields";
import { upsertHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { prepareHostedOpsAppReviewMember } from "@/src/lib/hosted-ops/app-review-member";
import { issueHostedAppSession } from "./support/hosted-auth-session";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.searchParams.has("host") || !/^\/murph_(dev_|test)/u.test(url.pathname)) throw new Error("App Review proof requires an isolated local database.");
}
afterAll(async () => { if (enabled) await getPrisma().$disconnect(); });
beforeEach(() => {
  vi.resetAllMocks(); mocks.activate.mockResolvedValue({ activated: false }); mocks.prepareRoots.mockResolvedValue(new Map());
  vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 9).toString("base64url"));
  vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 10).toString("base64url"));
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://www.withmurph.ai");
});
async function withMember(run: (input: { memberId: string; email: string; phone: string; prisma: ReturnType<typeof getPrisma> }) => Promise<void>) {
  const prisma = getPrisma(), memberId = `member_review_${randomUUID()}`, email = `review-${randomUUID()}@example.test`, phone = `+1202${randomInt(1000000, 9999999)}`;
  await prisma.hostedMember.create({ data: { id: memberId } });
  try {
    await prisma.$transaction(async (tx) => {
      await upsertHostedMemberEmailAuthorization({ memberId, prisma: tx, verifiedEmail: { address: email, verifiedAt: new Date() } });
      await upsertHostedMemberIdentity({ ...buildHostedMemberPhoneIdentityFields(phone), memberId, prisma: tx, phoneNumberVerifiedAt: new Date(),
        signupPhoneCodeSendAttemptId: null, signupPhoneCodeSendAttemptStartedAt: null, signupPhoneCodeSentAt: null, signupPhoneNumber: null });
    });
    await issueHostedAppSession({ memberId });
    await run({ memberId, email, phone, prisma });
  } finally { await prisma.hostedMember.deleteMany({ where: { id: memberId } }); }
}

describe.skipIf(!enabled)("App Review canonical account PostgreSQL lookup", () => {
  it.each(["email", "phone"] as const)("resolves an existing verified %s account without issuing another session", (kind) => withMember(async (f) => {
    const sessionsBefore = await f.prisma.hostedAuthRecord.count({ where: { memberId: f.memberId, model: "session" } });
    const result = await prepareHostedOpsAppReviewMember({ mode: "apply", principal: { kind, value: f[kind] }, prisma: f.prisma });
    expect(result).toMatchObject({ action: "applied", activated: false, consentGranted: true });
    expect(mocks.activate.mock.calls[0][0].memberId).toBe(f.memberId);
    expect(await f.prisma.hostedAuthRecord.count({ where: { memberId: f.memberId, model: "session" } })).toBe(sessionsBefore);
    expect(await f.prisma.hostedMember.count({ where: { id: f.memberId } })).toBe(1);
  }));

  it.each(["auth-user-removed", "member-deleted", "phone-unverified", "suspended"] as const)("cannot prepare access after %s", (state) => withMember(async (f) => {
    if (state === "auth-user-removed") await f.prisma.hostedAuthRecord.delete({ where: { model_id: { model: "user", id: f.memberId } } });
    if (state === "member-deleted") await f.prisma.hostedMember.delete({ where: { id: f.memberId } });
    if (state === "phone-unverified") await f.prisma.hostedMemberIdentity.update({ where: { memberId: f.memberId }, data: { phoneNumberVerifiedAt: null } });
    if (state === "suspended") await f.prisma.hostedMember.update({ where: { id: f.memberId }, data: { suspendedAt: new Date() } });
    await expect(prepareHostedOpsAppReviewMember({ mode: "apply", principal: { kind: "phone", value: f.phone }, prisma: f.prisma })).rejects.toMatchObject({
      code: state === "suspended" ? "HOSTED_MEMBER_SUSPENDED" : "APP_REVIEW_SIGN_IN_REQUIRED",
    });
    expect(mocks.activate).not.toHaveBeenCalled(); expect(mocks.consent).not.toHaveBeenCalled();
  }));
});
