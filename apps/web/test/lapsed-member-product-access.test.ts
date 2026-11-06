import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const edge = vi.hoisted(() => ({
  auth: vi.fn(), current: vi.fn(), prisma: vi.fn(), consent: vi.fn(), enroll: vi.fn(),
  welcome: vi.fn(), wake: vi.fn(), completion: vi.fn(), runtime: vi.fn(),
  workspace: vi.fn(), decode: vi.fn(), sdk: vi.fn(), messaging: vi.fn(), contact: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: edge.prisma }));
vi.mock("@/src/lib/better-auth/native-auth", () => ({
  readHostedNativeMemberAuth: edge.auth, assertHostedNativeMemberAuthCurrentTx: edge.current,
}));
vi.mock("@/src/lib/legal/consent", async original => ({
  ...await original<typeof import("@/src/lib/legal/consent")>(),
  assertHostedHistoricalLaunchConsentGranted: edge.consent,
  assertHostedLaunchRequiredConsentGranted: edge.consent,
}));
vi.mock("@/src/lib/hosted-onboarding/starter-usage-enrollment-service", () => ({
  ensureHostedStarterUsageEnrollment: edge.enroll, retryPendingHostedStarterUsageActivationRuntimeWake: edge.wake,
}));
vi.mock("@/src/lib/hosted-onboarding/phone-welcome", () => ({ ensureHostedMemberPhoneWelcome: edge.welcome }));
vi.mock("@/src/lib/hosted-onboarding/authentication-completion", () => ({ readHostedAuthenticationCompletion: edge.completion }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async original => ({
  ...await original<typeof import("@/src/lib/hosted-onboarding/hosted-member-store")>(),
  readHostedMemberMessagingSetupState: edge.messaging,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-contact-context", () => ({ readHostedMurphContactContextForMember: edge.contact }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: edge.runtime }));
vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: () => ({ createSdkSignInSession: edge.sdk }),
}));
vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: () => ({ store: {
    listMemberConnectionStatuses: async () => [], listBoundedConnectionSourcesForConnections: async () => [],
  } }),
}));
vi.mock("@/src/lib/hosted-workspace/store", () => ({ readHostedWorkspace: edge.workspace }));
vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: () => ({ createBrowserVaultSession: async () => ({ state: "ready" }) }),
}));
vi.mock("@/src/lib/browser-vault/loader", () => ({
  parseBrowserVaultSessionResponse: (value: unknown) => value, decodeReadyBrowserVaultSession: edge.decode,
}));

import { assertActiveHostedMemberAccessAllowed, readHostedRuntimeAiAccessDecision } from "@/src/lib/hosted-onboarding/member-access";
import { readHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { recordCompanionHeartbeat, readRuntimeCompanionPresence } from "@/src/lib/companion/presence";
import { registerCompanionPushRoute } from "@/src/lib/companion/push-route";
import { POST as admit } from "../app/api/device-sync/companion/admission/route";
import { GET as onboarding } from "../app/api/device-sync/companion/initial-onboarding/route";
import { GET as status } from "../app/api/device-sync/companion/status/route";
import { POST as signIn } from "../app/api/device-sync/companion/sign-in-token/route";
import { POST as heartbeat } from "../app/api/companion/heartbeat/route";
import { POST as pushRoute } from "../app/api/companion/push-route/route";
import { GET as numbers } from "../app/api/device-sync/companion/numbers/route";
import { GET as meals } from "../app/api/device-sync/companion/meals/route";

const savedAt = "2026-11-06T12:00:00.000Z";
const address = { installationId: "00000000-0000-4000-8000-000000000001", token: "ab".repeat(32),
  topic: "ai.withmurph.app" as const, environment: "production" as const, alertsAllowed: true };
const member = {
  id: "member_lapsed_fixture", billingStatus: HostedBillingStatus.canceled as HostedBillingStatus,
  suspendedAt: null as Date | null, accountGroupMemberships: [], threadContainer: null as object | null,
  billingRef: { stripeSubscriptionLookupKey: "synthetic-stale-subscription", currentBillingPhase: "paid",
    currentBillingPlanCode: "pulse", currentPeriodStart: new Date("2026-11-01"), currentPeriodEnd: new Date("2026-12-01") },
  consentGrants: [], initialOnboardingCompletedAt: new Date(savedAt),
  assistantPersona: "classic", assistantTone: "casual", assistantVoice: "murph",
  companionLastContactAt: null, companionLastForegroundAt: null,
};
const db = {
  $queryRaw: vi.fn(), $transaction: vi.fn(),
  hostedMember: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  hostedThreadContainer: { findUnique: vi.fn() },
  hostedAccountGroupMembership: { findFirst: vi.fn() },
  companionPushRoute: { findUnique: vi.fn(), upsert: vi.fn() },
};
function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request(`https://www.withmurph.ai${path}`, { method,
    headers: { authorization: `Bearer murph_auth_v1.${"a".repeat(32)}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MURPH_GAME_ENABLED", "false");
  member.billingStatus = HostedBillingStatus.canceled;
  member.suspendedAt = null; member.threadContainer = null;
  edge.prisma.mockReturnValue(db);
  edge.auth.mockResolvedValue({ kind: "better-auth", member });
  db.$queryRaw.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
  // Strict active queries still reject this member. Full state reads expose the
  // same canceled person to the real product guard and the real usage owner.
  db.hostedMember.findUnique.mockImplementation(async ({ where }: { where: { OR?: unknown } }) => where.OR ? null : member);
  db.hostedMember.findUniqueOrThrow.mockResolvedValue(member);
  db.hostedMember.updateMany.mockResolvedValue({ count: 0 });
  db.hostedThreadContainer.findUnique.mockResolvedValue(null);
  db.hostedAccountGroupMembership.findFirst.mockResolvedValue(null);
  db.companionPushRoute.findUnique.mockResolvedValue(null);
  edge.sdk.mockResolvedValue({ signInToken: "synthetic-sdk-token", environment: "sandbox" });
  edge.messaging.mockResolvedValue({ identity: { phoneLookupKey: null }, routing: { telegramUserId: null, telegramThreadId: null } });
  edge.contact.mockResolvedValue(null);
  edge.workspace.mockResolvedValue({ version: "v1", browserVaultReplicaRef: {
    byteLength: 128, dataVersion: "d".repeat(64), generatedAt: savedAt, generation: 18,
    keyId: "browser-vault-replica:d", objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica", runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1", sourceBundleHash: "a".repeat(64),
  } });
  edge.decode.mockResolvedValue({ client: {
    replica: { generation: 18, generatedAt: savedAt, demographics: null, entities: [], meals: { schemaVersion: 1, timeZone: "UTC", days: [] } },
    metrics: { series: () => [] },
  } });
});

afterEach(() => vi.unstubAllEnvs());

describe("lapsed member product access with real guards and companion services", () => {
  it.each(["canceled", "paused", "unpaid", "past_due"] as const)("admits %s without Starter, welcome or billing writes", async billingStatus => {
    member.billingStatus = billingStatus;
    const response = await admit(request("/api/device-sync/companion/admission", { timeZone: "UTC" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(edge.enroll).not.toHaveBeenCalled(); expect(edge.welcome).not.toHaveBeenCalled();
    expect(edge.wake).not.toHaveBeenCalled(); expect(edge.completion).not.toHaveBeenCalled();
    expect(db.hostedMember.update).not.toHaveBeenCalled();
    expect(db.hostedMember.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: member.id, billingStatus: { in: ["incomplete", "not_started"] } },
      data: { pendingActivationTimeZone: "UTC" },
    });
    expect(member.billingStatus).toBe(billingStatus);
  });

  it("keeps the same canceled member signed in through all native bootstrap reads", async () => {
    const responses = [
      await admit(request("/api/device-sync/companion/admission", {})),
      await onboarding(request("/api/device-sync/companion/initial-onboarding")),
      await status(request("/api/device-sync/companion/status")),
      await signIn(request("/api/device-sync/companion/sign-in-token", {})),
      await heartbeat(request("/api/companion/heartbeat", { state: "foreground" })),
      await pushRoute(request("/api/companion/push-route", address)),
      await numbers(request("/api/device-sync/companion/numbers")),
      await meals(request("/api/device-sync/companion/meals")),
    ];
    for (const response of responses) expect({ status: response.status, body: await response.json() }).not.toMatchObject({ status: 403 });
    expect(responses.map(response => response.status)).toEqual(Array(8).fill(200));
    expect(db.hostedMember.update).toHaveBeenCalledExactlyOnceWith({ where: { id: member.id }, data: {
      companionLastContactAt: expect.any(Date), companionLastForegroundAt: expect.any(Date),
    } });
    expect(db.companionPushRoute.upsert).toHaveBeenCalledOnce();
    expect(edge.enroll).not.toHaveBeenCalled(); expect(edge.welcome).not.toHaveBeenCalled();
    expect(edge.decode).toHaveBeenCalledTimes(2);
  });

  it("runs real heartbeat and push registration behind the deeper product authority", async () => {
    await recordCompanionHeartbeat(member.id, "background");
    await registerCompanionPushRoute(member.id, address);
    expect(db.hostedMember.update).toHaveBeenCalledOnce();
    expect(db.companionPushRoute.upsert).toHaveBeenCalledOnce();
    expect(db.$queryRaw).toHaveBeenCalledTimes(4); // member and sponsorship locks per transaction
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.hostedMember.findUnique.mock.invocationCallOrder[0]!);
  });

  it("still denies AI entitlement and usage for the same canceled member with stale paid evidence", async () => {
    await expect(readHostedRuntimeAiAccessDecision({ memberId: member.id })).resolves.toMatchObject({
      allowed: false, reason: "hosted_access_inactive", userNotice: { code: "billing_inactive" },
    });
    await expect(readHostedAiUsageGate({ memberId: member.id })).resolves.toMatchObject({ allowed: false, reason: "hosted_access_inactive" });
    expect(db.hostedMember.update).not.toHaveBeenCalled();
  });

  it.each(["not_started", "incomplete"] as const)("keeps %s on its activation path", async billingStatus => {
    member.billingStatus = billingStatus;
    await expect(assertActiveHostedMemberAccessAllowed({ memberId: member.id })).rejects.toMatchObject({ code: "HOSTED_ACCESS_REQUIRED" });
  });

  it("preserves suspension, consent and private-conversation checks before writes", async () => {
    member.suspendedAt = new Date(savedAt);
    await expect(recordCompanionHeartbeat(member.id, "foreground")).rejects.toMatchObject({ code: "HOSTED_MEMBER_SUSPENDED" });
    member.suspendedAt = null;
    edge.consent.mockRejectedValueOnce(new Error("synthetic consent denial"));
    await expect(registerCompanionPushRoute(member.id, address)).rejects.toThrow("synthetic consent denial");
    member.billingStatus = "active";
    db.hostedThreadContainer.findUnique.mockResolvedValue({ memberId: member.id });
    await expect(recordCompanionHeartbeat(member.id, "foreground")).rejects.toThrow("private member conversation");
    expect(db.hostedMember.update).not.toHaveBeenCalled(); expect(db.companionPushRoute.upsert).not.toHaveBeenCalled();
  });

  it("does not widen synthetic-container authority", async () => {
    member.threadContainer = { owner: { billingStatus: "canceled", suspendedAt: null, accountGroupMemberships: [] } };
    await expect(assertActiveHostedMemberAccessAllowed({ memberId: member.id })).rejects.toMatchObject({ code: "HOSTED_ACCESS_REQUIRED" });
  });

  it("keeps runtime presence behind its independent runtime callback fence", async () => {
    await readRuntimeCompanionPresence(member.id, null);
    expect(edge.runtime).toHaveBeenCalledExactlyOnceWith(db, member.id, null);
    edge.runtime.mockRejectedValueOnce(new Error("synthetic runtime denied"));
    db.hostedMember.findUniqueOrThrow.mockClear();
    await expect(readRuntimeCompanionPresence(member.id, null)).rejects.toThrow("synthetic runtime denied");
    expect(db.hostedMember.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
