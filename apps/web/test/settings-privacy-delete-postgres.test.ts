import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const deletion = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/hosted-privacy/account-data-service", async (original) => ({
  ...await original<typeof import("../src/lib/hosted-privacy/account-data-service")>(),
  deleteHostedAccountData: deletion,
}));

import { POST } from "../app/api/settings/privacy/delete/route";
import { createHostedBetterAuth } from "../src/lib/better-auth/auth";
import { hostedAuthAdapter } from "../src/lib/better-auth/adapter";
import { commitHostedAuthOtp } from "../src/lib/better-auth/otp-transaction";
import { requireHostedAppSessionFromRequest } from "../src/lib/hosted-onboarding/app-session";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { getPrisma } from "../src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.search || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("Deletion retry proof requires an isolated local test database.");
  }
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe.skipIf(!enabled)("account deletion route with real encrypted browser authentication", () => {
  it("retries a provider failure after suspension without restoring ordinary access", async () => {
    const prisma = getPrisma();
    const memberId = `deletion-proof-${randomUUID()}`;
    const email = `${memberId}@example.test`;
    const baseURL = "https://www.withmurph.ai";
    const secret = Buffer.alloc(32, 19).toString("base64url");
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 17).toString("base64url"));
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", secret);
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", baseURL);
    await prisma.hostedMember.create({ data: { id: memberId } });
    try {
      await hostedAuthAdapter(prisma)({}).create({ model: "user", forceAllowId: true, data: {
        id: memberId, email, emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date(),
      } });
      let code = "";
      const configuration = { baseURL, secret, prisma };
      const auth = createHostedBetterAuth({ ...configuration, delivery: { email: async (input) => { code = input.code; } } });
      await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
      const issued = await commitHostedAuthOtp({ ...configuration, memberId,
        otp: { kind: "email", address: email, code }, commitMember: async () => undefined });
      const cookie = (issued.headers.get("set-cookie") ?? "").split(";")[0];
      const request = () => new Request(`${baseURL}/api/settings/privacy/delete`, {
        method: "POST", headers: { cookie, origin: baseURL, "content-type": "application/json" },
        body: JSON.stringify({ confirmationPhrase: "DELETE MY ACCOUNT" }),
      });
      // The service's provider-failure test proves this suspension ordering;
      // this test composes its persisted result with the real route/auth owners.
      deletion.mockImplementationOnce(async () => {
        await prisma.hostedMember.update({ where: { id: memberId }, data: { suspendedAt: new Date() } });
        throw hostedOnboardingError({ code: "ACCOUNT_DELETION_STRIPE_SUBSCRIPTION_CANCEL_FAILED",
          httpStatus: 503, message: "Try deleting your account again." });
      }).mockImplementationOnce(async (input: { memberId: string }) => {
        expect(input.memberId).toBe(memberId);
        await prisma.hostedMember.delete({ where: { id: memberId } });
        return { memberId, deletedAt: new Date().toISOString() };
      });
      expect((await POST(request())).status).toBe(503);
      await expect(requireHostedAppSessionFromRequest(request())).rejects.toMatchObject({ code: "HOSTED_MEMBER_SUSPENDED" });
      const retried = await POST(request());
      expect(retried.status).toBe(200);
      expect(retried.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(deletion).toHaveBeenCalledTimes(2);
      expect((await POST(request())).status).toBe(401);
    } finally {
      await prisma.hostedMember.deleteMany({ where: { id: memberId } });
    }
  });
});
