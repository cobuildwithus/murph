import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { parseHostedRuntimeGroupToolRequest } from "@murphai/hosted-execution/parsers";
import { sendAssistantNotification } from "@murphai/assistant-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeHostedAssistantNotificationWake } from "../src/hosted-runtime/events/assistant-notification.ts";

const mocks = vi.hoisted(() => ({
  sendAssistantNotification: vi.fn(),
}));

vi.mock("@murphai/assistant-engine", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/assistant-engine")>(),
  sendAssistantNotification: mocks.sendAssistantNotification,
}));

type AssistantNotificationInput = Parameters<typeof sendAssistantNotification>[0];

const GAME_ID = "game_synthetic";
const EVENT_ID = `game-recap:${GAME_ID}`;
const PAIR_FINGERPRINT = "0123456789abcdef0123456789abcdef";

function recapWake(eventId = EVENT_ID, loreAccess?: "read") {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId,
    memberId: "hbm_synthetic",
    occurredAt: "2036-08-25T18:00:00.000Z",
    notification: {
      instructions: "Compose the recap.",
      responsePolicy: { kind: "require_game_recap", gameId: GAME_ID, eventId, pairFingerprint: PAIR_FINGERPRINT, ...(loreAccess ? { loreAccess } : {}) },
      route: {
        actorId: null,
        channel: "linq",
        delivery: { kind: "explicit", target: "thread_synthetic" },
        identityId: "identity_synthetic",
        threadId: "thread_synthetic",
        threadIsDirect: false,
      },
    },
  });
}

beforeEach(() => {
  mocks.sendAssistantNotification.mockReset();
});

describe("hosted game recap notification", () => {
  it.each([false, true])("checkpoints only stamps actually written and resumes repair-only work: %s", async resume => {
    const wake = recapWake();
    if (wake.notification.responsePolicy?.kind !== "require_game_recap") throw new Error("Expected recap policy");
    wake.notification.responsePolicy.show = true;
    const generationIds = ["game-recap:game_prior", EVENT_ID];
    mocks.sendAssistantNotification.mockResolvedValue({ decision: { kind: "skip", privateSummary: "Synthetic repair." },
      deliveryOutcome: null, response: null, session: { sessionId: "synthetic" }, recapLoreCheckpointed: generationIds,
      ...(resume ? { recapLoreRepairOnly: true } : {}) });
    const result = await executeHostedAssistantNotificationWake({ executionContext: { hosted: { memberId: wake.userId, userEnvKeys: [] } },
      groupToolPort: { request: vi.fn() }, vaultRoot: "/synthetic-vault", wake });
    expect(result.postCheckpointRecord).toEqual({ kind: "game.recap-lore-checkpointed", gameId: GAME_ID, eventId: EVENT_ID, generationIds, resume });
    expect(result.deliveryIntentIds).toEqual([]);
  });
  it("uses Sol only for the trusted pair-show capability", async () => {
    for (const show of [false, true]) {
      const wake = recapWake();
      if (wake.notification.responsePolicy?.kind !== "require_game_recap") throw new Error("Expected recap policy");
      if (show) wake.notification.responsePolicy.show = true;
      mocks.sendAssistantNotification.mockResolvedValue({ decision: { kind: "skip", privateSummary: "Synthetic recap." }, deliveryOutcome: null, response: "", session: { sessionId: "synthetic" } });
      await executeHostedAssistantNotificationWake({ executionContext: { hosted: { memberId: wake.userId, userEnvKeys: [] } },
        groupToolPort: { request: async () => ({ action: "read_game", result: { status: "ok", recapGame: {} } }) }, vaultRoot: "/synthetic-vault", wake });
      const input = mocks.sendAssistantNotification.mock.lastCall?.[0] as AssistantNotificationInput;
      expect(input.assistantTargetOverride?.model).toBe(show ? "gpt-6.1-sol" : undefined);
      expect(input.executionContext?.hosted?.gameRecapScope?.show).toBe(show ? true : undefined);
    }
  });
  it("binds group missed-day scope to the room with writable lore and no group control port", async () => {
    const wake = recapWake();
    const policy = { kind: "game_group_missed_check_in" as const, roomId: wake.userId, eventId: `game-missed:${wake.userId}:group:2030-03-04`,
      firstMissedDate: "2030-03-04", pairFingerprint: PAIR_FINGERPRINT, conversationLaneSeq: "17",
      batch: [{ gameId: GAME_ID, termsVersion: 1, remainingMemberIds: ["one", "two"], misses: [{ memberId: "one", missedDates: ["2030-03-04"] }] }] };
    wake.eventId = policy.eventId; wake.notification.responsePolicy = policy;
    mocks.sendAssistantNotification.mockResolvedValue({ decision: { kind: "skip", privateSummary: "Already explained." }, deliveryOutcome: null, response: "", session: { sessionId: "synthetic" } });
    await executeHostedAssistantNotificationWake({ executionContext: { hosted: { memberId: wake.userId, userEnvKeys: [] } }, vaultRoot: "/synthetic-vault", wake });
    const input = mocks.sendAssistantNotification.mock.calls[0]![0] as AssistantNotificationInput;
    expect(input.executionContext?.hosted?.gameMissedCheckInScope).toEqual(policy);
    expect(input.executionContext?.hosted?.gameRecapScope).toBeUndefined();
    expect(input.executionContext?.hosted?.groupTool).toBeUndefined();
    expect(input.responsePolicy).toEqual(policy);
    mocks.sendAssistantNotification.mockClear();
    for (const invalid of [{ ...wake, userId: "wrong-room" }, { ...wake, eventId: "wrong-event" },
      { ...wake, notification: { ...wake.notification, route: { ...wake.notification.route, threadIsDirect: true } } }]) {
      await expect(executeHostedAssistantNotificationWake({ executionContext: { hosted: { memberId: wake.userId, userEnvKeys: [] } }, vaultRoot: "/synthetic-vault", wake: invalid })).rejects.toThrow();
    }
    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
  });
  it.each([EVENT_ID, `${EVENT_ID}:synthetic_request`].flatMap(eventId => [undefined, "read" as const].map(loreAccess => ({ eventId, loreAccess }))))("hands the recap turn the platform group tool from the minimal mailbox context: %s", async ({ eventId, loreAccess }) => {
    const request = vi.fn(async () => ({ action: "read_game" as const, result: { status: "ok" as const, state: { games: [] } } }));
    const groupToolPort = { request };
    let received: AssistantNotificationInput | null = null;
    mocks.sendAssistantNotification.mockImplementation(async (input: AssistantNotificationInput) => {
      received = input;
      const scope = input.executionContext?.hosted?.gameRecapScope;
      const outbound = parseHostedRuntimeGroupToolRequest({ action: "read_game", origin: { kind: "game_recap", gameId: scope?.gameId, eventId: scope?.eventId } });
      await input.executionContext?.hosted?.groupTool?.request(outbound);
      return { decision: { kind: "skip" as const, privateSummary: "Synthetic recap." }, deliveryOutcome: null, response: "", session: { sessionId: "session_synthetic" } };
    });
    await executeHostedAssistantNotificationWake({
      executionContext: { hosted: { memberId: "hbm_synthetic", userEnvKeys: [] } },
      groupToolPort,
      vaultRoot: "/synthetic-vault",
      wake: recapWake(eventId, loreAccess),
    });
    const hosted = (received as AssistantNotificationInput | null)?.executionContext?.hosted;
    expect(hosted?.groupTool).toBe(groupToolPort);
    expect(hosted?.gameRecapScope).toEqual({ gameId: GAME_ID, eventId, pairFingerprint: PAIR_FINGERPRINT, ...(loreAccess ? { loreAccess } : {}) });
    expect(request).toHaveBeenCalledWith({ action: "read_game", origin: { kind: "game_recap", gameId: GAME_ID, eventId } });
  });

  it.each(["game-recap:another_game:synthetic_request", `${EVENT_ID}:short`, `${EVENT_ID}:synthetic_request:extra`])("rejects a malformed or differently bound recap identity: %s", async (eventId) => {
    await expect(executeHostedAssistantNotificationWake({
      executionContext: { hosted: { memberId: "hbm_synthetic", userEnvKeys: [] } },
      groupToolPort: { request: vi.fn() }, vaultRoot: "/synthetic-vault", wake: recapWake(eventId),
    })).rejects.toThrow("Game recap notification authority is invalid.");
    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
  });

  it("refuses a recap turn without the trusted group tool", async () => {
    await expect(executeHostedAssistantNotificationWake({
      executionContext: { hosted: { memberId: "hbm_synthetic", userEnvKeys: [] } },
      vaultRoot: "/synthetic-vault",
      wake: recapWake(),
    })).rejects.toThrow("Game recap requires its trusted control port.");
    expect(mocks.sendAssistantNotification).not.toHaveBeenCalled();
  });
});
