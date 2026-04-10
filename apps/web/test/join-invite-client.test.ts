import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedInviteStatus: vi.fn(),
  hostedInvitePhoneAuthProps: null as Record<string, unknown> | null,
  logout: vi.fn(),
  useHostedInviteStatusRefresh: vi.fn(),
  usePrivy: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: mocks.usePrivy,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-invite-phone-auth", () => ({
  HostedInvitePhoneAuth(props: Record<string, unknown>) {
    mocks.hostedInvitePhoneAuthProps = props;
    return createElement(
      "div",
      {
        "data-hosted-invite-phone-auth": "true",
      },
      "Hosted invite phone auth",
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/invite-status-client", () => ({
  fetchHostedInviteStatus: mocks.fetchHostedInviteStatus,
  useHostedInviteStatusRefresh: mocks.useHostedInviteStatusRefresh,
}));

import {
  JoinInviteClient,
  resolveInviteStatusAfterPrivyCompletion,
  resolveJoinInviteStatusFromRefresh,
  resolveJoinInviteShareStateFromAccept,
  resolveJoinInviteShareStateFromStatus,
  shouldAwaitHostedInviteSessionResolution,
} from "@/src/components/hosted-onboarding/join-invite-client";
import type { HostedSharePageData } from "@/src/lib/hosted-share/service";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

const activeJoinInviteClientCleanups = new Set<() => Promise<void> | void>();
const requireFromJoinInviteClientTest = createRequire(import.meta.url);
const { parseHTML } = loadJoinInviteClientLinkedom();

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.hostedInvitePhoneAuthProps = null;
  mocks.usePrivy.mockReturnValue({
    logout: mocks.logout,
  });
  mocks.useHostedInviteStatusRefresh.mockImplementation(() => {});
});

afterEach(async () => {
  for (const cleanup of [...activeJoinInviteClientCleanups].reverse()) {
    await cleanup();
  }
  activeJoinInviteClientCleanups.clear();
});

test("verify-stage invite copy stays neutral and does not expose the masked phone hint", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
      inviteCode: "invite-code",
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.match(markup, /Text signup/);
  assert.match(markup, /Verify the number that messaged Murph to finish joining\./);
  assert.doesNotMatch(markup, /What happens next/);
  assert.doesNotMatch(markup, /Invite for/);
  assert.doesNotMatch(markup, /\+1 415 555 2671/);
  assert.match(markup, /data-hosted-invite-phone-auth="true"/);
});

test("verify-stage invite shows the hosted session check while the server session is still settling", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: false,
        },
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
      inviteCode: "invite-code",
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.match(markup, /Checking your signup state/);
  assert.match(markup, /One moment while we pick up your hosted session\./);
  assert.doesNotMatch(markup, /data-hosted-invite-phone-auth=/);
});

test("verify-stage invite keeps polling while the hosted session is still settling", () => {
  renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: false,
        },
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
      inviteCode: "invite-code",
      shareCode: null,
      sharePreview: null,
    }),
  );

  expect(mocks.useHostedInviteStatusRefresh).toHaveBeenCalledWith(expect.objectContaining({
    inviteCode: "invite-code",
    shouldPoll: true,
  }));
});

test("checkout stage does not auto-launch on an ordinary invite load", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects({
    initialStatus: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });

  expect(fetchMock).not.toHaveBeenCalled();
  expect(view.locationAssign).not.toHaveBeenCalled();

  await view.cleanup();
});

test("phone verification auto-launches checkout exactly once when checkout is next", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({
      alreadyActive: false,
      url: "https://stripe.example.test/checkout",
    }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects();
  const onCompleted = readHostedInvitePhoneAuthOnCompleted();

  await act(async () => {
    await onCompleted(createCompletionPayload("checkout"));
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/billing/checkout", expect.objectContaining({
    body: JSON.stringify({
      inviteCode: "invite-code",
      shareCode: null,
    }),
    method: "POST",
  }));
  expect(view.locationAssign).toHaveBeenCalledTimes(1);
  expect(view.locationAssign).toHaveBeenCalledWith("https://stripe.example.test/checkout");

  await view.cleanup();
});

test("stale invite status refreshes do not block an armed auto checkout launch", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({
      alreadyActive: false,
      url: "https://stripe.example.test/race-proof",
    }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects();
  const onCompleted = readHostedInvitePhoneAuthOnCompleted();
  const onStatus = readHostedInviteStatusRefreshOnStatus();

  await act(async () => {
    await onCompleted(createCompletionPayload("checkout"));
    onStatus(createStatus({
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
    }));
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(view.locationAssign).toHaveBeenCalledWith("https://stripe.example.test/race-proof");

  await view.cleanup();
});

test("failed auto checkout falls back to the manual checkout button", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        message: "Checkout unavailable.",
      },
    }), {
      status: 503,
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      alreadyActive: false,
      url: "https://stripe.example.test/retry",
    }), {
      status: 200,
    }));
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects();
  const onCompleted = readHostedInvitePhoneAuthOnCompleted();

  await act(async () => {
    await onCompleted(createCompletionPayload("checkout"));
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(view.locationAssign).not.toHaveBeenCalled();
  assert.match(view.container.innerHTML, /Checkout unavailable\./);

  const checkoutButton = view.container.querySelector("button");
  assert.ok(checkoutButton);
  assert.match(checkoutButton.textContent ?? "", /Continue to Apple Pay/);
  assert.equal(checkoutButton.hasAttribute("disabled"), false);

  await act(async () => {
    checkoutButton.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(view.locationAssign).toHaveBeenCalledWith("https://stripe.example.test/retry");

  await view.cleanup();
});

test("stale verify refreshes still leave the manual checkout fallback available after an auto-launch failure", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        message: "Checkout unavailable.",
      },
    }), {
      status: 503,
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      alreadyActive: false,
      url: "https://stripe.example.test/recovered",
    }), {
      status: 200,
    }));
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects();
  const onCompleted = readHostedInvitePhoneAuthOnCompleted();
  const onStatus = readHostedInviteStatusRefreshOnStatus();

  await act(async () => {
    await onCompleted(createCompletionPayload("checkout"));
    onStatus(createStatus({
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
    }));
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(view.locationAssign).not.toHaveBeenCalled();

  const checkoutButton = view.container.querySelector("button");
  assert.ok(checkoutButton);
  assert.match(checkoutButton.textContent ?? "", /Continue to Apple Pay/);

  await act(async () => {
    checkoutButton.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(view.locationAssign).toHaveBeenCalledWith("https://stripe.example.test/recovered");

  await view.cleanup();
});

test("already-active checkout refreshes preserve the current stage when the returned verify payload is only stale", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({
      alreadyActive: true,
      url: null,
    }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  mocks.fetchHostedInviteStatus.mockResolvedValue(createStatus({
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
  }));

  const view = await renderJoinInviteClientForEffects({
    initialStatus: createStatus({
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });
  const checkoutButton = view.container.querySelector("button");
  assert.ok(checkoutButton);

  await act(async () => {
    checkoutButton.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(mocks.fetchHostedInviteStatus).toHaveBeenCalledTimes(1);
  assert.match(view.container.textContent ?? "", /One last step/);
  assert.match(view.container.textContent ?? "", /Continue to Apple Pay/);

  await view.cleanup();
});

test("already-active checkout refreshes return to verify when the invite session is actually gone", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({
      alreadyActive: true,
      url: null,
    }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  mocks.fetchHostedInviteStatus.mockResolvedValue(createStatus({
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
  }));

  const view = await renderJoinInviteClientForEffects({
    initialStatus: createStatus({
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });
  const checkoutButton = view.container.querySelector("button");
  assert.ok(checkoutButton);

  await act(async () => {
    checkoutButton.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(mocks.fetchHostedInviteStatus).toHaveBeenCalledTimes(1);
  assert.match(view.container.textContent ?? "", /Finish joining Murph/);
  assert.match(view.container.textContent ?? "", /Hosted invite phone auth/);

  await view.cleanup();
});

test("active invite state links to hosted settings with client navigation markup", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
        stage: "active",
      }),
      inviteCode: "invite-code",
      shareCode: null,
      sharePreview: null,
    }),
  );

  assert.ok(markup.includes('href="/settings"'));
  assert.match(markup, /Manage settings/);
});

test("activating invite state explains that payment finished and setup is still running", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
        stage: "activating",
      }),
      inviteCode: "invite-code",
      shareCode: "share-code",
      sharePreview: {
        kinds: ["food"],
        counts: {
          foods: 1,
          protocols: 0,
          recipes: 0,
          total: 1,
        },
        logMealAfterImport: false,
      },
    }),
  );

  assert.match(markup, /We’re setting up your account/);
  assert.match(markup, /Payment received\. We&#x27;re setting up your account\./);
  assert.match(markup, /We&#x27;ll add your shared bundle after setup finishes\./);
});

test("invite share preview renders the generic bundle copy from the tiny summary", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialStatus: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
      inviteCode: "invite-code",
      shareCode: "share-code",
      sharePreview: {
        kinds: ["food", "recipe"],
        counts: {
          foods: 1,
          protocols: 0,
          recipes: 1,
          total: 2,
        },
        logMealAfterImport: true,
      },
    }),
  );

  assert.match(markup, /Add after signup: Shared bundle/);
  assert.match(markup, /1 food · 1 recipe/);
  assert.match(markup, /Murph will also log the shared food after import\./);
});

test("pending share acceptance stays in processing instead of announcing success", () => {
  assert.equal(
    resolveJoinInviteShareStateFromAccept({
      alreadyImported: false,
      imported: false,
      pending: true,
    }),
    "processing",
  );
});

test("share status only resolves to completed after the async import is consumed", () => {
  assert.equal(
    resolveJoinInviteShareStateFromStatus(createShareStatus("processing")),
    "processing",
  );
  assert.equal(
    resolveJoinInviteShareStateFromStatus(createShareStatus("consumed")),
    "completed",
  );
});

test("resolveInviteStatusAfterPrivyCompletion marks the invite session authenticated and matched", () => {
  const nextStatus = resolveInviteStatusAfterPrivyCompletion(
    createStatus({
      stage: "verify",
    }),
    createCompletionPayload("checkout"),
  );

  expect(nextStatus).toMatchObject({
    session: {
      authenticated: true,
      matchesInvite: true,
    },
    stage: "checkout",
  });
});

test("verified invite sessions do not regress back to verify during later status refreshes", () => {
  const refreshedStatus = resolveJoinInviteStatusFromRefresh({
    nextStatus: createStatus({
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
    }),
    status: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });

  expect(refreshedStatus).toMatchObject({
    session: {
      authenticated: true,
      matchesInvite: true,
    },
    stage: "checkout",
  });
});

test("verify refreshes with a signed-out session are not masked as stale", () => {
  const refreshedStatus = resolveJoinInviteStatusFromRefresh({
    nextStatus: createStatus({
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      session: {
        authenticated: false,
        expiresAt: null,
        matchesInvite: false,
      },
    }),
    status: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "checkout",
    }),
  });

  expect(refreshedStatus).toMatchObject({
    session: {
      authenticated: false,
      matchesInvite: false,
    },
    stage: "verify",
  });
});

test("verify-stage auth-settling guard only holds until the first hosted refresh completes", () => {
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      hasCompletedInitialRefresh: false,
      status: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: false,
        },
      }),
    }),
    true,
  );
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      hasCompletedInitialRefresh: true,
      status: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
      }),
    }),
    false,
  );
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      hasCompletedInitialRefresh: false,
      status: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
        session: {
          authenticated: false,
          expiresAt: null,
          matchesInvite: false,
        },
      }),
    }),
    true,
  );
  assert.equal(
    shouldAwaitHostedInviteSessionResolution({
      hasCompletedInitialRefresh: true,
      status: createStatus({
        session: {
          authenticated: true,
          expiresAt: null,
          matchesInvite: true,
        },
      }),
    }),
    false,
  );
});

function createStatus(
  overrides: Partial<HostedInviteStatusPayload> & {
    capabilities?: Partial<HostedInviteStatusPayload["capabilities"]>;
  },
): HostedInviteStatusPayload {
  return {
    capabilities: {
      billingReady: true,
      phoneAuthReady: false,
      ...overrides.capabilities,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneHint: "+1 415 555 2671",
    },
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    stage: "verify",
    ...overrides,
  };
}

function createShareStatus(stage: HostedSharePageData["stage"]): HostedSharePageData {
  return {
    inviteCode: "invite-code",
    session: {
      active: true,
      authenticated: true,
    },
    share: {
      acceptedByCurrentMember: true,
      consumed: stage === "consumed",
      expiresAt: "2026-03-27T12:00:00.000Z",
      preview: {
        kinds: ["food"],
        counts: {
          foods: 1,
          protocols: 0,
          recipes: 0,
          total: 1,
        },
        logMealAfterImport: false,
      },
    },
    stage,
  };
}

function createCompletionPayload(stage: HostedPrivyCompletionPayload["stage"]): HostedPrivyCompletionPayload {
  return {
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage,
  };
}

async function renderJoinInviteClientForEffects(input?: {
  initialStatus?: HostedInviteStatusPayload;
}) {
  const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const locationAssign = vi.fn();
  const cleanupGlobals = installJoinInviteClientGlobals(window, document, locationAssign);
  activeJoinInviteClientCleanups.add(cleanupGlobals);
  const container = document.getElementById("root");
  assert.ok(container);

  let root: Root | null = createRoot(container);

  await act(async () => {
    root?.render(
      createElement(JoinInviteClient, {
        initialStatus: input?.initialStatus ?? createStatus({
          capabilities: {
            billingReady: true,
            phoneAuthReady: true,
          },
        }),
        inviteCode: "invite-code",
        shareCode: null,
        sharePreview: null,
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
      activeJoinInviteClientCleanups.delete(cleanupGlobals);
    },
    container,
    locationAssign,
    window,
  };
}

function installJoinInviteClientGlobals(
  window: Record<string, unknown>,
  document: Record<string, unknown>,
  locationAssign: ReturnType<typeof vi.fn>,
) {
  const location = {
    assign: locationAssign,
  };
  const restoreEntries = [
    setJoinInviteClientGlobal("window", window),
    setJoinInviteClientGlobal("document", document),
    setJoinInviteClientGlobal("location", location as Location),
    setJoinInviteClientGlobal("navigator", window.navigator),
    setJoinInviteClientGlobal("HTMLElement", window.HTMLElement),
    setJoinInviteClientGlobal("Node", window.Node),
    setJoinInviteClientGlobal("Event", window.Event),
    setJoinInviteClientGlobal("MutationObserver", window.MutationObserver),
    setJoinInviteClientGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }),
    setJoinInviteClientGlobal("cancelAnimationFrame", () => {}),
    setJoinInviteClientGlobal("IS_REACT_ACT_ENVIRONMENT", true),
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

function setJoinInviteClientGlobal<K extends keyof typeof globalThis>(key: K, value: (typeof globalThis)[K]) {
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

function readHostedInvitePhoneAuthOnCompleted() {
  const onCompleted = mocks.hostedInvitePhoneAuthProps?.onCompleted;
  assert.equal(typeof onCompleted, "function");
  return onCompleted as (payload: HostedPrivyCompletionPayload) => Promise<void>;
}

function readHostedInviteStatusRefreshOnStatus() {
  const latestCall = mocks.useHostedInviteStatusRefresh.mock.lastCall?.[0];
  const onStatus = latestCall?.onStatus;
  assert.equal(typeof onStatus, "function");
  return onStatus as (payload: HostedInviteStatusPayload) => void;
}

function loadJoinInviteClientLinkedom(): {
  parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
} {
  const resolvePaths = [
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "node_modules/.pnpm/node_modules"),
  ];

  for (const resolvePath of resolvePaths) {
    try {
      const resolvedEntry = requireFromJoinInviteClientTest.resolve("linkedom", {
        paths: [resolvePath],
      });
      return requireFromJoinInviteClientTest(resolvedEntry) as {
        parseHTML: (html: string) => { document: Document; window: Window & typeof globalThis };
      };
    } catch {
      // Try the next resolution root.
    }
  }

  throw new Error("Unable to resolve linkedom for join invite client effect tests.");
}
