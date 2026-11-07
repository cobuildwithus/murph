import { describe, expect, it, vi } from "vitest";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { parseHostedExecutionWake, parseHostedRuntimeGroupToolRequest, parseHostedRuntimeGroupToolResponse } from "@murphai/hosted-execution/parsers";
import type { HostedRuntimeGroupToolResponse } from "@murphai/hosted-execution/runtime-control";
import { buildHostedGameChatBootstrapPolicy } from "../src/hosted-runtime/events/game-chat-bootstrap.ts";
import { createHostedGroupToolWithCurrentTurnContext } from "../src/hosted-runtime/group-tool-context.ts";

function fixture() {
  const memberId = "synthetic-group";
  const eventId = "assistant.notification.requested:game-started:synthetic-game";
  const wake = buildHostedExecutionAssistantNotificationRequestedWake({
    memberId, eventId, occurredAt: "2026-04-08T00:00:00.000Z",
    notification: { gameChatBootstrap: { gameId: "synthetic-game", eventId }, instructions: "Announce the challenge.", responsePolicy: { kind: "require_send" },
      route: { actorId: null, channel: "linq", identityId: memberId, threadId: null, threadIsDirect: false, delivery: { kind: "bootstrap", target: memberId } } },
  });
  const request = vi.fn(async (): Promise<HostedRuntimeGroupToolResponse> => ({ action: "game_chat_bootstrap", result: { status: "needs_message" } }));
  return { wake, executionContext: { hosted: { memberId, userEnvKeys: [] } }, groupToolPort: { request } };
}

describe("game bootstrap trusted boundary", () => {
  it("preserves source metadata through wire parsing and uses only host control", async () => {
    const input = fixture();
    expect(parseHostedExecutionWake(input.wake)).toMatchObject({ notification: input.wake.notification });
    const policy = buildHostedGameChatBootstrapPolicy(input);
    expect(policy.deferCommitUntilDeliveryAccepted).toBe(true);
    await policy.gameChatBootstrap?.recover();
    await policy.gameChatBootstrap?.send("The challenge is on.");
    expect(input.groupToolPort.request.mock.calls).toEqual([
      [{ action: "game_chat_bootstrap", gameId: "synthetic-game", eventId: input.wake.eventId, operation: "recover" }],
      [{ action: "game_chat_bootstrap", gameId: "synthetic-game", eventId: input.wake.eventId, operation: "send", text: "The challenge is on." }],
    ]);
  });
  it("leaves legacy notification behavior unchanged and rejects partial bootstrap metadata", () => {
    const input = fixture();
    delete input.wake.notification.gameChatBootstrap;
    input.wake.notification.route.delivery = { kind: "thread", target: "existing-chat" };
    input.wake.notification.route.threadId = "existing-chat";
    expect(parseHostedExecutionWake(input.wake)).toMatchObject({ notification: { route: { delivery: { kind: "thread" } } } });
    expect(buildHostedGameChatBootstrapPolicy(input)).toEqual({});
    input.wake.notification.route.delivery.kind = "bootstrap";
    expect(() => buildHostedGameChatBootstrapPolicy(input)).toThrow();
    expect(input.groupToolPort.request).not.toHaveBeenCalled();
  });
  it("rejects private runtimes, fake provider routes, unrelated source and optional-send policy", () => {
    for (const mutate of [
      (input: ReturnType<typeof fixture>) => { input.executionContext.hosted.memberId = "private-person"; },
      (input: ReturnType<typeof fixture>) => { input.wake.notification.route.threadId = "invented-chat"; },
      (input: ReturnType<typeof fixture>) => { input.wake.notification.route.threadIsDirect = true; },
      (input: ReturnType<typeof fixture>) => { input.wake.notification.gameChatBootstrap!.eventId = "other-event"; },
      (input: ReturnType<typeof fixture>) => { input.wake.notification.responsePolicy = { kind: "allow_send_or_skip" }; },
    ]) {
      const input = fixture(); mutate(input);
      expect(() => buildHostedGameChatBootstrapPolicy(input)).toThrow(/Game bootstrap/);
      expect(input.groupToolPort.request).not.toHaveBeenCalled();
    }
  });
  it("rejects bootstrap calls from the conversational tool wrapper", async () => {
    const input = fixture();
    const port = createHostedGroupToolWithCurrentTurnContext({ groupToolPort: input.groupToolPort, linqDeliveryContexts: [] });
    await expect(port.request({ action: "game_chat_bootstrap", gameId: "synthetic-game", eventId: input.wake.eventId, operation: "recover" })).rejects.toThrow(/unavailable to conversational tools/);
    expect(input.groupToolPort.request).not.toHaveBeenCalled();
  });
  it("parses the narrow callback and rejects injected recipients or recovery text", () => {
    const request = { action: "game_chat_bootstrap", gameId: "synthetic-game", eventId: "synthetic-event", operation: "recover" };
    expect(parseHostedRuntimeGroupToolRequest(request)).toEqual(request);
    expect(() => parseHostedRuntimeGroupToolRequest({ ...request, text: "override" })).toThrow();
    expect(() => parseHostedRuntimeGroupToolRequest({ ...request, target: "recipient" })).toThrow();
    expect(parseHostedRuntimeGroupToolResponse({ action: "game_chat_bootstrap", result: { status: "unavailable" } })).toEqual({ action: "game_chat_bootstrap", result: { status: "unavailable" } });
  });
});
