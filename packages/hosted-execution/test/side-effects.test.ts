import { describe, expect, it } from "vitest";

import { gatewayDeliveryTargetKindValues } from "@murphai/gateway-core";

import {
  hostedAssistantDeliveryTargetKindValues,
  parseHostedAssistantDeliveryRecord,
  parseHostedAssistantDeliverySideEffects,
  parseHostedExecutionSideEffects,
} from "../src/side-effects.ts";

describe("hosted assistant delivery contracts", () => {
  it("reuses gateway-owned delivery target kinds", () => {
    expect(hostedAssistantDeliveryTargetKindValues).toEqual(gatewayDeliveryTargetKindValues);
  });

  it("keeps assistant-delivery parsing aligned with the compatibility aliases", () => {
    const payload = [{
      effectId: "intent-1",
      fingerprint: "dedupe-1",
      intentId: "intent-1",
      kind: "assistant.delivery",
    }];

    expect(parseHostedAssistantDeliverySideEffects(payload)).toEqual(payload);
    expect(parseHostedExecutionSideEffects(payload)).toEqual(payload);
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
      intentId: "intent-1",
      kind: "assistant.delivery",
      recordedAt: "2026-04-08T00:00:00.000Z",
      state: "sent",
    });

    expect(record.state).toBe("sent");
    expect(record.delivery.targetKind).toBe("participant");
  });
});
