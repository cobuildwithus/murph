import { beforeEach, expect, it, vi } from "vitest";

const edge = vi.hoisted(() => ({ prisma: vi.fn(), usage: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: edge.prisma }));
vi.mock("@/src/lib/hosted-execution/usage-allowance", async original => ({
  ...await original<typeof import("@/src/lib/hosted-execution/usage-allowance")>(), readHostedAiUsageGate: edge.usage,
}));
import { createHostedPhoneCall } from "@/src/lib/phone-calls/service";

const db = {
  $queryRaw: vi.fn(), $transaction: vi.fn(),
  hostedMember: { findUnique: vi.fn() },
  hostedPhoneCall: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
};
const start = vi.fn();
const input: Parameters<typeof createHostedPhoneCall>[0] = {
  memberId: "member_lapsed_fixture", originSessionId: "synthetic-session", requestKey: "synthetic-request",
  resultNotificationChannel: "linq",
  transferNumberResolver: async () => null,
  brief: { allowTransferToUser: false, goal: "Confirm opening hours.", instructions: [], shareableFacts: {},
    successCriteria: "Opening hours confirmed.", timeZone: "UTC", to: { label: "Shop", phoneNumber: "+12125550123" } },
  crypto: { encryptBrief: async () => "synthetic-ciphertext", decryptBrief: async () => input.brief,
    encryptResult: async () => { throw new Error("Unexpected result encryption"); },
    decryptResult: async () => { throw new Error("Unexpected result decryption"); } },
  notificationDestinationResolver: async () => ({ conversationShape: "direct-member", externalThreadRouteAuthority: null,
    route: { actorId: null, channel: "linq", identityId: "synthetic-line", threadId: "synthetic-thread",
      threadIsDirect: true, delivery: { kind: "thread", target: "synthetic-thread" } } }),
  runtime: { start, resolveProviderCall: vi.fn(), stopIfActive: vi.fn(), resolveTerminalUsage: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
  edge.prisma.mockReturnValue(db);
  db.$queryRaw.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
  db.hostedMember.findUnique.mockResolvedValue({ billingStatus: "canceled", suspendedAt: null, threadContainer: null, accountGroupMemberships: [] });
  db.hostedPhoneCall.findUnique.mockResolvedValue(null);
  db.hostedPhoneCall.findFirst.mockResolvedValue(null);
});

it.each(["hosted_access_inactive", "ai_usage_limit_exceeded"])("denies %s at the real reservation before persistence and provider start", async reason => {
  edge.usage.mockResolvedValue({ allowed: false, reason });
  await expect(createHostedPhoneCall(input)).rejects.toMatchObject({ code: "HOSTED_PHONE_CALL_USAGE_REQUIRED", httpStatus: 403 });
  expect(edge.usage).toHaveBeenCalledExactlyOnceWith({ memberId: input.memberId, prisma: db });
  expect(db.hostedPhoneCall.create).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
});

it("allows reservation with usage capacity without requiring paid billing", async () => {
  db.hostedMember.findUnique.mockResolvedValue({ billingStatus: "active", suspendedAt: null, threadContainer: null, accountGroupMemberships: [] });
  edge.usage.mockResolvedValue({ allowed: true });
  db.hostedPhoneCall.create.mockRejectedValue(new Error("synthetic reservation reached"));
  await expect(createHostedPhoneCall(input)).rejects.toThrow("synthetic reservation reached");
  expect(db.hostedPhoneCall.create).toHaveBeenCalledOnce();
});
