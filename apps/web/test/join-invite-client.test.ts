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
  resolveJoinInviteStatusFromRefresh,
  resolveJoinInviteShareStateFromAccept,
  resolveJoinInviteShareStateFromStatus,
  shouldAwaitHostedInviteSessionResolution,
} from "@/src/components/hosted-onboarding/join-invite-client";
import type { HostedSharePageData } from "@/src/lib/hosted-share/service";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";

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
      initialLinkedAccounts: [],
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

  assert.match(markup, /Murph signup/);
  assert.match(markup, /Verify the number you texted Murph from\./);
  assert.doesNotMatch(markup, /What happens next/);
  assert.doesNotMatch(markup, /Invite for/);
  assert.doesNotMatch(markup, /\+1 415 555 2671/);
  assert.match(markup, /data-hosted-invite-phone-auth="true"/);
});

test("verify-stage invite passes only the masked phone hint to phone auth", () => {
  renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialLinkedAccounts: [],
      initialStatus: createStatus({
        capabilities: {
          billingReady: true,
          phoneAuthReady: true,
        },
        invite: {
          code: "invite-code",
          expiresAt: "2026-03-27T12:00:00.000Z",
          phoneHint: "*** 2671",
        },
      }),
      inviteCode: "invite-code",
      shareCode: null,
      sharePreview: null,
    }),
  );

  expect(mocks.hostedInvitePhoneAuthProps).toMatchObject({
    inviteCode: "invite-code",
    phoneHint: "*** 2671",
  });
  expect(mocks.hostedInvitePhoneAuthProps).not.toHaveProperty("initialPhoneNumber");
});

test("verify-stage invite shows the session check while the server session is still settling", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialLinkedAccounts: [],
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
  assert.match(markup, /One moment while we pick up your session\./);
  assert.doesNotMatch(markup, /data-hosted-invite-phone-auth=/);
});

test("verify-stage invite keeps polling while the session is still settling", () => {
  renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialLinkedAccounts: [],
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

test("phone verification returns to the checkout plan picker without auto-launching Stripe", async () => {
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

  expect(mocks.fetchHostedInviteStatus).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(view.locationAssign).not.toHaveBeenCalled();
  assert.match(view.container.textContent ?? "", /Choose your plan/);
  assert.match(view.container.textContent ?? "", /Continue to checkout/);

  await view.cleanup();
});

test("phone verification keeps checkout hidden until the server confirms invite auth", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects();
  const onCompleted = readHostedInvitePhoneAuthOnCompleted();

  await act(async () => {
    await onCompleted(createCompletionPayload("checkout", {
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      session: {
        authenticated: false,
        expiresAt: null,
        matchesInvite: false,
      },
      stage: "verify",
    }));
  });

  expect(mocks.fetchHostedInviteStatus).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(view.locationAssign).not.toHaveBeenCalled();
  assert.doesNotMatch(view.container.textContent ?? "", /Continue to checkout/);
  assert.match(view.container.textContent ?? "", /Confirm your number/);
  assert.match(view.container.textContent ?? "", /Hosted invite phone auth/);

  await view.cleanup();
});

test("stale invite status refreshes preserve the checkout plan picker", async () => {
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

  expect(fetchMock).not.toHaveBeenCalled();
  expect(view.locationAssign).not.toHaveBeenCalled();
  assert.match(view.container.textContent ?? "", /Choose your plan/);
  assert.match(view.container.textContent ?? "", /Continue to checkout/);

  await view.cleanup();
});

test("manual checkout surfaces API errors and can retry", async () => {
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
    shareCode: "share-code",
  });
  const checkoutButton = findButtonByText(view.container, /Continue to checkout/);

  expect(fetchMock).toHaveBeenCalledTimes(0);
  expect(view.locationAssign).not.toHaveBeenCalled();
  assert.equal(checkoutButton.hasAttribute("disabled"), false);

  await act(async () => {
    checkoutButton.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/hosted-onboarding/billing/checkout", expect.objectContaining({
    body: JSON.stringify({
      billingPlanCode: "launch_monthly",
      inviteCode: "invite-code",
      shareCode: "share-code",
    }),
    method: "POST",
  }));
  assert.match(view.container.innerHTML, /Checkout unavailable\./);
  assert.equal(checkoutButton.hasAttribute("disabled"), false);

  await act(async () => {
    checkoutButton.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(view.locationAssign).toHaveBeenCalledWith("https://stripe.example.test/retry");

  await view.cleanup();
});

test("stale verify refreshes still leave the manual checkout fallback available after a checkout failure", async () => {
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
  const onStatus = readHostedInviteStatusRefreshOnStatus();
  const checkoutButton = findButtonByText(view.container, /Continue to checkout/);

  await act(async () => {
    checkoutButton.click();
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
  assert.match(checkoutButton.textContent ?? "", /Continue to checkout/);

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
  const checkoutButton = findButtonByText(view.container, /Continue to checkout/);

  await act(async () => {
    checkoutButton.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(mocks.fetchHostedInviteStatus).toHaveBeenCalledTimes(1);
  assert.match(view.container.textContent ?? "", /One last step/);
  assert.match(view.container.textContent ?? "", /Choose your plan/);

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
  const checkoutButton = findButtonByText(view.container, /Continue to checkout/);

  await act(async () => {
    checkoutButton.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(mocks.fetchHostedInviteStatus).toHaveBeenCalledTimes(1);
  assert.match(view.container.textContent ?? "", /Confirm your number/);
  assert.match(view.container.textContent ?? "", /Hosted invite phone auth/);

  await view.cleanup();
});

test("active invite state renders message and settings actions with client navigation markup", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialLinkedAccounts: [],
      initialStatus: createStatus({
        murphPhoneNumber: "+15550100001",
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

  assert.match(markup, /Murph will text you shortly\. Reply to start\./);
  assert.ok(markup.includes('href="sms:+15550100001"'));
  assert.match(markup, /Text Murph/);
  assert.ok(markup.includes('download="Murph.vcf"'));
  assert.match(markup, /Add Murph to Contacts/);
  assert.ok(markup.includes('href="/experiments"'));
  assert.match(markup, /View experiments/);
});

test("active invite state omits Murph contact actions when no assigned number is available", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialLinkedAccounts: [],
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

  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /Add Murph to Contacts/);
  assert.ok(markup.includes('href="/experiments"'));
});

test("activating invite state explains when vault and assistant setup is still running", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialLinkedAccounts: [],
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
          recipes: 0,
          regimens: 0,
          total: 1,
        },
        logMealAfterImport: false,
      },
    }),
  );

  assert.match(markup, /Finishing your setup/);
  assert.match(markup, /Setup finishes in about ten seconds\./);
  assert.match(markup, /Setting up your vault and assistant/);
  assert.match(markup, /This takes about ten seconds\. We’ll update here when it’s done\./);
  assert.match(markup, /We’ll add your shared bundle once setup finishes\./);
});

test("invite share preview renders the generic bundle copy from the tiny summary", () => {
  const markup = renderToStaticMarkup(
    createElement(JoinInviteClient, {
      initialLinkedAccounts: [],
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
          recipes: 1,
          regimens: 0,
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
    false,
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
    billing: {
      defaultPlanCode: getHostedDefaultBillingPlanCode(),
      plans: listHostedBillingPlanPresentations(),
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: false,
      ...overrides.capabilities,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneHint: "*** 2671",
    },
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    ...overrides,
    messagingSetupRequired: overrides.messagingSetupRequired ?? false,
    stage: overrides.stage ?? "verify",
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
          recipes: 0,
          regimens: 0,
          total: 1,
        },
        logMealAfterImport: false,
      },
    },
    stage,
  };
}

function createCompletionPayload(
  stage: HostedPrivyCompletionPayload["stage"],
  statusOverrides?: Partial<HostedInviteStatusPayload> & {
    capabilities?: Partial<HostedInviteStatusPayload["capabilities"]>;
  },
): HostedPrivyCompletionPayload {
  return {
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    messagingSetupRequired: false,
    stage,
    status: createStatus({
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage,
      ...statusOverrides,
    }),
  };
}

async function renderJoinInviteClientForEffects(input?: {
  initialStatus?: HostedInviteStatusPayload;
  shareCode?: string | null;
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
        initialLinkedAccounts: [],
        initialStatus: input?.initialStatus ?? createStatus({
          capabilities: {
            billingReady: true,
            phoneAuthReady: true,
          },
        }),
        inviteCode: "invite-code",
        shareCode: input?.shareCode ?? null,
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
  window: Window & typeof globalThis,
  document: Document,
  locationAssign: ReturnType<typeof vi.fn>,
) {
  const location = {
    assign: locationAssign,
  };
  const restoreEntries = [
    setJoinInviteClientGlobal("window", window),
    setJoinInviteClientGlobal("document", document),
    setJoinInviteClientGlobal("location", location),
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

function setJoinInviteClientGlobal(key: string, value: unknown) {
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

function findButtonByText(container: Element, pattern: RegExp): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    pattern.test(candidate.textContent ?? ""),
  );
  assert.ok(button);
  return button as HTMLButtonElement;
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
