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
