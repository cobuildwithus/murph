import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/internal/health/win-texts/cron/route";
import { drainHealthWinTexts } from "@/src/lib/health-wins/nudge-job";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const m = vi.hoisted(() => ({
  prisma: vi.fn(), enrollments: vi.fn(), claim: vi.fn(), finish: vi.fn(), profile: vi.fn(), member: vi.fn(),
  existing: vi.fn(), authority: vi.fn(), inbound: vi.fn(), paused: vi.fn(), destination: vi.fn(), service: vi.fn(),
  detection: vi.fn(), identities: vi.fn(), prepare: vi.fn(), append: vi.fn(), signal: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: m.prisma }));
vi.mock("@/src/lib/health-wins/nudge-state", () => ({ claimHealthWinDayTx: m.claim, finishHealthWinEvaluationTx: m.finish }));
vi.mock("@/src/lib/health-wins/nudge-pause", () => ({ isHealthWinTextPaused: m.paused }));
vi.mock("@/src/lib/health-wins/achievement", () => ({ readHealthWinIdentities: m.identities }));
vi.mock("@/src/lib/health-wins/detection", () => ({ readHealthWinDetection: m.detection }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: m.authority }));
vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({ hasHostedLinqInboundWithinDays: m.inbound }));
vi.mock("@/src/lib/hosted-onboarding/linq-provider-health-store", () => ({ readHostedLinqChatHealth: m.service }));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({ resolveHostedAssistantNotificationDestination: m.destination }));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  runWithPreparedHostedMailboxItemAppendCrypto: m.prepare, appendHostedMailboxEnvelopeWithPreparedCryptoTx: m.append,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: m.signal }));

const memberId = "pilot-member";
const now = new Date("2030-04-18T11:30:00Z");
const winRef = "X".repeat(43);
const direct = {
  conversationShape: "direct-member", externalThreadRouteAuthority: null,
  route: { channel: "linq", threadIsDirect: true, threadId: "opaque-thread", identityId: null, actorId: null,
    delivery: { kind: "thread", target: "synthetic-thread" } },
};
const enrolled = { memberId, member: { gameProfile: { timeZone: "UTC" } }, lastEvaluatedDay: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubEnv("MURPH_GAME_ENABLED", "true");
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", "*");
  vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", memberId);
  const tx = {
    $queryRaw: vi.fn(),
    healthWinNudge: { findMany: m.enrollments }, gameProfile: { findUnique: m.profile },
    hostedMember: { findUnique: m.member }, hostedMailboxItem: { findUnique: m.existing },
  };
  m.prisma.mockReturnValue({ ...tx, $transaction: (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx) });
  m.enrollments.mockResolvedValue([enrolled]);
  m.claim.mockResolvedValue(true);
  m.finish.mockResolvedValue(winRef);
  m.profile.mockResolvedValue({ timeZone: "UTC" });
  m.member.mockResolvedValue({ runtimeDormantAt: null });
  m.authority.mockResolvedValue(undefined);
  m.existing.mockResolvedValue(null);
  m.inbound.mockResolvedValue(true);
  m.paused.mockResolvedValue(false);
  m.destination.mockResolvedValue(direct);
  m.service.mockResolvedValue({ service: "iMessage" });
  m.detection.mockResolvedValue({ complete: true,
    detect: () => ({ cards: [{ id: "card" }], achievements: new Map([["card", "descriptor"]]) }) });
  m.identities.mockReturnValue({ version: "test:v1", items: [{ seenKey: "opaque-seen", fresh: true, winRef }] });
  m.prepare.mockImplementation(async ({ append, prepareExisting }) => { await prepareExisting(); return append({}); });
  m.append.mockResolvedValue({ inserted: true, item: { id: "item", lane: "system", laneSeq: "9" } });
});

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("health win text sweep", () => {
  it.each(["", "*"])("makes no database reads when the founder list is %j", async ids => {
    vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", ids);
    expect(await drainHealthWinTexts()).toMatchObject({ claimed: 0 });
    expect(m.prisma).not.toHaveBeenCalled();
  });

  it("requires cron authorization before reading the founder list", async () => {
    vi.stubEnv("CRON_SECRET", "synthetic-cron-credential");
    const request = new Request("https://example.test/api/internal/health/win-texts/cron");
    expect((await GET(request)).status).toBe(401);
    expect(m.prisma).not.toHaveBeenCalled();
    vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", "");
    request.headers.set("authorization", "Bearer synthetic-cron-credential");
    expect(await (await GET(request)).json()).toMatchObject({ claimed: 0, queued: 0 });
  });

  it.each(["09:59", "13:30", "19:00"])("skips outside the dispatch window at %s", async hm => {
    vi.setSystemTime(new Date(`2030-04-18T${hm}:00Z`));
    expect(await drainHealthWinTexts()).toMatchObject({ claimed: 0 });
    expect(m.claim).not.toHaveBeenCalled();
  });

  it("never computes for a claim lost to an overlapping sweep", async () => {
    m.claim.mockResolvedValue(false);
    expect(await drainHealthWinTexts()).toMatchObject({ claimed: 0, computed: 0 });
    expect(m.detection).not.toHaveBeenCalled();
  });

  it.each([
    ["withdrawn consent", () => m.authority.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_CONSENT_REQUIRED", message: "Unavailable", httpStatus: 403 }))],
    ["dormant member", () => m.member.mockResolvedValue({ runtimeDormantAt: now })],
    ["no recent inbound", () => m.inbound.mockResolvedValue(false)],
    ["three unanswered", () => m.paused.mockResolvedValue(true)],
    ["already queued", () => m.existing.mockResolvedValue({ id: "existing" })],
    ["no route", () => m.destination.mockResolvedValue(null)],
    ["Telegram", () => m.destination.mockResolvedValue({ ...direct, route: { ...direct.route, channel: "telegram" } })],
    ["group route", () => m.destination.mockResolvedValue({ ...direct, conversationShape: "thread-container" })],
    ["first contact", () => m.destination.mockResolvedValue({ ...direct, route: { ...direct.route, delivery: { kind: "participant" } } })],
    ["SMS", () => m.service.mockResolvedValue({ service: "SMS" })],
    ["a provider-observed group", () => m.service.mockResolvedValue({ service: "iMessage", isGroup: true })],
    ["unknown provider service", () => m.service.mockResolvedValue(null)],
    ["zone changed", () => m.profile.mockResolvedValue({ timeZone: "America/Los_Angeles" })],
  ] as const)("claims but never reads a replica for %s", async (_reason, change) => {
    change();
    expect(await drainHealthWinTexts()).toMatchObject({ claimed: 1, ineligible: 1, computed: 0 });
    expect(m.detection).not.toHaveBeenCalled();
    expect(m.append).not.toHaveBeenCalled();
  });

  it.each([null, { complete: false }])("consumes the day when source input is missing", async source => {
    m.detection.mockResolvedValue(source);
    expect(await drainHealthWinTexts()).toMatchObject({ claimed: 1, incomplete: 1 });
    expect(m.prepare).not.toHaveBeenCalled();
  });

  it("skips mailbox crypto when a complete read has no achievement descriptors", async () => {
    m.identities.mockReturnValue({ version: "test:v1", items: [] });
    expect(await drainHealthWinTexts()).toMatchObject({ claimed: 1, suppressed: 1 });
    expect(m.prepare).not.toHaveBeenCalled();
  });

  it("enqueues the fixed question with the exact model-free identity and a daytime expiry", async () => {
    m.signal.mockRejectedValue(new Error("unavailable"));
    expect(await drainHealthWinTexts()).toMatchObject({ queued: 1, errors: 0 });
    const base = "health-win:v1:pilot-member:2030-04-18";
    expect(m.append).toHaveBeenCalledOnce();
    expect(m.append.mock.calls[0]![0]).toMatchObject({
      expiresAt: new Date("2030-04-18T13:30:00Z"), envelope: {
        kind: "assistant.notification.requested", eventId: `assistant.notification.requested:${base}`,
        occurredAt: now.toISOString(), notification: {
          route: direct.route, deliveryDedupeToken: base, deliveryIdempotencyKey: base, deliveryDispatchMode: "queue-only",
          responsePolicy: { kind: "require_send_exact_text", text: expect.stringMatching(/\?\nhttps:\/\/www\.withmurph\.ai\/wins\/X{43}$/u) },
        },
      },
    });
    expect(m.signal).toHaveBeenCalledOnce();
  });

  it("rechecks the zone and pause after detection and mailbox preparation", async () => {
    m.profile.mockResolvedValueOnce({ timeZone: "UTC" }).mockResolvedValue({ timeZone: "Asia/Tokyo" });
    expect(await drainHealthWinTexts()).toMatchObject({ queued: 0 });
    expect(m.paused).toHaveBeenCalledTimes(2);
    expect(m.append).not.toHaveBeenCalled();
  });

  it("caps claims and candidate enumeration per invocation", async () => {
    const ids = Array.from({ length: 31 }, (_, i) => `pilot-${i}`);
    vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", ids.join(","));
    m.enrollments.mockResolvedValue(ids.slice(0, 25).map(id => ({ ...enrolled, memberId: id })));
    m.inbound.mockResolvedValue(false);
    expect(await drainHealthWinTexts()).toMatchObject({ claimed: 25, ineligible: 25 });
    expect(m.enrollments).toHaveBeenCalledOnce();
    expect(m.enrollments.mock.calls[0]![0].where.memberId.in).toHaveLength(25);
  });
});
