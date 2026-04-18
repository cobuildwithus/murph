import assert from "node:assert/strict";

import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionEmailConversationMessageWake,
  isHostedEmailConversationMessageWake,
} from "@murphai/hosted-execution";
import type { HostedAssistantDeliveryRecord } from "@murphai/hosted-execution/side-effects";

import { readHostedRawEmailMessage } from "../src/hosted-runtime/events/email.ts";

describe("readHostedRawEmailMessage", () => {
  it("fails closed when the raw email payload is unavailable", async () => {
    const wake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "evt_email",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-08T00:00:00.000Z",
      rawMessageKey: "raw_123",
      userId: "member_123",
    });
    if (!isHostedEmailConversationMessageWake(wake)) {
      throw new Error("Expected email conversation wake.");
    }

    await expect(
      readHostedRawEmailMessage(
        wake,
        {
          async deletePreparedAssistantDelivery() {},
          async readRawEmailMessage() {
            return null;
          },
          async readAssistantDeliveryRecord() {
            return null;
          },
          async sendEmail() {},
          async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
            return record;
          },
        },
      ),
    ).rejects.toThrow(
      "Hosted email message fetch failed for member_123/raw_123.",
    );
  });

  it("returns the raw email bytes for direct normalization in the conversation lane", async () => {
    const wake = buildHostedExecutionEmailConversationMessageWake({
      eventId: "evt_email",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-08T00:00:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "user@example.com",
      userId: "member_123",
    });
    if (!isHostedEmailConversationMessageWake(wake)) {
      throw new Error("Expected email conversation wake.");
    }
    const rawMessage = Uint8Array.from([1, 2, 3, 4]);

    await expect(readHostedRawEmailMessage(
      wake,
      {
        async deletePreparedAssistantDelivery() {},
        async readRawEmailMessage() {
          return rawMessage;
        },
        async readAssistantDeliveryRecord() {
          return null;
        },
        async sendEmail() {},
        async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
          return record;
        },
      },
    )).resolves.toEqual(rawMessage);
  });
});
