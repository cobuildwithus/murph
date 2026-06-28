import { afterEach, describe, expect, it, vi } from "vitest";

const cronMocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  reconcileHostedLinqContactCards: vi.fn(),
  requireVercelCronRequest: vi.fn(),
  sendRecoverableHostedLinqAlertsBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: cronMocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-alert-email", () => ({
  sendRecoverableHostedLinqAlertsBestEffort: cronMocks.sendRecoverableHostedLinqAlertsBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-contact-card", () => ({
  reconcileHostedLinqContactCards: cronMocks.reconcileHostedLinqContactCards,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: cronMocks.getPrisma,
}));

import { GET } from "../app/api/internal/hosted-onboarding/linq/contact-card/cron/route";

afterEach(() => {
  cronMocks.getPrisma.mockReset();
  cronMocks.reconcileHostedLinqContactCards.mockReset();
  cronMocks.requireVercelCronRequest.mockReset();
  cronMocks.sendRecoverableHostedLinqAlertsBestEffort.mockReset();
});

describe("hosted Linq contact-card cron route", () => {
  it("still attempts recoverable alert delivery when contact-card reconciliation fails", async () => {
    const prisma = {};
    cronMocks.getPrisma.mockReturnValue(prisma);
    cronMocks.reconcileHostedLinqContactCards.mockRejectedValue(new Error("linq contact card outage"));
    cronMocks.sendRecoverableHostedLinqAlertsBestEffort.mockResolvedValue(undefined);

    const response = await GET(new Request("https://example.test/api/internal/hosted-onboarding/linq/contact-card/cron"));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(cronMocks.sendRecoverableHostedLinqAlertsBestEffort).toHaveBeenCalledWith({
      prisma,
    });
  });
});
