import { describe, expect, it } from "vitest";
import {
  isHostedSystemMailboxModelFreeExactNotificationItem,
  selectHostedModelFreeSystemMailboxItems,
} from "../src/hosted-runtime/system-mailbox-state.ts";

type PendingItem = Parameters<typeof isHostedSystemMailboxModelFreeExactNotificationItem>[0];

function exactNotification(input: {
  dedupeKey?: string;
  deliveryDedupeToken?: string;
  deliveryIdempotencyKey?: string;
  laneSeq: string;
}): PendingItem {
  const deliveryDedupeToken = input.deliveryDedupeToken ?? "group-join:membership";
  const mailboxDedupeKey = input.dedupeKey
    ?? `assistant.notification.requested:${deliveryDedupeToken}`;
  return {
    itemId: `notification_${input.laneSeq}`,
    mailboxDedupeKey,
    mailboxLaneSeq: input.laneSeq,
    routeAction: "dispatch-assistant-notification",
    wake: {
      eventId: mailboxDedupeKey,
      kind: "assistant.notification.requested",
      notification: {
        deliveryDedupeToken,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey:
          input.deliveryIdempotencyKey ?? deliveryDedupeToken,
        responsePolicy: { kind: "require_send_exact_text", text: "Confirmation" },
      },
    },
  } as PendingItem;
}

function maintenance(laneSeq: string): PendingItem {
  return {
    itemId: `maintenance_${laneSeq}`,
    mailboxDedupeKey: `runtime.maintenance-requested:${laneSeq}`,
    mailboxLaneSeq: laneSeq,
    routeAction: "apply-runtime-control-request",
    wake: { kind: "runtime.maintenance-requested" },
  } as PendingItem;
}

function assistantAsk(laneSeq: string): PendingItem {
  return {
    itemId: `assistant_ask_${laneSeq}`,
    mailboxDedupeKey: `assistant.ask.completed:${laneSeq}`,
    mailboxLaneSeq: laneSeq,
    routeAction: "run-assistant-ask",
    wake: { kind: "assistant.ask.completed" },
  } as PendingItem;
}

function environmentInterview(laneSeq: string): PendingItem {
  return {
    itemId: `environment_${laneSeq}`,
    mailboxDedupeKey: `environment-interview.completed:${laneSeq}`,
    mailboxLaneSeq: laneSeq,
    routeAction: "run-environment-interview",
    wake: { kind: "environment-interview.completed" },
  } as PendingItem;
}

describe("model-free mailbox admission", () => {
  it("admits an exact group join and independent maintenance", () => {
    const notification = exactNotification({ laneSeq: "1" });
    const later = maintenance("2");
    expect(isHostedSystemMailboxModelFreeExactNotificationItem(notification)).toBe(true);
    expect(selectHostedModelFreeSystemMailboxItems({ pending: [later, notification] }).pending).toEqual([later, notification]);
    expect(selectHostedModelFreeSystemMailboxItems({ pending: [later] }).pending).toEqual([later]);
  });

  it("admits a canonical exact wearable delivery-stall notice", () => {
    const notification = exactNotification({
      deliveryDedupeToken: "device-delivery-stalled:v1:abc123",
      laneSeq: "1",
    });
    expect(isHostedSystemMailboxModelFreeExactNotificationItem(notification)).toBe(true);
    expect(isHostedSystemMailboxModelFreeExactNotificationItem(exactNotification({
      deliveryDedupeToken: "device-delivery-stalled:v1:abc123",
      deliveryIdempotencyKey: "device-delivery-stalled:v1:different",
      laneSeq: "1",
    }))).toBe(false);
  });

  it("keeps independent maintenance eligible while a generic notification needs the assistant", () => {
    const generic = exactNotification({
      dedupeKey: "assistant.notification.requested:generic",
      laneSeq: "1",
    });
    const later = maintenance("2");
    expect(isHostedSystemMailboxModelFreeExactNotificationItem(generic)).toBe(false);
    expect(selectHostedModelFreeSystemMailboxItems({ pending: [later, generic] }).pending).toEqual([later]);
  });

  it("admits an exact notification independently of an assistant item", () => {
    const earlier = assistantAsk("1");
    const notification = exactNotification({ laneSeq: "2" });
    expect(selectHostedModelFreeSystemMailboxItems({
      pending: [notification, earlier],
    }).pending).toEqual([notification]);
  });

  it("admits environment work independently of an assistant item", () => {
    const earlier = assistantAsk("1");
    const environment = environmentInterview("2");

    expect(selectHostedModelFreeSystemMailboxItems({
      pending: [environment, earlier],
    }).pending).toEqual([environment]);
    expect(selectHostedModelFreeSystemMailboxItems({
      pending: [environment],
    }).pending).toEqual([environment]);
  });
});
