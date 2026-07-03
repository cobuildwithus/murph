import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act } from "react";
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  useHostedInviteStatusRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.routerReplace,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/invite-status-client", () => ({
  useHostedInviteStatusRefresh: mocks.useHostedInviteStatusRefresh,
}));

vi.mock("next/link", () => ({
  default(props: { children?: ReactNode; href: string }) {
    return createElement("a", {
      href: props.href,
    }, props.children);
  },
}));

import { JoinInviteSuccessClient } from "@/src/components/hosted-onboarding/join-invite-success-client";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";

const activeJoinInviteSuccessClientCleanups = new Set<() => Promise<void> | void>();
const requireFromJoinInviteSuccessClientTest = createRequire(import.meta.url);
const { parseHTML } = loadJoinInviteSuccessClientLinkedom();

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.useHostedInviteStatusRefresh.mockImplementation(() => {});
});

afterEach(async () => {
  for (const cleanup of [...activeJoinInviteSuccessClientCleanups].reverse()) {
    await cleanup();
  }
  activeJoinInviteSuccessClientCleanups.clear();
  vi.useRealTimers();
});

test("verify-stage success page keeps the copy neutral while verification settles", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteSuccessClient, {
      initialStatus: createStatus("verify"),
      inviteCode: "invite-code",
      sessionId: null,
    }),
  );

  assert.match(markup, /Finishing verification/);
  assert.match(markup, /Checking your signup status\./);
  assert.doesNotMatch(markup, /Payment received/);
  assert.match(markup, /Back to invite/);
});

test("blocked success page does not pretend setup is still running", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteSuccessClient, {
      initialStatus: createStatus("blocked"),
      inviteCode: "invite-code",
      sessionId: null,
    }),
  );

  assert.match(markup, /Account blocked/);
  assert.match(markup, /Head back to your invite for next steps\./);
  assert.doesNotMatch(markup, /Payment received/);
  assert.doesNotMatch(markup, /We&#x27;ll keep checking automatically/);
});

test("activating success page explains when vault and assistant setup is still running", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteSuccessClient, {
      initialStatus: createStatus("activating"),
      inviteCode: "invite-code",
      sessionId: null,
    }),
  );

  assert.match(markup, /Finishing your setup/);
  assert.match(markup, /Payment confirmed\./);
  assert.match(markup, /Setup finishes in about ten seconds/);
  assert.match(markup, /We&#x27;ll keep checking automatically/);
});

test("checkout-stage success page stays blank while the returned session is being verified", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteSuccessClient, {
      initialStatus: createStatus("checkout"),
      inviteCode: "invite-code",
      sessionId: "cs_123",
    }),
  );

  assert.equal(markup, "");
  assert.doesNotMatch(markup, /Payment received/);
  assert.doesNotMatch(markup, /Private by default/);
});

test("checkout-stage success page reconciles the returned session once and redirects home when active", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createStatus("active")), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteSuccessClientForEffects();
  await act(async () => {});

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/billing/success", expect.objectContaining({
    body: JSON.stringify({
      inviteCode: "invite-code",
      sessionId: "cs_123",
    }),
    method: "POST",
  }));
  expect(view.routerReplace).toHaveBeenCalledWith("/home?initialVisit=true");
  expect(view.locationAssign).not.toHaveBeenCalled();

  await view.cleanup();
});

test("checkout-stage success page waits for returned session reconciliation before opening home", async () => {
  let resolveFetch!: (response: Response) => void;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteSuccessClientForEffects({
    initialStatus: createStatus("checkout"),
  });
  await act(async () => {});

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(view.routerReplace).not.toHaveBeenCalled();
  expect(view.container.textContent ?? "").toBe("");

  resolveFetch(
    new Response(JSON.stringify(createStatus("active")), {
      status: 200,
    }),
  );

  await act(async () => {});

  expect(view.routerReplace).toHaveBeenCalledWith("/home?initialVisit=true");

  await view.cleanup();
});

test("activating success page keeps waiting when returned session reconciliation is still pending", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createStatus("activating")), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteSuccessClientForEffects({
    initialStatus: createStatus("activating"),
  });
  await act(async () => {});

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/billing/success", expect.objectContaining({
    body: JSON.stringify({
      inviteCode: "invite-code",
      sessionId: "cs_123",
    }),
    method: "POST",
  }));
  expect(view.routerReplace).not.toHaveBeenCalled();

  await view.cleanup();
});

test("active success page reconciles the returned session when the invite is already active", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createStatus("active")), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteSuccessClientForEffects({
    initialStatus: createStatus("active"),
  });
  await act(async () => {});

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/billing/success", expect.objectContaining({
    body: JSON.stringify({
      inviteCode: "invite-code",
      sessionId: "cs_123",
    }),
    method: "POST",
  }));
  expect(view.routerReplace).toHaveBeenCalledWith("/home?initialVisit=true");

  await view.cleanup();
});

test("active success page redirects home without waiting for returned session reconciliation", async () => {
  let resolveFetch!: (response: Response) => void;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteSuccessClientForEffects({
    initialStatus: createStatus("active"),
  });
  await act(async () => {});

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(view.routerReplace).toHaveBeenCalledWith("/home?initialVisit=true");
  expect(view.container.textContent ?? "").toBe("");

  resolveFetch(
    new Response(JSON.stringify(createStatus("active")), {
      status: 200,
    }),
  );

  await act(async () => {});

  expect(view.routerReplace).toHaveBeenCalledTimes(1);

  await view.cleanup();
});

test("active success page redirects home even when returned session reconciliation fails", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("Stripe unavailable"));
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteSuccessClientForEffects({
    initialStatus: createStatus("active"),
  });
  await flushJoinInviteSuccessClientEffects();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(view.routerReplace).toHaveBeenCalledWith("/home?initialVisit=true");

  await view.cleanup();
});

test("pending success page shows email support after the setup delay", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createStatus("activating")), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteSuccessClientForEffects({
    initialStatus: createUnmatchedStatus("activating"),
  });
  await act(async () => {});

  assert.doesNotMatch(view.container.textContent ?? "", /Setup is taking longer than expected/);

  await act(async () => {
    vi.advanceTimersByTime(59_999);
  });

  assert.doesNotMatch(view.container.textContent ?? "", /Setup is taking longer than expected/);

  await act(async () => {
    vi.advanceTimersByTime(1);
  });

  assert.match(view.container.textContent ?? "", /Setup is taking longer than expected/);
  assert.match(view.container.textContent ?? "", /Support ready/);
  assert.match(view.container.textContent ?? "", /The draft already includes the details we need/);
  assert.match(view.container.textContent ?? "", /Email support/);

  const supportButton = findButtonByText(view.container, /Email support/);

  await act(async () => {
    supportButton.click();
  });

  expect(view.locationAssign).toHaveBeenCalledTimes(1);
  const mailtoHref = String(view.locationAssign.mock.calls[0]?.[0] ?? "");
  expect(mailtoHref).toContain("mailto:support@withmurph.ai");
  expect(mailtoHref).toContain("Invite%20code%3A%20invite-code");
  expect(mailtoHref).toContain("Current%20stage%3A%20activating");
  expect(mailtoHref).not.toContain("cs_123");

  await view.cleanup();
});

test("active success page redirects to home without a returned checkout session", async () => {
  const view = await renderJoinInviteSuccessClientForEffects({
    initialStatus: createStatus("active"),
    sessionId: null,
  });
  await flushJoinInviteSuccessClientEffects();

  expect(view.routerReplace).toHaveBeenCalledWith("/home?initialVisit=true");
  expect(view.locationAssign).not.toHaveBeenCalled();

  view.routerReplace.mockClear();
  const continueButton = findButtonByText(view.container, /Open home/);

  await act(async () => {
    continueButton.click();
  });

  expect(view.routerReplace).toHaveBeenCalledWith("/home?initialVisit=true");
  expect(view.locationAssign).not.toHaveBeenCalled();

  await view.cleanup();
});

test("active success page with an unmatched session keeps the invite fallback guarded", async () => {
  const activeStatus = createStatus("active");
  const view = await renderJoinInviteSuccessClientForEffects({
    initialStatus: {
      ...activeStatus,
      session: {
        ...activeStatus.session,
        authenticated: false,
        matchesInvite: false,
      },
    },
    sessionId: null,
  });
  await flushJoinInviteSuccessClientEffects();

  expect(view.routerReplace).not.toHaveBeenCalled();

  const continueButton = findButtonByText(view.container, /Open home/);

  await act(async () => {
    continueButton.click();
  });

  expect(view.locationAssign).toHaveBeenCalledWith("/join/invite-code");
  expect(view.routerReplace).not.toHaveBeenCalled();

  await view.cleanup();
});

test("preview active success page stays on the success page", async () => {
  const view = await renderJoinInviteSuccessClientForEffects({
    initialStatus: createStatus("active"),
    preview: true,
    sessionId: null,
  });
  await flushJoinInviteSuccessClientEffects();

  expect(view.routerReplace).not.toHaveBeenCalled();
  assert.match(view.container.textContent ?? "", /You’re all set/);
  assert.match(view.container.textContent ?? "", /Open home/);

  await view.cleanup();
});

async function flushJoinInviteSuccessClientEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createStatus(
  stage: HostedInviteStatusPayload["stage"],
): HostedInviteStatusPayload {
  return {
    billing: {
      defaultPlanCode: getHostedDefaultBillingPlanCode(),
      plans: listHostedBillingPlanPresentations(),
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "+1 415 555 2671",
      },
      phoneHint: "+1 415 555 2671",
      verificationMode: "invite_phone",
    },
    session: {
      authenticated: stage !== "verify",
      expiresAt: null,
      matchesInvite: stage !== "verify",
    },
    messagingSetupRequired: false,
    stage,
  };
}

function createUnmatchedStatus(
  stage: HostedInviteStatusPayload["stage"],
): HostedInviteStatusPayload {
  const status = createStatus(stage);

  return {
    ...status,
    session: {
      ...status.session,
      authenticated: false,
      matchesInvite: false,
    },
  };
}

async function renderJoinInviteSuccessClientForEffects(input?: {
  initialStatus?: HostedInviteStatusPayload;
  preview?: boolean;
  sessionId?: string | null;
}) {
  const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const locationAssign = vi.fn();
  const locationReplace = vi.fn();
  const cleanupGlobals = installJoinInviteSuccessClientGlobals(
    window,
    document,
    locationAssign,
    locationReplace,
  );
  activeJoinInviteSuccessClientCleanups.add(cleanupGlobals);
  const container = document.getElementById("root");
  assert.ok(container);

  let root: Root | null = createRoot(container);

  await act(async () => {
    root?.render(
      createElement(JoinInviteSuccessClient, {
        initialStatus: input?.initialStatus ?? createStatus("checkout"),
        inviteCode: "invite-code",
        preview: input?.preview ?? false,
        sessionId: input && "sessionId" in input ? (input.sessionId ?? null) : "cs_123",
      }),
    );
  });

  return {
    cleanup: async () => {
      await act(async () => {
        root?.unmount();
        root = null;
      });
      cleanupGlobals();
      activeJoinInviteSuccessClientCleanups.delete(cleanupGlobals);
    },
    container,
    locationAssign,
    locationReplace,
    routerReplace: mocks.routerReplace,
  };
}

function installJoinInviteSuccessClientGlobals(
  window: Window & typeof globalThis,
  document: Document,
  locationAssign: ReturnType<typeof vi.fn>,
  locationReplace: ReturnType<typeof vi.fn>,
) {
  const location = {
    ...window.location,
    assign: locationAssign,
    replace: locationReplace,
  };
  const restoreEntries = [
    setJoinInviteSuccessClientGlobal("window", window),
    setJoinInviteSuccessClientGlobal("self", window),
    setJoinInviteSuccessClientGlobal("document", document),
    setJoinInviteSuccessClientGlobal("location", location),
    setJoinInviteSuccessClientGlobal("navigator", window.navigator),
    setJoinInviteSuccessClientGlobal("HTMLElement", window.HTMLElement),
    setJoinInviteSuccessClientGlobal("Node", window.Node),
    setJoinInviteSuccessClientGlobal("Event", window.Event),
    setJoinInviteSuccessClientGlobal("MutationObserver", window.MutationObserver),
    setJoinInviteSuccessClientGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }),
    setJoinInviteSuccessClientGlobal("cancelAnimationFrame", () => {}),
    setJoinInviteSuccessClientGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 0,
      });
      return 0;
    }),
    setJoinInviteSuccessClientGlobal("cancelIdleCallback", () => {}),
    setJoinInviteSuccessClientGlobal("IS_REACT_ACT_ENVIRONMENT", true),
  ];

  Object.defineProperty(window, "location", {
    configurable: true,
    value: location,
  });

  return () => {
    for (const restore of restoreEntries.reverse()) {
      restore();
    }
  };
}

function setJoinInviteSuccessClientGlobal(key: string, value: unknown) {
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, key);
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, key);

  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (hadOwnProperty) {
      assert.ok(previousDescriptor);
      Object.defineProperty(globalThis, key, previousDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, key);
  };
}

function findButtonByText(container: Element, pattern: RegExp): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    pattern.test(candidate.textContent ?? ""),
  );
  assert.ok(button);
  return button as HTMLButtonElement;
}

function loadJoinInviteSuccessClientLinkedom(): {
  parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
} {
  const resolvePaths = [
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "node_modules/.pnpm/node_modules"),
  ];

  for (const resolvePath of resolvePaths) {
    try {
      const resolvedEntry = requireFromJoinInviteSuccessClientTest.resolve("linkedom", {
        paths: [resolvePath],
      });
      return requireFromJoinInviteSuccessClientTest(resolvedEntry) as {
        parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
      };
    } catch {
      // Try the next resolution root.
    }
  }

  throw new Error("Unable to resolve linkedom for join invite success client effect tests.");
}
