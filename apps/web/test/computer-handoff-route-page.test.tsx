import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => {
  const service = {
    completeHandoff: vi.fn(),
    continueManagedLoginHandoff: vi.fn(),
    readHandoffPageState: vi.fn(),
  };

  return {
    createComputerUseService: vi.fn(() => service),
    getHostedMurphContactContext: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { url });
    }),
    requireActiveHostedAppSession: vi.fn(),
    requireActiveHostedAppSessionFromRequest: vi.fn(),
    service,
    withHostedComputerToolFailureRuntimeLog: vi.fn(
      async (input: { run: () => Promise<unknown> }) => await input.run(),
    ),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/lib/computer-use/service", () => ({
  createComputerUseService: mocks.createComputerUseService,
}));

vi.mock("@/src/lib/computer-use/runtime-log", () => ({
  withHostedComputerToolFailureRuntimeLog:
    mocks.withHostedComputerToolFailureRuntimeLog,
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
type ComputerManagedLoginRouteModule = typeof import(
  "../app/api/computer/handoff/[token]/managed-login/route"
);
type ComputerHandoffPageModule = typeof import(
  "../app/computer/handoff/[token]/page"
);

let computerHandoffDoneRoute: ComputerHandoffDoneRouteModule;
let computerManagedLoginRoute: ComputerManagedLoginRouteModule;
let computerHandoffPage: ComputerHandoffPageModule;

describe("computer handoff route and page", () => {
  beforeAll(async () => {
    computerHandoffDoneRoute = await import(
      "../app/api/computer/handoff/[token]/done/route"
    );
    computerManagedLoginRoute = await import(
      "../app/api/computer/handoff/[token]/managed-login/route"
    );
    computerHandoffPage = await import("../app/computer/handoff/[token]/page");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSession.mockResolvedValue(createSession());
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue(createSession());
    mocks.service.completeHandoff.mockResolvedValue({
      redirectTo: null,
      returnContactKind: "text",
      status: "completed",
      suggestedReply: "private suggested reply",
    });
    mocks.service.continueManagedLoginHandoff.mockResolvedValue({
      kind: "redirect",
      url: "https://auth.onkernel.com/login/test",
    });
    mocks.service.readHandoffPageState.mockResolvedValue({
      kind: "completed",
      returnContactKind: "text",
      suggestedReply: "finished_browser_step",
    });
    mocks.getHostedMurphContactContext.mockResolvedValue(createContactContext());
  });

  it("requires an authenticated hosted app session before completing a handoff", async () => {
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

  it("redirects a completed setup-owned handoff back to authenticated Connect", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      kind: "redirect",
      url: "/connect",
    });

    await expect(computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    })).rejects.toMatchObject({ url: "/connect" });

    expect(mocks.redirect).toHaveBeenCalledWith("/connect");
    expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
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

  it("auto-returns to Messages when the handoff came from the text channel", async () => {
    const response = await computerHandoffDoneRoute.POST(
      new Request("https://join.example.test/computer/handoff/handoff-token/done", {
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );
    const body = (await response.json()) as {
      redirectTo: string;
    };

    expect(response.status).toBe(200);
    expect(body.redirectTo).toBe("sms:+15550100001?body=Done");
    expect(body.redirectTo).not.toContain("private");
    expect(mocks.service.completeHandoff).toHaveBeenCalledWith({
      memberId: "member_123",
      token: "handoff-token",
    });
  });

  it("returns setup-owned handoffs directly to Connect without contact lookup", async () => {
    mocks.service.completeHandoff.mockResolvedValueOnce({
      redirectTo: "/connect",
      returnContactKind: null,
      status: "completed",
      suggestedReply: null,
    });

    const response = await computerHandoffDoneRoute.POST(
      new Request("https://join.example.test/computer/handoff/handoff-token/done", {
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ redirectTo: "/connect" });
    expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
  });

  it("returns email handoffs to the completed page instead of opening another app", async () => {
    mocks.service.completeHandoff.mockResolvedValueOnce({
      redirectTo: null,
      returnContactKind: "email",
      status: "completed",
      suggestedReply: "private suggested reply",
    });
    mocks.getHostedMurphContactContext.mockRejectedValue(
      new Error("contact context unavailable"),
    );

    const response = await computerHandoffDoneRoute.POST(
      new Request("https://join.example.test/computer/handoff/handoff-token/done", {
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );
    const body = (await response.json()) as {
      redirectTo: string;
    };

    expect(response.status).toBe(200);
    expect(body.redirectTo).toBe("/computer/handoff/handoff-token");
    expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
  });

  it("falls back to the handoff page path when the completed handoff has no source kind", async () => {
    mocks.service.completeHandoff.mockResolvedValueOnce({
      redirectTo: null,
      returnContactKind: null,
      status: "completed",
      suggestedReply: "private suggested reply",
    });
    mocks.getHostedMurphContactContext.mockRejectedValue(
      new Error("contact context unavailable"),
    );

    const response = await computerHandoffDoneRoute.POST(
      new Request("https://join.example.test/computer/handoff/handoff-token/done", {
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );
    const body = (await response.json()) as {
      redirectTo: string;
    };

    expect(response.status).toBe(200);
    expect(body.redirectTo).toBe("/computer/handoff/handoff-token");
    expect(mocks.service.completeHandoff).toHaveBeenCalledWith({
      memberId: "member_123",
      token: "handoff-token",
    });
    expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
  });

  it("falls back to the completed page when the source auto-return channel is unavailable", async () => {
    mocks.service.completeHandoff.mockResolvedValueOnce({
      redirectTo: null,
      returnContactKind: "text",
      status: "completed",
      suggestedReply: "private suggested reply",
    });
    mocks.getHostedMurphContactContext.mockResolvedValueOnce(createContactContext({
      initialContactChannels: {
        email: true,
        telegram: true,
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
    const body = (await response.json()) as {
      redirectTo: string;
    };

    expect(response.status).toBe(200);
    expect(body.redirectTo).toBe("/computer/handoff/handoff-token");
    expect(mocks.getHostedMurphContactContext).toHaveBeenCalledOnce();
  });

  it("falls back to the completed page when source contact resolution fails after completion", async () => {
    mocks.service.completeHandoff.mockResolvedValueOnce({
      redirectTo: null,
      returnContactKind: "telegram",
      status: "completed",
      suggestedReply: "private suggested reply",
    });
    mocks.getHostedMurphContactContext.mockRejectedValueOnce(
      new Error("contact context unavailable"),
    );

    const response = await computerHandoffDoneRoute.POST(
      new Request("https://join.example.test/computer/handoff/handoff-token/done", {
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );
    const body = (await response.json()) as {
      redirectTo: string;
    };

    expect(response.status).toBe(200);
    expect(body.redirectTo).toBe("/computer/handoff/handoff-token");
    expect(mocks.getHostedMurphContactContext).toHaveBeenCalledOnce();
  });

  it.each(["checkpointing", "expired"] as const)(
    "falls back to the completed page without contact lookup for %s source handoffs",
    async (status) => {
      mocks.service.completeHandoff.mockResolvedValueOnce({
        redirectTo: null,
        returnContactKind: "text",
        status,
        suggestedReply: "private suggested reply",
      });
      mocks.getHostedMurphContactContext.mockRejectedValue(
        new Error("contact context unavailable"),
      );

      const response = await computerHandoffDoneRoute.POST(
        new Request("https://join.example.test/computer/handoff/handoff-token/done", {
          method: "POST",
        }),
        createRouteContext({ token: "handoff-token" }),
      );
      const body = (await response.json()) as {
        redirectTo: string;
      };

      expect(response.status).toBe(200);
      expect(body.redirectTo).toBe("/computer/handoff/handoff-token");
      expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
    },
  );

  it("redirects managed-login handoffs without rendering the Live View", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      kind: "managed_login",
      suggestedReply: "Done",
    });

    await expect(computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    })).rejects.toMatchObject({
      url: "/api/computer/handoff/handoff-token/managed-login",
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/api/computer/handoff/handoff-token/managed-login",
    );
  });

  it("launches Kernel Hosted UI through the managed-login controller", async () => {
    const response = await computerManagedLoginRoute.GET(
      new Request(
        "https://join.example.test/api/computer/handoff/handoff-token/managed-login",
      ),
      createRouteContext({ token: "handoff-token" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://auth.onkernel.com/login/test",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.service.continueManagedLoginHandoff).toHaveBeenCalledWith({
      memberId: "member_123",
      token: "handoff-token",
    });
    expect(mocks.withHostedComputerToolFailureRuntimeLog).toHaveBeenCalledWith({
      memberId: "member_123",
      operation: "managed-login",
      run: expect.any(Function),
    });
  });

  it("returns verified setup-owned managed login directly to authenticated Connect", async () => {
    mocks.service.continueManagedLoginHandoff.mockResolvedValueOnce({
      kind: "redirect",
      url: "/connect",
    });

    const response = await computerManagedLoginRoute.GET(
      new Request(
        "https://join.example.test/api/computer/handoff/handoff-token/managed-login",
      ),
      createRouteContext({ token: "handoff-token" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://join.example.test/connect",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns completed managed login callbacks to the handoff page", async () => {
    mocks.service.continueManagedLoginHandoff.mockResolvedValueOnce({
      kind: "completed",
    });

    const response = await computerManagedLoginRoute.GET(
      new Request(
        "https://join.example.test/api/computer/handoff/handoff-token/managed-login?code=spoofed",
      ),
      createRouteContext({ token: "handoff-token" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://join.example.test/computer/handoff/handoff-token",
    );
    expect(mocks.service.continueManagedLoginHandoff).toHaveBeenCalledWith({
      memberId: "member_123",
      token: "handoff-token",
    });
  });

  it("logs retryable managed-login failures before returning the retry page", async () => {
    mocks.service.continueManagedLoginHandoff.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_COMPUTER_MANAGED_LOGIN_UNAVAILABLE",
        httpStatus: 409,
        message: "Managed sign-in is temporarily unavailable.",
        retryable: true,
      }),
    );

    const response = await computerManagedLoginRoute.GET(
      new Request(
        "https://join.example.test/api/computer/handoff/handoff-token/managed-login",
      ),
      createRouteContext({ token: "handoff-token" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://join.example.test/computer/handoff/handoff-token?managed=retry",
    );
    expect(mocks.withHostedComputerToolFailureRuntimeLog).toHaveBeenCalledWith({
      memberId: "member_123",
      operation: "managed-login",
      run: expect.any(Function),
    });
  });

  it("renders the terminal managed-login failure while its claim remains checkpointing", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      kind: "checkpointing",
      purpose: "managed_login",
      returnTo: "/connect",
      returnContactKind: null,
      suggestedReply: "Done",
    });

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
      searchParams: Promise.resolve({ managed: "retry" }),
    }));

    assert.match(markup, /Secure sign-in could not start/);
    assert.match(markup, /Return to Murph/);
    assert.match(markup, /href="\/connect"/);
    assert.equal(markup.includes("Saving your progress"), false);
    assert.equal(markup.includes("managed-login"), false);
    assert.equal(markup.includes("Try again"), false);
  });

  it("renders email-origin completed handoffs as reply-in-thread instructions", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      kind: "completed",
      returnContactKind: "email",
      suggestedReply: "finished_browser_step",
    });

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    assert.match(markup, /All set/);
    assert.match(markup, /existing Murph email thread/);
    assert.match(markup, /Reply in the existing email thread with:/);
    assert.match(markup, />Done</);
    assert.equal(markup.includes("Reply in Messages"), false);
    assert.equal(markup.includes("Reply in Telegram"), false);
    assert.equal(markup.includes("Reply in Email"), false);
  });

  it("renders only the source channel CTA for source-bound completed handoffs", async () => {
    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));
    const hrefs = [...markup.matchAll(/href="([^"]+)"/gu)].map((match) => match[1]);

    assert.match(markup, /All set/);
    assert.match(markup, /Reply to Murph to continue\./);
    assert.match(markup, /Reply to Murph/);
    assert.equal(markup.includes("Reply in Telegram"), false);
    assert.equal(markup.includes("Reply in Email"), false);
    assert.equal(markup.includes("Suggested reply"), false);
    assert.equal(markup.includes("finished_browser_step"), false);
    assert.deepEqual(hrefs, [
      "sms:+15550100001?body=Done",
    ]);
    expect(mocks.service.readHandoffPageState).toHaveBeenCalledWith({
      memberId: "member_123",
      token: "handoff-token",
    });
  });

  it("renders a single Reply to Murph CTA for legacy completed handoffs without a source kind", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      kind: "completed",
      returnContactKind: null,
      suggestedReply: "finished_browser_step",
    });
    mocks.getHostedMurphContactContext.mockResolvedValueOnce(createContactContext({
      userEmailAddress: "member@gmail.com",
    }));

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    assert.match(markup, /All set/);
    assert.match(markup, /Reply to Murph/);
    assert.equal(markup.includes("Reply in Messages"), false);
    assert.equal(markup.includes("Reply in Telegram"), false);
    assert.equal(markup.includes("Reply in Gmail"), false);
    expect(mocks.getHostedMurphContactContext).toHaveBeenCalledOnce();
  });

  it("renders only the literal Done fallback when a source channel is unavailable", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      kind: "completed",
      returnContactKind: "telegram",
      suggestedReply: "finished_browser_step",
    });
    mocks.getHostedMurphContactContext.mockResolvedValueOnce(createContactContext({
      initialContactChannels: {
        email: true,
        telegram: false,
        text: true,
      },
    }));

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    assert.match(markup, /All set/);
    assert.match(markup, /Reply with:/);
    assert.match(markup, />Done</);
    assert.equal(markup.includes("Reply in Messages"), false);
    assert.equal(markup.includes("Reply in Telegram"), false);
    assert.equal(markup.includes("Reply in Email"), false);
  });

  it("renders the literal Done fallback when source contact resolution fails", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      kind: "completed",
      returnContactKind: "text",
      suggestedReply: "finished_browser_step",
    });
    mocks.getHostedMurphContactContext.mockRejectedValueOnce(
      new Error("contact context unavailable"),
    );

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    assert.match(markup, /All set/);
    assert.match(markup, /Reply with:/);
    assert.match(markup, />Done</);
    assert.equal(markup.includes("Reply in Messages"), false);
    assert.equal(markup.includes("Reply in Telegram"), false);
    assert.equal(markup.includes("Reply in Email"), false);
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
    assert.match(markup, /Reply with:/);
    assert.match(markup, />Done</);
    assert.equal(markup.includes("Suggested reply"), false);
    assert.equal(markup.includes("finished_browser_step"), false);
  });

  it("renders the live view immediately", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      description: "Take over to finish this step.",
      handoffId: "hch_open",
      iframeAllow: "clipboard-read",
      interaction: "takeover",
      kind: "open",
      liveViewUrl: "https://browser.example.test/live",
      purpose: "login",
      suggestedReply: "done",
      title: "Your turn",
    });

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    assert.match(markup, /<iframe[^>]+src="https:\/\/browser\.example\.test\/live"/);
  });

  it("renders explicit provider prerequisite guidance in the real handoff page", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      description: "Your provider may require a developer prerequisite before Murph can create your private application. Complete that provider step, then choose Done to return to Connect.",
      handoffId: "hch_prerequisite",
      iframeAllow: "clipboard-read",
      interaction: "takeover",
      kind: "open",
      liveViewUrl: "https://browser.example.test/live",
      purpose: "manual_browser_help",
      suggestedReply: null,
      title: "Continue provider setup",
    });

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    assert.match(markup, /Continue provider setup/u);
    assert.match(markup, /developer prerequisite/u);
    assert.match(markup, /choose Done to return to Connect/u);
    assert.doesNotMatch(markup, /Reply to Murph/u);
  });

});

function createSession(status: "active" | "suspended" = "active") {
  return {
    expiresAt: new Date("2035-06-22T12:00:00.000Z"),
    member: {
      id: "member_123",
      status,
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
