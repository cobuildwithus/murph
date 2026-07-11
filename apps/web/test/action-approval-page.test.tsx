import assert from "node:assert/strict";

import { renderToReadableStream } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(() => ({ database: "test" })),
  readHostedActionApproval: vi.fn(),
  redirect: vi.fn(),
  requireActiveHostedAppSession: vi.fn(),
  requireHostedActionApprovalId: vi.fn((approvalId: string) => approvalId),
  resolveHostedMurphContactOptions: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOptions: mocks.resolveHostedMurphContactOptions,
}));

vi.mock("@/src/lib/action-approvals", () => ({
  readHostedActionApproval: mocks.readHostedActionApproval,
  requireHostedActionApprovalId: mocks.requireHostedActionApprovalId,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSession: mocks.requireActiveHostedAppSession,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type ActionApprovalPageModule = typeof import("../app/approve/[approvalId]/page");

let actionApprovalPage: ActionApprovalPageModule;

describe("action approval page", () => {
  beforeAll(async () => {
    actionApprovalPage = await import("../app/approve/[approvalId]/page");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSession.mockResolvedValue({
      member: { id: "member_test" },
    });
    mocks.readHostedActionApproval.mockResolvedValue({
      approvalId: "haa_test",
      expiresAt: "2026-07-09T16:00:00.000Z",
      presentation: {
        body: "Share the requested file.",
        title: "Share this file?",
      },
      returnContactKind: "text",
      status: "expired",
    });
    mocks.resolveHostedMurphContactOptions.mockResolvedValue([
      {
        href: "sms:+15550100001?body=That%20approval%20link%20expired",
        kind: "text",
        label: "Messages",
      },
      {
        href: "https://t.me/withmurph_bot",
        kind: "telegram",
        label: "Telegram",
        rel: "noopener noreferrer",
        target: "_blank",
      },
      {
        href: "mailto:murph@example.test",
        kind: "email",
        label: "Email",
      },
    ]);
  });

  it("renders one focused recovery action for an expired approval", async () => {
    const view = await actionApprovalPage.default({
      params: Promise.resolve({ approvalId: "haa_test" }),
    });
    const stream = await renderToReadableStream(view);
    await stream.allReady;
    const markup = await new Response(stream).text();
    const hrefs = [...markup.matchAll(/href="([^"]+)"/gu)].map(
      (match) => match[1],
    );

    assert.match(markup, /Approval link expired/);
    assert.match(markup, /Nothing was approved or changed\./);
    assert.match(markup, /Request a new link/);
    assert.equal(markup.includes("Return in Telegram"), false);
    assert.equal(markup.includes("Return in Email"), false);
    assert.deepEqual(hrefs, [
      "sms:+15550100001?body=That%20approval%20link%20expired",
    ]);
    expect(mocks.resolveHostedMurphContactOptions).toHaveBeenCalledWith({
      message: {
        body: "That approval link expired. Please send a new one.",
      },
      preferredKind: "text",
    });
  });

  it("shows the recovery reply when contact resolution is unavailable", async () => {
    mocks.resolveHostedMurphContactOptions.mockRejectedValueOnce(
      new Error("Contact resolution unavailable"),
    );

    const view = await actionApprovalPage.default({
      params: Promise.resolve({ approvalId: "haa_test" }),
    });
    const stream = await renderToReadableStream(view);
    await stream.allReady;
    const markup = await new Response(stream).text();

    assert.match(
      markup,
      /Return to the Murph conversation where this request started and send:/,
    );
    assert.match(
      markup,
      /That approval link expired\. Please send a new one\./,
    );
    assert.equal(markup.includes("Request a new link"), false);
    assert.equal(markup.includes('href="'), false);
  });

  it("keeps a group approval on its originating conversation fallback", async () => {
    mocks.readHostedActionApproval.mockResolvedValueOnce({
      approvalId: "haa_test",
      expiresAt: "2026-07-09T16:00:00.000Z",
      presentation: {
        body: "Share the requested file.",
        title: "Share this file?",
      },
      returnContactKind: null,
      status: "approved",
    });

    const view = await actionApprovalPage.default({
      params: Promise.resolve({ approvalId: "haa_test" }),
    });
    const stream = await renderToReadableStream(view);
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(mocks.resolveHostedMurphContactOptions).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    assert.match(markup, /I approved the request\./);
    assert.equal(markup.includes('href="'), false);
  });
});
