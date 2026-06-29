import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => {
  const service = {
    completeHandoff: vi.fn(),
    continueManagedLoginHandoff: vi.fn(),
    ensureHandoffViewport: vi.fn(),
    readHandoffPageState: vi.fn(),
  };

  return {
    assertHostedOnboardingMutationOrigin: vi.fn(),
    createComputerUseService: vi.fn(() => service),
    getHostedMurphContactContext: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { url });
    }),
    requireActiveHostedAppSession: vi.fn(),
    requireActiveHostedAppSessionFromRequest: vi.fn(),
    saveHostedWebSessionComputerHandoffViewportSize: vi.fn(),
    scheduleHostedWebSessionComputerHandoffViewportApply: vi.fn(),
    service,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/lib/computer-use/service", () => ({
  createComputerUseService: mocks.createComputerUseService,
}));

vi.mock("@/src/lib/computer-use/handoff-viewport-session", () => ({
  saveHostedWebSessionComputerHandoffViewportSize:
    mocks.saveHostedWebSessionComputerHandoffViewportSize,
  scheduleHostedWebSessionComputerHandoffViewportApply:
    mocks.scheduleHostedWebSessionComputerHandoffViewportApply,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSession: mocks.requireActiveHostedAppSession,
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
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
type ComputerHandoffViewportRouteModule = typeof import(
  "../app/api/computer/handoff/[token]/viewport/route"
);
type ComputerHandoffPageModule = typeof import(
  "../app/computer/handoff/[token]/page"
);

let computerHandoffDoneRoute: ComputerHandoffDoneRouteModule;
let computerManagedLoginRoute: ComputerManagedLoginRouteModule;
let computerHandoffViewportRoute: ComputerHandoffViewportRouteModule;
let computerHandoffPage: ComputerHandoffPageModule;

describe("computer handoff route and page", () => {
  beforeAll(async () => {
    computerHandoffDoneRoute = await import(
      "../app/api/computer/handoff/[token]/done/route"
    );
    computerManagedLoginRoute = await import(
      "../app/api/computer/handoff/[token]/managed-login/route"
    );
    computerHandoffViewportRoute = await import(
      "../app/api/computer/handoff/[token]/viewport/route"
    );
    computerHandoffPage = await import("../app/computer/handoff/[token]/page");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSession.mockResolvedValue(createSession());
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue(createSession());
    mocks.service.completeHandoff.mockResolvedValue({
      returnContactKind: "text",
      status: "completed",
      suggestedReply: "private suggested reply",
    });
    mocks.service.continueManagedLoginHandoff.mockResolvedValue({
      kind: "redirect",
      url: "https://auth.onkernel.com/login/test",
    });
    mocks.service.ensureHandoffViewport.mockResolvedValue(undefined);
    mocks.saveHostedWebSessionComputerHandoffViewportSize.mockResolvedValue(true);
    mocks.service.readHandoffPageState.mockResolvedValue({
      kind: "completed",
      returnContactKind: "text",
      suggestedReply: "finished_browser_step",
    });
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

  it("returns email handoffs to the completed page instead of opening another app", async () => {
    mocks.service.completeHandoff.mockResolvedValueOnce({
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

  it("renders the live view immediately without a cached viewport resize", async () => {
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      handoffId: "hch_open",
      iframeAllow: "clipboard-read",
      interaction: "takeover",
      kind: "open",
      liveViewUrl: "https://browser.example.test/live",
      purpose: "login",
      suggestedReply: "done",
    });

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    expect(mocks.service.ensureHandoffViewport).not.toHaveBeenCalled();
    expect(
      mocks.scheduleHostedWebSessionComputerHandoffViewportApply,
    ).not.toHaveBeenCalled();
    assert.match(markup, /<iframe[^>]+src="https:\/\/browser\.example\.test\/live"/);
  });

  it("starts a cached viewport resize in the background when the web session has a saved handoff size", async () => {
    mocks.requireActiveHostedAppSession.mockResolvedValueOnce(createSession({
      computerHandoffViewportSize: { height: 844, width: 390 },
    }));
    mocks.service.readHandoffPageState.mockResolvedValueOnce({
      handoffId: "hch_open",
      iframeAllow: "clipboard-read",
      interaction: "takeover",
      kind: "open",
      liveViewUrl: "https://browser.example.test/live",
      purpose: "login",
      suggestedReply: "done",
    });

    const markup = renderToStaticMarkup(await computerHandoffPage.default({
      params: Promise.resolve({ token: "handoff-token" }),
    }));

    assert.match(markup, /<iframe[^>]+src="https:\/\/browser\.example\.test\/live"/);
    expect(
      mocks.scheduleHostedWebSessionComputerHandoffViewportApply,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      reason: "cached",
      sessionId: "hws_test",
      token: "handoff-token",
    });
    expect(mocks.service.ensureHandoffViewport).not.toHaveBeenCalled();
  });

  it("saves a measured handoff viewport and schedules background apply", async () => {
    const observedAt = "2026-06-29T12:00:00.000Z";
    const response = await computerHandoffViewportRoute.POST(
      new Request("https://join.example.test/api/computer/handoff/handoff-token/viewport", {
        body: JSON.stringify({ height: 844, observedAt, width: 390 }),
        headers: {
          "content-type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.saveHostedWebSessionComputerHandoffViewportSize).toHaveBeenCalledWith({
      memberId: "member_123",
      now: expect.any(Date),
      observedAt: new Date(observedAt),
      sessionId: "hws_test",
      size: { height: 844, width: 392 },
    });
    expect(
      mocks.scheduleHostedWebSessionComputerHandoffViewportApply,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      reason: "measured",
      sessionId: "hws_test",
      token: "handoff-token",
    });
  });

  it("does not schedule background apply for stale viewport observations", async () => {
    mocks.saveHostedWebSessionComputerHandoffViewportSize.mockResolvedValueOnce(false);

    const response = await computerHandoffViewportRoute.POST(
      new Request("https://join.example.test/api/computer/handoff/handoff-token/viewport", {
        body: JSON.stringify({
          height: 844,
          observedAt: "2026-06-29T12:00:00.000Z",
          width: 390,
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );

    expect(response.status).toBe(202);
    expect(mocks.saveHostedWebSessionComputerHandoffViewportSize).toHaveBeenCalledOnce();
    expect(
      mocks.scheduleHostedWebSessionComputerHandoffViewportApply,
    ).not.toHaveBeenCalled();
  });

  it("rejects invalid measured handoff viewport bodies", async () => {
    const response = await computerHandoffViewportRoute.POST(
      new Request("https://join.example.test/api/computer/handoff/handoff-token/viewport", {
        body: JSON.stringify({
          height: "844",
          observedAt: "2026-06-29T12:00:00.000Z",
          width: 390,
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.saveHostedWebSessionComputerHandoffViewportSize).not.toHaveBeenCalled();
    expect(
      mocks.scheduleHostedWebSessionComputerHandoffViewportApply,
    ).not.toHaveBeenCalled();
  });

  it("clamps future measured handoff viewport observations to server time", async () => {
    const beforeRequestMs = Date.now();
    const response = await computerHandoffViewportRoute.POST(
      new Request("https://join.example.test/api/computer/handoff/handoff-token/viewport", {
        body: JSON.stringify({
          height: 844,
          observedAt: new Date(beforeRequestMs + 60_000).toISOString(),
          width: 390,
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      createRouteContext({ token: "handoff-token" }),
    );
    const afterRequestMs = Date.now();

    expect(response.status).toBe(202);
    const savedInput = mocks.saveHostedWebSessionComputerHandoffViewportSize.mock
      .calls[0]?.[0];
    expect(savedInput).toMatchObject({
      memberId: "member_123",
      sessionId: "hws_test",
      size: { height: 844, width: 392 },
    });
    expect(savedInput.observedAt.getTime()).toBeGreaterThanOrEqual(beforeRequestMs);
    expect(savedInput.observedAt.getTime()).toBeLessThanOrEqual(afterRequestMs);
    expect(
      mocks.scheduleHostedWebSessionComputerHandoffViewportApply,
    ).toHaveBeenCalledWith({
      memberId: "member_123",
      reason: "measured",
      sessionId: "hws_test",
      token: "handoff-token",
    });
  });

});


function createSession(input: {
  computerHandoffViewportSize?: { height: number; width: number } | null;
} = {}) {
  return {
    computerHandoffViewportSize: input.computerHandoffViewportSize ?? null,
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
