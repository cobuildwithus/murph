import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ audience: vi.fn(), transaction: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  gameBlock: { findMany: async () => [] },
  game: { findFirst: async () => ({ id: "game", chatContainerMemberId: "room", players: [{ timeZone: "UTC" }] }) },
  hostedGroup: { findUnique: async () => ({ id: "group" }) },
  $transaction: mocks.transaction,
}) }));
vi.mock("@/src/lib/game/http/auth", () => ({
  requireGameMemberAuth: async () => ({ member: { id: "viewer" } }),
  assertGameMemberAuthCurrentTx: vi.fn(),
}));
vi.mock("@/src/lib/game/chat-membership", async original => ({
  ...await original<typeof import("@/src/lib/game/chat-membership")>(), readGameChatAudience: mocks.audience,
}));

import { GameChatAudienceError } from "@/src/lib/game/chat-membership";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { PUT } from "../app/api/game/v1/people/[memberId]/board/sharing/route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MURPH_GAME_ENABLED", "true");
  vi.stubEnv("MURPH_GAME_BOARD_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("first board enrollment audience errors", () => {
  it.each([
    { label: "removed route", error: new GameChatAudienceError("route_removed", "Game chat route is unavailable."), status: 404, code: "GAME_NOT_FOUND" },
    { label: "changed audience", error: new GameChatAudienceError("participants_changed", "The game's chat participants have changed."), status: 404, code: "GAME_NOT_FOUND" },
    ...["HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS", "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS"].map(code => ({
      label: `ambiguous identity (${code})`, error: hostedOnboardingError({ code, httpStatus: 500, message: "Synthetic ambiguous identity." }),
      status: 404, code: "GAME_NOT_FOUND",
    })),
    { label: "failed audience read", error: new Error("Synthetic audience read failed."), status: 500, code: "INTERNAL_ERROR" },
    { label: "unusable sending line", error: new GameChatAudienceError("line_unavailable", "Game chat sending line is unavailable."), status: 500, code: "INTERNAL_ERROR" },
    { label: "provider failure", error: hostedOnboardingError({ code: "LINQ_SEND_FAILED", httpStatus: 502, message: "Synthetic provider failure.", retryable: true }), status: 502, code: "LINQ_SEND_FAILED" },
  ])("answers $status for $label without starting a mutation", async ({ error, status, code }) => {
    mocks.audience.mockRejectedValueOnce(error);
    const request = new Request("https://example.test/board/sharing", { method: "PUT",
      body: JSON.stringify({ expectedMembershipId: null, numbers: ["steps"] }),
    });
    const response = await PUT(request, { params: Promise.resolve({ memberId: "other" }) });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(mocks.audience).toHaveBeenCalledExactlyOnceWith("room");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
