import { describe, expect, it } from "vitest";

import { gatewayDeliveryTargetKindValues } from "@murphai/gateway-core";

import {
  buildHostedAssistantDeliveryEffect,
  buildHostedAssistantDeliveryPreparedRecord,
  hostedAssistantDeliveryTargetKindValues,
  parseHostedAssistantDeliveryRecord,
  parseHostedAssistantDeliverySideEffects,
  parseHostedExecutionSideEffects,
} from "../src/side-effects.ts";

describe("hosted assistant delivery contracts", () => {
  it("reuses gateway-owned delivery target kinds", () => {
    expect(hostedAssistantDeliveryTargetKindValues).toEqual(gatewayDeliveryTargetKindValues);
  });

  it("parses canonical assistant-delivery side effects", () => {
    const payload = [{
      effectId: "intent-1",
      fingerprint: "dedupe-1",
      kind: "assistant.delivery",
    }];

    expect(parseHostedAssistantDeliverySideEffects(payload)).toEqual(payload);
    expect(parseHostedExecutionSideEffects(payload)).toEqual(payload);
  });

  it("builds canonical effects and prepared records without a duplicate intentId", () => {
    const effect = buildHostedAssistantDeliveryEffect({
      dedupeKey: "dedupe-1",
      effectId: "intent-1",
    });
    const record = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe-1",
      effectId: "intent-1",
      recordedAt: "2026-04-12T00:00:00.000Z",
    });

    expect(effect).toEqual({
      effectId: "intent-1",
      fingerprint: "dedupe-1",
      kind: "assistant.delivery",
    });
    expect(record).toEqual({
      effectId: "intent-1",
      fingerprint: "dedupe-1",
      kind: "assistant.delivery",
      recordedAt: "2026-04-12T00:00:00.000Z",
      state: "prepared",
    });
    expect("intentId" in effect).toBe(false);
    expect("intentId" in record).toBe(false);
  });

  it("parses sent assistant delivery records with gateway-owned target kinds", () => {
    const record = parseHostedAssistantDeliveryRecord({
      delivery: {
        channel: "email",
        idempotencyKey: "idem-1",
        messageLength: 42,
        providerMessageId: null,
        providerThreadId: null,
        sentAt: "2026-04-08T00:00:00.000Z",
        target: "alice@example.com",
        targetKind: "participant",
      },
      effectId: "intent-1",
      fingerprint: "dedupe-1",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    });

    expect(record.state).toBe("sent");
    if (record.state !== "sent") {
      throw new Error("Expected a sent assistant delivery record.");
    }

    expect(record.delivery.targetKind).toBe("participant");
  });

  it("rejects removed hosted assistant-delivery intentId fields", () => {
    expect(() =>
      parseHostedAssistantDeliveryRecord({
        effectId: "intent-1",
        fingerprint: "dedupe-1",
        intentId: "intent-1",
        kind: "assistant.delivery",
        recordedAt: "2026-04-08T00:00:00.000Z",
        state: "prepared",
      })
    ).toThrow("intentId is no longer supported");
  });
});
