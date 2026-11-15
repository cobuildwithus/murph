import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { GameChatAudienceError } from "@/src/lib/game/chat-membership";
import { PUT as saveBoard } from "../app/api/game/v1/people/[memberId]/board/sharing/route";
import { PUT as saveReminders } from "../app/api/game/v1/me/reminders/route";

const mocks = vi.hoisted(() => ({ audience: vi.fn(), authority: vi.fn(), destination: vi.fn(), getPrisma: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/game/http/auth", () => ({
  requireGameMemberAuth: async () => ({ member: { id: "player-a" } }),
  assertGameMemberAuthCurrentTx: vi.fn(),
}));
vi.mock("@/src/lib/game/chat-membership", async original => ({
  ...await original<typeof import("@/src/lib/game/chat-membership")>(), readGameChatAudience: mocks.audience,
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", async original => ({
  ...await original<typeof import("@/src/lib/hosted-routing/assistant-notification-destination")>(),
  resolveHostedAssistantNotificationDestination: mocks.destination,
  assertHostedDirectAssistantNotificationRouteAuthority: mocks.authority,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", async original => ({
  ...await original<typeof import("@/src/lib/hosted-onboarding/member-access")>(),
  readHostedRuntimeAiAccessDecision: async () => ({ allowed: true }),
}));
vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", () => ({
  resolveHostedRuntimeAiUsageGate: async () => ({ status: "allowed" }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "true");
  vi.stubEnv("MURPH_GAME_BOARD_ENABLED", "true");
  mocks.destination.mockResolvedValue({ conversationShape: "direct-member", externalThreadRouteAuthority: null,
    route: { channel: "linq", threadIsDirect: true, delivery: { kind: "thread", target: "synthetic-thread" } } });
  const db = {
    gameBlock: { findMany: vi.fn().mockResolvedValue([]) },
    game: { findFirst: vi.fn().mockResolvedValue({ id: "synthetic-game", chatContainerMemberId: "synthetic-room", players: [] }) },
    hostedGroup: { findUnique: vi.fn().mockResolvedValue({ id: "synthetic-group" }) },
    $transaction: async <T>(run: (tx: object) => Promise<T>): Promise<T> => run(db),
  };
  mocks.getPrisma.mockReturnValue(db);
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  { error: new GameChatAudienceError("participants_changed", "Audience changed"), status: 404, code: "GAME_NOT_FOUND" },
  { error: new Error("Synthetic database unavailable"), status: 500, code: "INTERNAL_ERROR" },
  { error: hostedOnboardingError({ code: "LINQ_SEND_FAILED", httpStatus: 502, message: "Provider unavailable", retryable: true }), status: 502, code: "LINQ_SEND_FAILED" },
])("board sharing preserves refusal and provider classifications: $status", async ({ error, status, code }) => {
  mocks.audience.mockRejectedValue(error);
  const response = await saveBoard(new Request("https://example.test/board/sharing", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedMembershipId: null, numbers: [] }),
  }), { params: Promise.resolve({ memberId: "player-b" }) });
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code, ...(status === 502 ? { retryable: true } : {}) } });
});

it.each([
  { error: hostedOnboardingError({ code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED", httpStatus: 403, message: "Route refused" }), status: 400, code: "INVALID_REQUEST" },
  { error: new Error("Synthetic destination lookup unavailable"), status: 500, code: "INTERNAL_ERROR" },
])("reminder writes preserve only explicit authority refusal: $status", async ({ error, status, code }) => {
  mocks.authority.mockRejectedValue(error);
  const response = await saveReminders(new Request("https://example.test/me/reminders", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ minutes: 1140, push: true, text: true, offGameIds: [] }),
  }));
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code, ...(status === 400
    ? { message: "Private texts aren't available for this account right now." } : {}) } });
});
