import { describe, expect, it } from "vitest";

import { isHostedWebhookReceiptReplayBlockedState } from "../src/lib/hosted-onboarding/webhook-receipt-store";

type ReceiptLookup = {
  claimExpiresAt: Date | null;
  lastErrorRetryable: boolean | null;
  status: "completed" | "failed" | "processing";
  updatedAt: Date;
} | null;

describe("isHostedWebhookReceiptReplayBlockedState", () => {
  it("returns false when no receipt exists", async () => {
    expect(
      isHostedWebhookReceiptReplayBlockedState(
        null,
        new Date("2026-03-25T10:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("blocks completed receipts", async () => {
    const receipt: ReceiptLookup = {
      claimExpiresAt: null,
      lastErrorRetryable: null,
      status: "completed",
      updatedAt: new Date("2026-03-25T09:59:00.000Z"),
    };

    expect(
      isHostedWebhookReceiptReplayBlockedState(
        receipt,
        new Date("2026-03-25T10:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("blocks non-retryable failed receipts and allows retryable failures", async () => {
    expect(
      isHostedWebhookReceiptReplayBlockedState(
        {
          claimExpiresAt: null,
          lastErrorRetryable: false,
          status: "failed",
          updatedAt: new Date("2026-03-25T09:59:00.000Z"),
        },
        new Date("2026-03-25T10:00:00.000Z"),
      ),
    ).toBe(true);

    expect(
      isHostedWebhookReceiptReplayBlockedState(
        {
          claimExpiresAt: null,
          lastErrorRetryable: true,
          status: "failed",
          updatedAt: new Date("2026-03-25T09:59:00.000Z"),
        },
        new Date("2026-03-25T10:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("blocks unexpired processing receipts and releases expired leases", async () => {
    expect(
      isHostedWebhookReceiptReplayBlockedState(
        {
          claimExpiresAt: new Date("2026-03-25T10:05:00.000Z"),
          lastErrorRetryable: null,
          status: "processing",
          updatedAt: new Date("2026-03-25T09:59:00.000Z"),
        },
        new Date("2026-03-25T10:00:00.000Z"),
      ),
    ).toBe(true);

    expect(
      isHostedWebhookReceiptReplayBlockedState(
        {
          claimExpiresAt: new Date("2026-03-25T09:55:00.000Z"),
          lastErrorRetryable: null,
          status: "processing",
          updatedAt: new Date("2026-03-25T09:40:00.000Z"),
        },
        new Date("2026-03-25T10:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
