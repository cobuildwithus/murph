import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => {
  const service = {
    completeHandoff: vi.fn(),
    ensureHandoffViewport: vi.fn(),
    readHandoffPageState: vi.fn(),
  };

  return {
    createComputerUseService: vi.fn(() => service),
    getHostedMurphContactContext: vi.fn(),
    headers: vi.fn(),
    requireActiveHostedAppSession: vi.fn(),
    requireActiveHostedAppSessionFromRequest: vi.fn(),
    service,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("@/src/lib/computer-use/service", () => ({
  createComputerUseService: mocks.createComputerUseService,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSession: mocks.requireActiveHostedAppSession,
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-contact-context", () => ({
  getHostedMurphContactContext: mocks.getHostedMurphContactContext,
}));

type ComputerHandoffDoneRouteModule = typeof import(
  "../app/api/computer/handoff/[token]/done/route"
);
type ComputerHandoffPageModule = typeof import(
  "../app/computer/handoff/[token]/page"
);

let computerHandoffDoneRoute: ComputerHandoffDoneRouteModule;
let computerHandoffPage: ComputerHandoffPageModule;

describe("computer handoff route and page", () => {
  beforeAll(async () => {
    computerHandoffDoneRoute = await import(
      "../app/api/computer/handoff/[token]/done/route"
    );
    computerHandoffPage = await import("../app/computer/handoff/[token]/page");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSession.mockResolvedValue(createSession());
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue(createSession());
    mocks.service.completeHandoff.mockResolvedValue({
      suggestedReply: "private suggested reply",
    });
    mocks.service.ensureHandoffViewport.mockResolvedValue(undefined);
    mocks.service.readHandoffPageState.mockResolvedValue({
      kind: "completed",
      suggestedReply: "finished_browser_step",
    });
    mocks.headers.mockResolvedValue(createHeaders(null));
    mocks.getHostedMurphContactContext.mockResolvedValue(createContactContext());
  });

  it("requires an active hosted app session before completing a handoff", async () => {
    const authError = new Error("Sign in to continue.");
    mocks.requireActiveHostedAppSessionFromRequest.mockRejectedValueOnce(authError);

    await expect(computerHandoffDoneRoute.POST(
      new Request("https://join.example.test/computer/handoff/handoff-token/done", {
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    )).rejects.toThrow(authError);

    expect(mocks.service.completeHandoff).not.toHaveBeenCalled();
    expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
  });

  it("renders an auth-required handoff state without reading handoff details", async () => {
    mocks.requireActiveHostedAppSession.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Sign in to continue.",
      }),
    );

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    assert.match(markup, /Sign in to open this private page/);
    assert.match(markup, /Log in or sign up/);
    expect(mocks.createComputerUseService).not.toHaveBeenCalled();
    expect(mocks.service.readHandoffPageState).not.toHaveBeenCalled();
  });

  it("does not hide non-auth handoff page errors behind the auth state", async () => {
    const accessError = hostedOnboardingError({
      code: "HOSTED_MEMBER_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted member access is required.",
    });
    mocks.requireActiveHostedAppSession.mockRejectedValueOnce(accessError);

    await expect(computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    })).rejects.toThrow(accessError);

    expect(mocks.service.readHandoffPageState).not.toHaveBeenCalled();
  });

  it("returns the preferred contact deep link with a literal Done body", async () => {
    const response = await computerHandoffDoneRoute.POST(
      new Request("https://join.example.test/computer/handoff/handoff-token/done", {
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );
    const body = (await response.json()) as { redirectTo: string };

    expect(response.status).toBe(200);
    expect(body.redirectTo).toBe("sms:+15550100001?body=Done");
    expect(body.redirectTo).not.toContain("private");
    expect(mocks.service.completeHandoff).toHaveBeenCalledWith({
      memberId: "member_123",
      token: "handoff-token",
    });
  });

  it("falls back to the handoff page path when no contact channel resolves", async () => {
    mocks.getHostedMurphContactContext.mockResolvedValueOnce(createContactContext({
      initialContactChannels: {
        email: false,
        telegram: false,
        text: false,
      },
      murphPhoneNumber: null,
    }));

    const response = await computerHandoffDoneRoute.POST(
      new Request("https://join.example.test/computer/handoff/handoff-token/done", {
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );
    const body = (await response.json()) as { redirectTo: string };

    expect(response.status).toBe(200);
    expect(body.redirectTo).toBe("/computer/handoff/handoff-token");
    expect(mocks.service.completeHandoff).toHaveBeenCalledWith({
      memberId: "member_123",
      token: "handoff-token",
    });
  });

  it("renders completed handoff contact CTAs without echoing the suggested reply", async () => {
    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));
    const hrefs = [...markup.matchAll(/href="([^"]+)"/gu)].map((match) => match[1]);

    assert.match(markup, /All set/);
    assert.match(markup, /Reply to Murph to continue\./);
    assert.match(markup, /Reply in Messages/);
    assert.match(markup, /Reply in Telegram/);
    assert.match(markup, /Reply in Email/);
    assert.equal(markup.includes("Suggested reply"), false);
    assert.equal(markup.includes("finished_browser_step"), false);
    assert.deepEqual(hrefs, [
      "sms:+15550100001?body=Done",
      "https://t.me/withmurph_bot?text=Done",
      "mailto:murph+alias123@mail.withmurph.ai?subject=Hey%20Murph&amp;body=Done",
    ]);
    expect(mocks.service.readHandoffPageState).toHaveBeenCalledWith({
      memberId: "member_123",
      token: "handoff-token",
    });
  });

  it("renders a literal Done fallback when completed handoff has no contact channel", async () => {
    mocks.getHostedMurphContactContext.mockResolvedValueOnce(createContactContext({
      initialContactChannels: {
        email: false,
        telegram: false,
        text: false,
      },
      murphEmailAddress: null,
      murphPhoneNumber: null,
    }));

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    assert.match(markup, /All set/);
    assert.match(markup, /Return to your Murph thread and reply with:/);
    assert.match(markup, />Done</);
    assert.equal(markup.includes("Suggested reply"), false);
    assert.equal(markup.includes("finished_browser_step"), false);
  });

  it.each([
    [
      "mobile",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1",
    ],
    [
      "desktop",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ],
  ] as const)(
    "resizes the kernel browser to %s before rendering the live view",
    async (preset, userAgent) => {
      mocks.service.readHandoffPageState.mockResolvedValueOnce({
        handoffId: "hch_open",
        iframeAllow: "clipboard-read",
        kind: "open",
        liveViewUrl: "https://browser.example.test/live",
        purpose: "login",
        suggestedReply: "done",
      });
      mocks.headers.mockResolvedValueOnce(createHeaders(userAgent));

      const markup = renderToStaticMarkup(await computerHandoffPage.default({
        params: Promise.resolve({ token: "handoff-token" }),
      }));

      expect(mocks.service.ensureHandoffViewport).toHaveBeenCalledWith({
        memberId: "member_123",
        preset,
        token: "handoff-token",
      });
      assert.match(markup, /<iframe[^>]+src="https:\/\/browser\.example\.test\/live"/);
    },
  );

  it("still renders the live view when the kernel resize fails", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      handoffId: "hch_open",
      iframeAllow: "clipboard-read",
      kind: "open",
      liveViewUrl: "https://browser.example.test/live",
      purpose: "login",
      suggestedReply: "done",
    });
    mocks.service.ensureHandoffViewport.mockRejectedValueOnce(
      new Error("kernel hiccup"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const markup = renderToStaticMarkup(await computerHandoffPage.default({
        params: Promise.resolve({ token: "handoff-token" }),
      }));

      assert.match(markup, /<iframe[^>]+src="https:\/\/browser\.example\.test\/live"/);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

function createHeaders(userAgent: string | null): Headers {
  const headers = new Headers();
  if (userAgent !== null) {
    headers.set("user-agent", userAgent);
  }
  return headers;
}

function createSession() {
  return {
    expiresAt: new Date("2035-06-22T12:00:00.000Z"),
    member: {
      id: "member_123",
      status: "active",
    },
    privyUserId: "privy_123",
    sessionId: "hws_test",
  };
}

function createContactContext(input: {
  initialContactChannels?: {
    email: boolean;
    telegram: boolean;
    text: boolean;
  };
  murphEmailAddress?: string | null;
  murphPhoneNumber?: string | null;
  userEmailAddress?: string | null;
} = {}) {
  return {
    initialContactChannels: input.initialContactChannels ?? {
      email: true,
      telegram: true,
      text: true,
    },
    murphEmailAddress: input.murphEmailAddress ?? "murph+alias123@mail.withmurph.ai",
    murphPhoneNumber: input.murphPhoneNumber ?? "+15550100001",
    userEmailAddress: input.userEmailAddress ?? "member@example.test",
  };
}
