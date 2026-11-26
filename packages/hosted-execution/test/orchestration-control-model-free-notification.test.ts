import { describe, expect, it } from "vitest";
import {
  classifyHostedSystemMailboxExecutionClass,
  isHostedSystemMailboxModelFreeNotification,
} from "../src/orchestration-control.ts";

describe("model-free system mailbox notification identity", () => {
  it("admits only a nonempty canonical group-join notification identity", () => {
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:group-join:membership",
      kind: "assistant.notification.requested",
    })).toBe(true);
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:group-join:",
      kind: "assistant.notification.requested",
    })).toBe(false);
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:other",
      kind: "assistant.notification.requested",
    })).toBe(false);
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:group-join:membership",
      kind: "runtime.maintenance-requested",
    })).toBe(false);
  });

  it("admits only a versioned wearable delivery-stall notification identity", () => {
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:device-delivery-stalled:v1:abc123",
      kind: "assistant.notification.requested",
    })).toBe(true);
    expect(isHostedSystemMailboxModelFreeNotification({
      dedupeKey: "assistant.notification.requested:device-delivery-stalled:v1:",
      kind: "assistant.notification.requested",
    })).toBe(false);
  });

  it.each([false, true])("classifies health win wakes when assistant execution is blocked=%s", (assistantExecutionBlocked) => {
    const classify = (dedupeKey: string) => classifyHostedSystemMailboxExecutionClass({
      assistantExecutionBlocked,
      dedupeKey,
      kind: "assistant.notification.requested",
    });
    expect(classify("assistant.notification.requested:health-win:v1:synthetic:2026-04-27")).toBe("model_free");
    expect(classify("assistant.notification.requested:health-win:v1:")).toBe("default_owned");
    expect(classify("assistant.notification.requested:health-win:v2:synthetic:2026-04-27")).toBe("default_owned");
    expect(classify("health-win:v1:synthetic:2026-04-27")).toBe("default_owned");
  });
});
