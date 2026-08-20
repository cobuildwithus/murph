import { describe, expect, it } from "vitest";
import {
  isHostedSystemMailboxModelFreeExactNotificationItem,
  projectHostedSystemMailboxModelFreeNotificationFrontier,
} from "../src/hosted-runtime/system-mailbox-state.ts";

type PendingItem = Parameters<typeof isHostedSystemMailboxModelFreeExactNotificationItem>[0];

function exactNotification(input: { dedupeKey?: string; laneSeq: string }): PendingItem {
  const deliveryDedupeToken = "group-join:membership";
  const mailboxDedupeKey = input.dedupeKey
    ?? `assistant.notification.requested:${deliveryDedupeToken}`;
  return {
    mailboxDedupeKey,
    mailboxLaneSeq: input.laneSeq,
    routeAction: "dispatch-assistant-notification",
    wake: {
      eventId: mailboxDedupeKey,
      kind: "assistant.notification.requested",
      notification: {
        deliveryDedupeToken,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: deliveryDedupeToken,
        responsePolicy: { kind: "require_send_exact_text", text: "Confirmation" },
      },
    },
  } as PendingItem;
}

function maintenance(laneSeq: string): PendingItem {
  return {
    mailboxDedupeKey: `runtime.maintenance-requested:${laneSeq}`,
    mailboxLaneSeq: laneSeq,
    routeAction: "apply-runtime-control-request",
    wake: { kind: "runtime.maintenance-requested" },
  } as PendingItem;
}

function assistantAsk(laneSeq: string): PendingItem {
  return {
    mailboxDedupeKey: `assistant.ask.completed:${laneSeq}`,
    mailboxLaneSeq: laneSeq,
    routeAction: "run-assistant-ask",
    wake: { kind: "assistant.ask.completed" },
  } as PendingItem;
}

describe("blocked model-free exact notification frontier", () => {
  it("admits a canonical exact group join at the durable frontier before later work", () => {
    const notification = exactNotification({ laneSeq: "1" });
    const later = maintenance("2");
    expect(isHostedSystemMailboxModelFreeExactNotificationItem(notification)).toBe(true);
    expect(projectHostedSystemMailboxModelFreeNotificationFrontier({ pending: [later, notification] }).pending).toEqual([notification]);
    expect(projectHostedSystemMailboxModelFreeNotificationFrontier({ pending: [later] }).pending).toEqual([later]);
  });

  it("does not overtake a generic notification at the durable frontier", () => {
    const generic = exactNotification({
      dedupeKey: "assistant.notification.requested:generic",
      laneSeq: "1",
    });
    const later = maintenance("2");
    expect(isHostedSystemMailboxModelFreeExactNotificationItem(generic)).toBe(false);
    expect(projectHostedSystemMailboxModelFreeNotificationFrontier({ pending: [later, generic] }).pending).toEqual([]);
  });

  it("does not admit an exact notification behind an earlier durable item", () => {
    const earlier = assistantAsk("1");
    const notification = exactNotification({ laneSeq: "2" });
    expect(projectHostedSystemMailboxModelFreeNotificationFrontier({
      pending: [notification, earlier],
    }).pending).toEqual([earlier]);
  });
});
