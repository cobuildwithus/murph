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
  hostedLegalConsentCardProps: null as HostedLegalConsentCardProps | null,
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

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => ({
  HostedPhoneAuth() {
    return createElement(
      "div",
      {
        "data-hosted-phone-auth": "true",
      },
      "Hosted phone auth",
    );
  },
}));

vi.mock("@/src/components/settings/hosted-telegram-settings", () => ({
  ConnectTelegram() {
    return createElement(
      "div",
      {
        "data-connect-telegram": "true",
      },
      "Connect Telegram",
    );
  },
}));

vi.mock("@/src/components/legal/hosted-legal-consent-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/components/legal/hosted-legal-consent-card")>();

  return {
    ...actual,
    HostedLegalConsentCard(
      props: Parameters<typeof actual.HostedLegalConsentCard>[0],
    ) {
      mocks.hostedLegalConsentCardProps = props;
      return actual.HostedLegalConsentCard(props);
    },
  };
});

vi.mock("@/src/components/hosted-onboarding/invite-status-client", () => ({
  fetchHostedInviteStatus: mocks.fetchHostedInviteStatus,
  useHostedInviteStatusRefresh: mocks.useHostedInviteStatusRefresh,
}));

import {
  JoinInviteClient,
  resolveJoinInviteStatusFromRefresh,
  shouldAwaitHostedInviteSessionResolution,
} from "@/src/components/hosted-onboarding/join-invite-client";
import { JoinInviteStageContent } from "@/src/components/hosted-onboarding/join-invite-sections";
import type { HostedLegalConsentCard as HostedLegalConsentCardComponent } from "@/src/components/legal/hosted-legal-consent-card";
import type { HostedInviteStatusPayload, HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import {
  getHostedDefaultBillingPlanCode,
  listHostedBillingPlanPresentations,
} from "@/src/lib/hosted-onboarding/billing-plans";

const activeJoinInviteClientCleanups = new Set<() => Promise<void> | void>();
const requireFromJoinInviteClientTest = createRequire(import.meta.url);
const { parseHTML } = loadJoinInviteClientLinkedom();
type HostedLegalConsentCardProps = Parameters<typeof HostedLegalConsentCardComponent>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.hostedLegalConsentCardProps = null;
  mocks.hostedInvitePhoneAuthProps = null;
  mocks.usePrivy.mockReturnValue({
    authenticated: true,
    logout: mocks.logout,
    ready: true,
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
    }),
  );

  assert.match(markup, /Chat with Murph/);
  assert.doesNotMatch(markup, /Murph signup/);
  assert.match(markup, /Verify your phone/);
  assert.match(markup, /Use the number that received this join link\./);
  assert.doesNotMatch(markup, /Telegram/);
  assert.doesNotMatch(markup, /What happens next/);
  assert.doesNotMatch(markup, /Invite for/);
  assert.doesNotMatch(markup, /\+1 415 555 2671/);
  assert.match(markup, /data-hosted-invite-phone-auth="true"/);
});

test("verify-stage manual phone fallback still keeps Telegram out of verification", () => {
  const markup = renderToStaticMarkup(
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
          phoneAuthTarget: {
            kind: "manual",
          },
          phoneHint: null,
          verificationMode: "manual_phone",
        },
      }),
      inviteCode: "invite-code",
    }),
  );

  assert.match(markup, /Add your phone/);
  assert.match(markup, /Add the phone number Murph should use for experiment check-ins\./);
  assert.match(markup, /data-hosted-invite-phone-auth="true"/);
  assert.doesNotMatch(markup, /Telegram/);
});

test("authenticated messaging setup keeps the phone and Telegram channel picker", () => {
  const status = createStatus({
    messagingSetupRequired: true,
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage: "checkout",
  });
  const markup = renderToStaticMarkup(
    createElement(JoinInviteStageContent, {
      awaitingInviteSessionResolution: false,
      initialLinkedAccounts: [],
      inviteCode: "invite-code",
      launchLegalConsentGateActive: false,
      launchLegalConsentSatisfied: true,
      status,
      statusRefreshErrorMessage: null,
      statusRefreshRetryPending: false,
      onCheckout: async () => {},
      onCheckoutError: () => {},
      onCheckoutSuccess: () => {},
      onLaunchLegalConsentSatisfied: async () => {},
      onPhoneVerified: async () => {},
      onRefreshStatus: async () => status,
      onRetryStatusRefresh: async () => {},
      onSelectBillingPlan: () => {},
      onSignOut: async () => {},
    }),
  );

  assert.match(markup, /Phone/);
  assert.match(markup, /Telegram/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /data-hosted-phone-auth="true"/);
  assert.doesNotMatch(markup, /data-hosted-invite-phone-auth="true"/);
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
          phoneAuthTarget: {
            kind: "saved",
            phoneHint: "*** 2671",
          },
          phoneHint: "*** 2671",
          verificationMode: "invite_phone",
        },
      }),
      inviteCode: "invite-code",
    }),
  );

  expect(mocks.hostedInvitePhoneAuthProps).toMatchObject({
    inviteCode: "invite-code",
    phoneHint: "*** 2671",
    phoneAuthTarget: {
      kind: "saved",
      phoneHint: "*** 2671",
    },
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
    }),
  );

  assert.match(markup, /Checking your signup state/);
  assert.match(markup, /One moment while we pick up your session\./);
  assert.doesNotMatch(markup, /Telegram/);
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
    }),
  );

  expect(mocks.useHostedInviteStatusRefresh).toHaveBeenCalledWith(expect.objectContaining({
    inviteCode: "invite-code",
    shouldPoll: true,
  }));
});

test("checkout stage does not auto-launch on an ordinary invite load", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }),
  );
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

  expect(view.locationAssign).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Start experimenting/);
    assert.match(view.container.textContent ?? "", /Get Pulse/);
  });
  expect(fetchMock).toHaveBeenCalledWith("/api/legal/consent/status", expect.objectContaining({
    method: "GET",
  }));

  await view.cleanup();
});

test("checkout stage keeps pricing hidden until launch legal consent is current", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createConsentStatus({ launchGranted: false })), {
      status: 200,
    }),
  );
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

  await vi.waitFor(() => {
    expect(mocks.hostedLegalConsentCardProps).toMatchObject({
      mode: "panel",
      preferredScope: "launch.legal",
      source: "join-invite-phone-verify",
    });
    assert.match(view.container.textContent ?? "", /Before you start/);
  });

  assert.doesNotMatch(view.container.textContent ?? "", /Get Pulse/);
  expect(view.locationAssign).not.toHaveBeenCalled();

  await view.cleanup();
});

test("phone verification at checkout pauses on launch legal consent before pricing", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createConsentStatus({ launchGranted: false })), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects();
  const onCompleted = readHostedInvitePhoneAuthOnCompleted();

  await act(async () => {
    await onCompleted(createCompletionPayload("checkout"));
  });

  await vi.waitFor(() => {
    expect(mocks.hostedLegalConsentCardProps).toMatchObject({
      mode: "panel",
      preferredScope: "launch.legal",
      source: "join-invite-phone-verify",
    });
    assert.match(view.container.textContent ?? "", /One quick step/);
    assert.match(view.container.textContent ?? "", /Before you start/);
  });

  assert.doesNotMatch(view.container.textContent ?? "", /Get Pulse/);
  expect(mocks.fetchHostedInviteStatus).not.toHaveBeenCalled();
  expect(view.locationAssign).not.toHaveBeenCalled();

  await view.cleanup();
});

test.each(["checkout", "activating", "active"] as const)(
  "phone verification pauses invite polling while launch consent is pending after a %s completion payload",
  async (stage) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(createConsentStatus({ launchGranted: false })), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const view = await renderJoinInviteClientForEffects();
    const onCompleted = readHostedInvitePhoneAuthOnCompleted();

    await act(async () => {
      await onCompleted(createCompletionPayload(stage));
    });

    await vi.waitFor(() => {
      expect(mocks.hostedLegalConsentCardProps).toMatchObject({
        mode: "panel",
        preferredScope: "launch.legal",
        source: "join-invite-phone-verify",
      });
      expect(mocks.useHostedInviteStatusRefresh).toHaveBeenLastCalledWith(expect.objectContaining({
        disabled: true,
        shouldPoll: false,
      }));
    });

    assert.match(view.container.textContent ?? "", /Before you start/);
    assert.match(view.container.textContent ?? "", /Terms of Service/);
    assert.match(view.container.textContent ?? "", /Continue/);
    expect(mocks.fetchHostedInviteStatus).not.toHaveBeenCalled();
    expect(view.locationAssign).not.toHaveBeenCalled();

    await view.cleanup();
  },
);

test("phone verification skips the legal consent action when launch consent is current", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
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
    stage: "checkout",
  }));

  const view = await renderJoinInviteClientForEffects();
  const onCompleted = readHostedInvitePhoneAuthOnCompleted();

  await act(async () => {
    await onCompleted(createCompletionPayload("checkout"));
  });

  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Start experimenting/);
    assert.match(view.container.textContent ?? "", /Get Pulse/);
  });

  expect(mocks.fetchHostedInviteStatus).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/legal/consent/status", expect.objectContaining({
    method: "GET",
  }));
  expect(fetchMock).not.toHaveBeenCalledWith(
    "/api/legal/consent/accept",
    expect.anything(),
  );
  expect(view.locationAssign).not.toHaveBeenCalled();
  assert.doesNotMatch(view.container.textContent ?? "", /Continue/);

  await view.cleanup();
});

test("phone verification applies fresh invite status only after launch consent succeeds", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({ launchGranted: false })), {
      status: 200,
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({
      healthDataGranted: false,
      launchGranted: false,
      legalGranted: true,
    })), {
      status: 200,
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }));
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
    stage: "checkout",
  }));

  const view = await renderJoinInviteClientForEffects();
  const onCompleted = readHostedInvitePhoneAuthOnCompleted();

  await act(async () => {
    await onCompleted(createCompletionPayload("checkout"));
  });

  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Before you start/);
    assert.doesNotMatch(view.container.textContent ?? "", /Get Pulse/);
  });

  const checkboxes = Array.from(
    view.container.querySelectorAll('input[type="checkbox"]'),
  ) as HTMLInputElement[];
  expect(checkboxes).toHaveLength(2);

  await act(async () => {
    for (const checkbox of checkboxes) {
      setCheckboxChecked(view.window, checkbox, true);
    }
  });

  const continueButton = findButtonByText(view.container, /Continue/);
  await vi.waitFor(() => {
    expect(continueButton.disabled).toBe(false);
  });

  await act(async () => {
    continueButton.dispatchEvent(new view.window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(mocks.fetchHostedInviteStatus).toHaveBeenCalledTimes(1);
    assert.match(view.container.textContent ?? "", /Start experimenting/);
    assert.match(view.container.textContent ?? "", /Get Pulse/);
  });

  const acceptCalls = fetchMock.mock.calls.filter(([url]) =>
    url === "/api/legal/consent/accept"
  );
  expect(acceptCalls).toHaveLength(2);
  expect(JSON.parse(String(acceptCalls[0]?.[1]?.body))).toMatchObject({
    scope: "launch.legal",
    source: "join-invite-phone-verify",
  });
  expect(JSON.parse(String(acceptCalls[1]?.[1]?.body))).toMatchObject({
    scope: "launch.health-data",
    source: "join-invite-phone-verify",
  });
  expect(view.locationAssign).not.toHaveBeenCalled();

  await view.cleanup();
});

test("phone verification does not apply a stale completion after consent if fresh invite status no longer matches", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({ launchGranted: false })), {
      status: 200,
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({
      healthDataGranted: false,
      launchGranted: false,
      legalGranted: true,
    })), {
      status: 200,
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }));
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
    stage: "verify",
  }));

  const view = await renderJoinInviteClientForEffects();
  const onCompleted = readHostedInvitePhoneAuthOnCompleted();

  await act(async () => {
    await onCompleted(createCompletionPayload("checkout"));
  });

  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Before you start/);
  });

  const checkboxes = Array.from(
    view.container.querySelectorAll('input[type="checkbox"]'),
  ) as HTMLInputElement[];

  await act(async () => {
    for (const checkbox of checkboxes) {
      setCheckboxChecked(view.window, checkbox, true);
    }
  });

  await act(async () => {
    findButtonByText(view.container, /Continue/).dispatchEvent(
      new view.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    expect(mocks.fetchHostedInviteStatus).toHaveBeenCalledTimes(1);
    assert.match(view.container.textContent ?? "", /Verify your phone/);
    assert.match(view.container.textContent ?? "", /Hosted invite phone auth/);
  });
  assert.doesNotMatch(view.container.textContent ?? "", /Get Pulse/);
  expect(view.locationAssign).not.toHaveBeenCalled();

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
  assert.doesNotMatch(view.container.textContent ?? "", /Get Pulse/);
  assert.match(view.container.textContent ?? "", /Verify your phone/);
  assert.match(view.container.textContent ?? "", /Hosted invite phone auth/);

  await view.cleanup();
});

test("stale invite status refreshes preserve the checkout plan picker after consent is current", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
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
    stage: "checkout",
  }));

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

  expect(view.locationAssign).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Start experimenting/);
    assert.match(view.container.textContent ?? "", /Get Pulse/);
  });
  expect(fetchMock).toHaveBeenCalledWith("/api/legal/consent/status", expect.objectContaining({
    method: "GET",
  }));

  await view.cleanup();
});

test("manual checkout surfaces API errors and can retry", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }))
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
  });
  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Get Pulse/);
  });
  const checkoutButton = findButtonByText(view.container, /Get Pulse/);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(view.locationAssign).not.toHaveBeenCalled();
  assert.equal(checkoutButton.hasAttribute("disabled"), false);

  await act(async () => {
    checkoutButton.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/hosted-onboarding/billing/checkout", expect.objectContaining({
    body: JSON.stringify({
      billingPlanCode: "launch_monthly",
      inviteCode: "invite-code",
    }),
    method: "POST",
  }));
  assert.match(view.container.innerHTML, /Checkout unavailable\./);
  assert.equal(checkoutButton.hasAttribute("disabled"), false);

  await act(async () => {
    checkoutButton.click();
  });
  await waitForCheckoutSuccessHold();

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(view.locationAssign).toHaveBeenCalledWith("https://stripe.example.test/retry");

  await view.cleanup();
});

test("edge checkout sends the clicked monthly plan code without waiting for state", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({
        alreadyActive: false,
        url: "https://stripe.example.test/edge",
      }), {
        status: 200,
      }),
    );
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
  });
  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Get Edge/);
  });
  const edgeCheckoutButton = findButtonByText(view.container, /Get Edge/);

  await act(async () => {
    edgeCheckoutButton.click();
  });
  await waitForCheckoutSuccessHold();

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/billing/checkout", expect.objectContaining({
    body: JSON.stringify({
      billingPlanCode: "launch_edge_monthly",
      inviteCode: "invite-code",
    }),
    method: "POST",
  }));
  expect(view.locationAssign).toHaveBeenCalledWith("https://stripe.example.test/edge");

  await view.cleanup();
});

test("stale verify refreshes still leave the manual checkout fallback available after a checkout failure", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }))
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
  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Get Pulse/);
  });
  const checkoutButton = findButtonByText(view.container, /Get Pulse/);

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

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(view.locationAssign).not.toHaveBeenCalled();
  assert.match(checkoutButton.textContent ?? "", /Get Pulse/);

  await act(async () => {
    checkoutButton.click();
  });
  await waitForCheckoutSuccessHold();

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(view.locationAssign).toHaveBeenCalledWith("https://stripe.example.test/recovered");

  await view.cleanup();
});

test("already-active checkout refreshes preserve the current stage when the returned verify payload is only stale", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }))
    .mockResolvedValueOnce(
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
  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Get Pulse/);
  });
  const checkoutButton = findButtonByText(view.container, /Get Pulse/);

  await act(async () => {
    checkoutButton.click();
  });
  await waitForCheckoutSuccessHold();

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(mocks.fetchHostedInviteStatus).toHaveBeenCalledTimes(1);
  assert.match(view.container.textContent ?? "", /Start experimenting/);
  assert.match(view.container.textContent ?? "", /Get Pulse/);

  await view.cleanup();
});

test("already-active checkout refreshes return to verify when the invite session is actually gone", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }))
    .mockResolvedValueOnce(
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
  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Get Pulse/);
  });
  const checkoutButton = findButtonByText(view.container, /Get Pulse/);

  await act(async () => {
    checkoutButton.click();
  });
  await waitForCheckoutSuccessHold();

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(mocks.fetchHostedInviteStatus).toHaveBeenCalledTimes(1);
  assert.match(view.container.textContent ?? "", /Verify your phone/);
  assert.match(view.container.textContent ?? "", /Hosted invite phone auth/);

  await view.cleanup();
});

test("active invite state renders message and settings actions after launch consent is current", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects({
    initialStatus: createStatus({
      murphPhoneNumber: "+15550100001",
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "active",
    }),
  });

  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Murph will text you shortly\. Reply to start\./);
    assert.match(view.container.textContent ?? "", /Text Murph/);
  });
  const markup = view.container.innerHTML;

  assert.match(markup, /Murph will text you shortly\. Reply to start\./);
  assert.ok(markup.includes('href="sms:+15550100001"'));
  assert.match(markup, /Text Murph/);
  assert.ok(markup.includes('download="Murph.vcf"'));
  assert.match(markup, /Add Murph to Contacts/);
  assert.ok(markup.includes('href="/experiments"'));
  assert.match(markup, /View experiments/);

  await view.cleanup();
});

test("active invite state omits Murph contact actions when no assigned number is available", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects({
    initialStatus: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "active",
    }),
  });

  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /View experiments/);
  });

  assert.doesNotMatch(view.container.innerHTML, /href="sms:/);
  assert.doesNotMatch(view.container.textContent ?? "", /Add Murph to Contacts/);
  assert.ok(view.container.innerHTML.includes('href="/experiments"'));

  await view.cleanup();
});

test("active invite state surfaces launch legal consent when signup has not recorded it yet", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createConsentStatus({ launchGranted: false })), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects({
    initialStatus: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "active",
    }),
  });

  await flushReactEffects();

  assert.match(view.container.textContent ?? "", /Before you start/);
  assert.match(view.container.textContent ?? "", /Terms of Service/);
  assert.match(view.container.textContent ?? "", /Continue/);
  expect(fetchMock).toHaveBeenCalledWith("/api/legal/consent/status", expect.objectContaining({
    method: "GET",
  }));

  await view.cleanup();
});

test("activating invite state explains when vault and assistant setup is still running", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createConsentStatus({ launchGranted: true })), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = await renderJoinInviteClientForEffects({
    initialStatus: createStatus({
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "activating",
    }),
  });

  await vi.waitFor(() => {
    assert.match(view.container.textContent ?? "", /Finishing your setup/);
    assert.match(view.container.textContent ?? "", /Setup finishes in about ten seconds\./);
    assert.match(view.container.textContent ?? "", /Setting up your vault and assistant/);
    assert.match(view.container.textContent ?? "", /This takes about ten seconds\. We’ll update here when it’s done\./);
  });

  await view.cleanup();
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
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "*** 2671",
      },
      phoneHint: "*** 2671",
      verificationMode: "invite_phone",
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
    setJoinInviteClientGlobal("self", window),
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

async function waitForCheckoutSuccessHold() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
}

async function flushReactEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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

function setCheckboxChecked(
  window: Window & typeof globalThis,
  input: HTMLInputElement,
  checked: boolean,
) {
  input.checked = checked;
  input.dispatchEvent(new window.Event("click", { bubbles: true }));
  input.checked = checked;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function createConsentStatus(input: {
  connectedHealthGranted?: boolean;
  healthDataGranted?: boolean;
  launchGranted: boolean;
  legalGranted?: boolean;
}): HostedConsentStatus {
  const legalGranted = input.legalGranted ?? input.launchGranted;
  const healthDataGranted = input.healthDataGranted ?? input.launchGranted;
  const legalDocuments = [
    consentDocument("terms-of-service", "Terms of Service", "/legal/terms"),
    consentDocument("privacy-policy", "Murph Privacy Policy", "/legal/privacy"),
    consentDocument(
      "health-ai-safety-disclosure",
      "Murph Health AI Safety Disclosure",
      "/legal/health-ai-safety-disclosure",
    ),
  ];
  const healthDataDocuments = [
    consentDocument(
      "consumer-health-data-notice",
      "Murph Consumer Health Data Notice",
      "/consumer-health-data-privacy-policy",
    ),
  ];
  const allDocuments = [...legalDocuments, ...healthDataDocuments];
  const connectedHealthDocuments = allDocuments.filter((document) =>
    document.id === "privacy-policy" || document.id === "consumer-health-data-notice",
  );

  return {
    documents: allDocuments,
    generatedAt: "2026-04-30T00:00:00.000Z",
    launchGranted: legalGranted && healthDataGranted,
    launchScopes: [
      { granted: legalGranted, missingDocuments: legalGranted ? [] : legalDocuments, scope: "launch.legal" as const },
      { granted: healthDataGranted, missingDocuments: healthDataGranted ? [] : healthDataDocuments, scope: "launch.health-data" as const },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      consentScope("launch.legal", "Terms, privacy, and AI disclosure", false, legalDocuments, legalGranted),
      consentScope("launch.health-data", "Health data collection consent", false, healthDataDocuments, healthDataGranted),
      consentScope(
        "feature.connected-health-source",
        "Connected health source consent",
        true,
        connectedHealthDocuments,
        input.connectedHealthGranted === true,
      ),
    ],
  };
}

function consentDocument(id: string, title: string, href: string) {
  return {
    href,
    id: id as HostedConsentStatus["documents"][number]["id"],
    pdfHref: `${href}.pdf`,
    title,
    version: "2026-04-29",
  };
}

function consentScope(
  scope: HostedConsentStatus["scopes"][number]["scope"],
  label: string,
  revocable: boolean,
  documents: HostedConsentStatus["documents"],
  granted: boolean,
): HostedConsentStatus["scopes"][number] {
  return {
    current: granted,
    documents,
    grant: null,
    granted,
    label,
    missingDocuments: granted ? [] : documents,
    revocable,
    scope,
  };
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
