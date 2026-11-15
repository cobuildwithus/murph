import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
  constructEvent: vi.fn(),
  record: vi.fn(),
  start: vi.fn(),
  alert: vi.fn(),
  config: { webhookSecret: "whsec_fixture" as string | null },
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeWebhookVerificationConfig: () => ({
    stripe: { webhooks: { constructEvent: mocks.constructEvent } },
    webhookSecret: mocks.config.webhookSecret,
  }),
}));
vi.mock("@/src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  recordHostedStripeEvent: mocks.record,
}));
vi.mock("@/src/lib/hosted-onboarding/stripe-webhook-workflow-start", () => ({
  startHostedStripeWebhookReconciliationWorkflow: mocks.start,
}));
vi.mock("@/src/lib/hosted-onboarding/stripe-alert-email", () => ({
  scheduleHostedStripePaymentFailureEventAlert: mocks.alert,
}));
import { handleHostedStripeWebhook } from "@/src/lib/hosted-onboarding/webhook-service-stripe";

const event = { id: "evt_fixture", type: "invoice.paid", livemode: false } as Stripe.Event;
const prisma = {} as never;
const receive = (signature: string | null = "signature") => handleHostedStripeWebhook({
  prisma, rawBody: "verified-raw-body", signature,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.webhookSecret = "whsec_fixture";
  mocks.constructEvent.mockReturnValue(event);
  mocks.record.mockResolvedValue({ duplicate: false, type: event.type });
  mocks.start.mockResolvedValue({ status: "completed" });
});

describe("Stripe receipt admission", () => {
  it("acknowledges persisted work and runs its first receipt-owned attempt after the response", async () => {
    await expect(receive()).resolves.toEqual({ ok: true, type: event.type });
    expect(mocks.constructEvent).toHaveBeenCalledWith("verified-raw-body", "signature", "whsec_fixture");
    expect(mocks.record).toHaveBeenCalledWith({ event, prisma });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.start).toHaveBeenCalledWith({ eventId: event.id });
    expect(mocks.alert).toHaveBeenCalledWith({ eventId: event.id, eventType: event.type, livemode: false });
  });

  it("does not create a second retry owner or another alert for duplicate receipts", async () => {
    mocks.record.mockResolvedValue({ duplicate: true, type: event.type });
    await expect(receive()).resolves.toMatchObject({ duplicate: true, ok: true });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it.each([
    [null, "whsec_fixture", false, "STRIPE_SIGNATURE_REQUIRED"],
    ["signature", null, false, "STRIPE_WEBHOOK_SECRET_REQUIRED"],
    ["signature", "whsec_fixture", true, "STRIPE_SIGNATURE_INVALID"],
  ] as const)("rejects unauthenticated ingress before recording or scheduling (%s, %s)", async (signature, secret, invalid, code) => {
    mocks.config.webhookSecret = secret;
    if (invalid) {
      mocks.constructEvent.mockImplementation(() => { throw new Error("invalid signature"); });
      vi.spyOn(console, "error").mockImplementation(() => {});
    }
    await expect(receive(signature)).rejects.toMatchObject({ code });
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("cannot acknowledge a failed durable append", async () => {
    mocks.record.mockRejectedValue(new Error("database unavailable"));
    await expect(receive()).rejects.toThrow("database unavailable");
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
