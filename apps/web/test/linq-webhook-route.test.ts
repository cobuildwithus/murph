import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LinqWebhookPayloadError, LinqWebhookVerificationError } from "@murph/inboxd/linq-webhook";

const mocks = vi.hoisted(() => ({
  createHostedLinqControlPlane: vi.fn(),
  handleWebhook: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/src/lib/linq/control-plane", () => ({
  createHostedLinqControlPlane: mocks.createHostedLinqControlPlane,
}));

type LinqWebhookRouteModule = typeof import("../app/api/linq/webhook/route");

let linqWebhookRoute: LinqWebhookRouteModule;

describe("hosted Linq webhook route", () => {
  beforeAll(async () => {
    linqWebhookRoute = await import("../app/api/linq/webhook/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedLinqControlPlane.mockReturnValue({
      handleWebhook: mocks.handleWebhook,
      info: mocks.info,
    });
    mocks.info.mockReturnValue({
      routes: {
        webhookPath: "/api/linq/webhook",
        webhookUrl: "https://example.test/api/linq/webhook",
      },
    });
  });

  it("maps shared Linq signature verification errors to a 401 response", async () => {
    mocks.handleWebhook.mockRejectedValue(
      new LinqWebhookVerificationError("Invalid Linq webhook signature."),
    );

    const response = await linqWebhookRoute.POST(
      new Request("https://example.test/api/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LINQ_WEBHOOK_SIGNATURE_INVALID",
        message: "Invalid Linq webhook signature.",
      },
    });
  });

  it("maps shared Linq payload validation errors to a 400 response", async () => {
    mocks.handleWebhook.mockRejectedValue(
      new LinqWebhookPayloadError("Linq webhook payload must be an object."),
    );

    const response = await linqWebhookRoute.POST(
      new Request("https://example.test/api/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LINQ_WEBHOOK_PAYLOAD_INVALID",
        message: "Linq webhook payload must be an object.",
      },
    });
  });
});
