import assert from "node:assert/strict";

import {
  act,
  cloneElement,
  createElement,
  isValidElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  getHostedDashboardLayoutAuthSnapshot: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  resolveConnectedAppCompletionDialogModel: vi.fn(),
  resolveDeviceSyncCompletionDialogModel: vi.fn(),
  readHostedInitialOnboardingState: vi.fn(),
  readHostedAiUsageGate: vi.fn(),
  readHostedMemberMessagingSetupState: vi.fn(),
  projectHostedPersonalAiUsageStatus: vi.fn(),
  resolveHostedMurphContactOption: vi.fn(),
  routerRefresh: vi.fn(),
  shouldShowHomeDeviceSyncStep: vi.fn(),
}));

vi.mock("server-only", () => ({}));

// The dashboard route-group template owns the browser vault, so the home
// page body reads it through context. Stub it here since these tests render the
// page in isolation without the layout.
vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: ReactNode }) => children,
  useBrowserVault: () => ({
    client: null,
    dataVersion: null,
    deviceSyncImportPending: false,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: async () => {},
    status: "empty",
  }),
}));

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: string;
    "data-slot"?: string;
  }) {
    return createElement(
      "a",
      {
        className: props.className,
        "data-slot": props["data-slot"],
        href: props.href,
      },
      props.children,
    );
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("@/src/components/home/upload-labs-action", () => ({
  UploadLabsActionFallback: () =>
    createElement("button", { type: "button" }, "Sync fallback"),
  UploadLabsMurphContactAction: () =>
    createElement("button", { type: "button" }, "Sync"),
}));

vi.mock("../app/(dashboard)/home/initial-visit-persona-picker-client", () => ({
  HomeInitialVisitPersonaPickerClient({
    contactAction,
  }: {
    contactAction: {
      href: string;
      kind: string;
      webmail?: {
        href: string;
        label: string;
      } | null;
    } | null;
  }) {
    return createElement(
      "section",
      {
        "data-contact-action-href": contactAction?.href ?? "none",
        "data-contact-action-kind": contactAction?.kind ?? "none",
        "data-contact-action-webmail-href": contactAction?.webmail?.href ?? "none",
        "data-contact-action-webmail-label": contactAction?.webmail?.label ?? "none",
        "data-show-contact-card": contactAction?.kind === "text" ? "true" : "false",
        "data-home-initial-visit-persona-picker": "shown",
      },
      "Persona onboarding",
    );
  },
}));

vi.mock("../app/(dashboard)/home/device-sync-completion-dialog", () => ({
  DeviceSyncCompletionDialog({
    model,
  }: {
    model: { kind: string; title: string };
  }) {
    return createElement(
      "section",
      { "data-completion-dialog-kind": model.kind },
      model.title,
    );
  },
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOption: mocks.resolveHostedMurphContactOption,
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton(props: {
    children?: ReactNode;
    className?: string;
    render?: ReactNode;
  }) {
    if (isValidElement<{ children?: ReactNode; className?: string; "data-slot"?: string }>(props.render)) {
      return cloneElement(
        props.render,
        {
          className: props.className,
          "data-slot": "auth-button",
        },
        props.children,
      );
    }

    return createElement("button", {
      className: props.className,
      "data-slot": "auth-button",
      type: "button",
    }, props.children);
  },
}));

vi.mock("@/src/lib/device-sync/home-onboarding", () => ({
  shouldShowHomeDeviceSyncStep: mocks.shouldShowHomeDeviceSyncStep,
}));

vi.mock("@/src/lib/device-sync/connect-completion", () => ({
  DEVICE_SYNC_COMPLETION_HOME_MARKER: "deviceSyncCompletion",
  resolveDeviceSyncCompletionDialogModel:
    mocks.resolveDeviceSyncCompletionDialogModel,
}));

vi.mock("@/src/lib/connected-apps/connect-completion", () => ({
  CONNECTED_APP_COMPLETION_HOME_MARKER: "connectedAppCompletion",
  resolveConnectedAppCompletionDialogModel:
    mocks.resolveConnectedAppCompletionDialogModel,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardLayoutAuthSnapshot:
    mocks.getHostedDashboardLayoutAuthSnapshot,
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  hasHostedHistoricalLaunchConsent: () => false,
  readHostedConsentStatus: mocks.readHostedConsentStatus,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberMessagingSetupState: mocks.readHostedMemberMessagingSetupState,
}));

vi.mock("@/src/lib/hosted-onboarding/initial-onboarding", () => ({
  readHostedInitialOnboardingState: mocks.readHostedInitialOnboardingState,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-execution/usage-status", () => ({
  projectHostedPersonalAiUsageStatus: mocks.projectHostedPersonalAiUsageStatus,
}));

const MEMBER = {
  billingStatus: "active",
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  id: "member_123",
  suspendedAt: null,
  updatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: MEMBER,
    session: null,
  });
  mocks.getHostedDashboardLayoutAuthSnapshot.mockResolvedValue({
    pageAuth: {
      authenticated: true,
      authenticatedMember: MEMBER,
      session: null,
    },
    sidebarAuth: { authenticated: true, label: null },
    status: "ready",
  });
  mocks.readHostedConsentStatus.mockResolvedValue({ launchGranted: true });
  mocks.shouldShowHomeDeviceSyncStep.mockResolvedValue(true);
  mocks.resolveDeviceSyncCompletionDialogModel.mockImplementation(
    ({ searchParams }: { searchParams: Record<string, string | undefined> }) => {
      if (searchParams.deviceSyncCompletion !== "1") {
        return null;
      }

      const failed = searchParams.deviceSyncStatus === "error";
      return {
        contactAction: null,
        detail: failed
          ? "Try connecting your device again."
          : "Open Murph to confirm your connected sources.",
        failed,
        kind: "device-sync",
        retryHref: failed ? "/connect" : null,
        title: failed
          ? "Device connection did not finish"
          : "Device connection complete",
        unverified: false,
      };
    },
  );
  mocks.resolveConnectedAppCompletionDialogModel.mockImplementation(
    ({ searchParams }: { searchParams: Record<string, string | undefined> }) => {
      if (searchParams.connectedAppCompletion !== "1") {
        return null;
      }

      const failed = searchParams.connectedAppStatus !== "success";
      const accountLabel = searchParams.toolkit === "gmail"
        ? "Gmail"
        : "Your integration";
      return {
        contactAction: null,
        detail: failed
          ? "Ask Murph for a new connection link when you are ready."
          : `${accountLabel} is ready.`,
        failed,
        kind: "connected-app",
        retryHref: null,
        title: failed
          ? `${accountLabel} connection did not finish`
          : `${accountLabel} is connected`,
        unverified: false,
      };
    },
  );
  mocks.readHostedInitialOnboardingState.mockResolvedValue({
    preferences: { persona: null, tone: null, voice: null },
    status: "pending",
  });
  // Default to a member Murph can already reach, so the "Message Murph" step
  // stays hidden unless a test opts into the awaiting-first-message state.
  mocks.readHostedMemberMessagingSetupState.mockResolvedValue({
    identity: { phoneLookupKey: "hbidx:phone:v1:member" },
    routing: null,
  });
  mocks.resolveHostedMurphContactOption.mockResolvedValue({
    href: "sms:+15555550123",
    kind: "text",
    label: "Text Murph",
    rel: undefined,
    target: undefined,
  });
  mocks.readHostedAiUsageGate.mockResolvedValue({
    allowed: true,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    remainingUsdMicros: 4_000_000n,
    spentUsdMicros: 6_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValue({
    generatedAt: "2026-05-26T12:00:00.000Z",
    reason: "hosted_access_inactive",
    recommendedAction: null,
    status: "unavailable",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

test("HomePage stops before page loaders when dashboard auth redirects", async () => {
  mocks.getHostedPageAuthSnapshot.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/join"));

  const { default: HomePage } = await import("../app/(dashboard)/home/page");

  await assert.rejects(async () => {
    await HomePage({ searchParams: Promise.resolve({}) });
  }, /NEXT_REDIRECT:\/join/);
  assert.equal(mocks.shouldShowHomeDeviceSyncStep.mock.calls.length, 0);
  assert.equal(mocks.readHostedAiUsageGate.mock.calls.length, 0);
});

test("HomePage keeps its core content when an independent projection fails", async () => {
  mocks.shouldShowHomeDeviceSyncStep.mockRejectedValueOnce(
    new Error("device projection unavailable"),
  );

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /Welcome to Murph/);
  assert.match(markup, /Some dashboard details are unavailable/);
  assert.doesNotMatch(markup, /Connect devices/);
  assert.match(markup, /Sync labs/);
  assert.match(markup, /Start an experiment/);
  assert.equal(mocks.readHostedAiUsageGate.mock.calls.length, 1);
});

test("HomePage bounds composed dashboard owners and preserves advisory siblings", async () => {
  type InitialState = {
    preferences: { persona: null; tone: null; voice: null };
    status: "pending";
  };
  const activeOwners = new Set<string>();
  let peakOwners = new Set<string>();

  function createOwner<T>(label: string) {
    let rejectPromise: ((reason?: unknown) => void) | null = null;
    let resolvePromise: ((value: T) => void) | null = null;
    let signalStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });

    const settle = (settler: () => void) => {
      assert.ok(activeOwners.delete(label), `${label} must be active before settling`);
      settler();
    };

    return {
      reject(reason: unknown) {
        assert.ok(rejectPromise, `${label} must start before rejection`);
        settle(() => rejectPromise?.(reason));
      },
      resolve(value: T) {
        assert.ok(resolvePromise, `${label} must start before resolution`);
        settle(() => resolvePromise?.(value));
      },
      run() {
        assert.equal(activeOwners.has(label), false, `${label} must start once`);
        activeOwners.add(label);
        if (activeOwners.size > peakOwners.size) {
          peakOwners = new Set(activeOwners);
        }
        signalStarted?.();
        return new Promise<T>((resolve, reject) => {
          resolvePromise = resolve;
          rejectPromise = reject;
        });
      },
      started,
    };
  }

  const consentOwner = createOwner<{ launchGranted: boolean }>("layout consent");
  const deviceOwner = createOwner<boolean>("device onboarding");
  const usageOwner = createOwner<null>("usage allowance");
  const initialOwner = createOwner<InitialState>("initial onboarding");
  const contactOwner = createOwner<{
    href: string;
    kind: string;
    label: string;
    rel: undefined;
    target: undefined;
  }>("contact projection");
  const messagingOwner = createOwner<{
    identity: { phoneLookupKey: string };
    routing: null;
  }>("messaging setup");

  mocks.readHostedConsentStatus.mockImplementationOnce(consentOwner.run);
  mocks.shouldShowHomeDeviceSyncStep.mockImplementationOnce(deviceOwner.run);
  mocks.readHostedAiUsageGate.mockImplementationOnce(usageOwner.run);
  mocks.readHostedInitialOnboardingState.mockImplementationOnce(initialOwner.run);
  mocks.resolveHostedMurphContactOption.mockImplementationOnce(contactOwner.run);
  mocks.readHostedMemberMessagingSetupState.mockImplementationOnce(
    messagingOwner.run,
  );

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const { default: DashboardLayout } = await import("../app/(dashboard)/layout");
  const page = HomePage({ searchParams: Promise.resolve({}) });
  const layout = DashboardLayout({ children: null });

  await Promise.all([
    consentOwner.started,
    deviceOwner.started,
    usageOwner.started,
    initialOwner.started,
  ]);
  assert.deepEqual(
    [...peakOwners].sort(),
    ["device onboarding", "initial onboarding", "layout consent", "usage allowance"],
  );
  assert.ok(peakOwners.size < 5);
  assert.equal(mocks.readHostedMemberMessagingSetupState.mock.calls.length, 0);

  initialOwner.resolve({
    preferences: { persona: null, tone: null, voice: null },
    status: "pending",
  });
  await contactOwner.started;
  assert.equal(activeOwners.has("contact projection"), true);
  assert.equal(mocks.readHostedMemberMessagingSetupState.mock.calls.length, 0);
  assert.ok(peakOwners.size < 5);

  contactOwner.resolve({
    href: "sms:+15555550123",
    kind: "text",
    label: "Text Murph",
    rel: undefined,
    target: undefined,
  });
  await messagingOwner.started;

  assert.equal(mocks.readHostedMemberMessagingSetupState.mock.calls.length, 1);
  assert.ok(peakOwners.size < 5);

  consentOwner.resolve({ launchGranted: true });
  deviceOwner.resolve(true);
  usageOwner.resolve(null);
  messagingOwner.resolve({
    identity: { phoneLookupKey: "hbidx:phone:v1:member" },
    routing: null,
  });
  const [pageElement] = await Promise.all([page, layout]);
  const markup = renderToStaticMarkup(pageElement);

  assert.equal(activeOwners.size, 0);
  assert.equal(peakOwners.size, 4);
  assert.match(markup, /Welcome to Murph/);
  assert.match(markup, /data-home-initial-visit-persona-picker="shown"/);

  mocks.readHostedInitialOnboardingState.mockRejectedValueOnce(
    new Error("initial onboarding unavailable"),
  );
  mocks.readHostedMemberMessagingSetupState.mockResolvedValueOnce({
    identity: { phoneLookupKey: null },
    routing: {
      linqChatId: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      telegramThreadId: null,
      telegramUserId: null,
    },
  });
  const initialRejectedMarkup = renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve({}) }),
  );

  assert.match(initialRejectedMarkup, /Some dashboard details are unavailable/);
  assert.match(initialRejectedMarkup, /Message Murph/);
  assert.doesNotMatch(initialRejectedMarkup, /data-home-initial-visit-persona-picker/);

  mocks.readHostedInitialOnboardingState.mockResolvedValueOnce({
    preferences: { persona: null, tone: null, voice: null },
    status: "pending",
  });
  mocks.readHostedMemberMessagingSetupState.mockRejectedValueOnce(
    new Error("messaging setup unavailable"),
  );
  const messagingRejectedMarkup = renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve({}) }),
  );

  assert.match(messagingRejectedMarkup, /Some dashboard details are unavailable/);
  assert.match(
    messagingRejectedMarkup,
    /data-home-initial-visit-persona-picker="shown"/,
  );
  assert.match(messagingRejectedMarkup, /data-contact-action-href="sms:\+15555550123"/);
});

test("HomePage still reads messaging when the earlier advisory projection fails", async () => {
  mocks.readHostedInitialOnboardingState.mockRejectedValueOnce(
    new Error("initial onboarding unavailable"),
  );

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve({}) }),
  );

  assert.match(markup, /Some dashboard details are unavailable/);
  assert.equal(mocks.readHostedMemberMessagingSetupState.mock.calls.length, 1);
});

test("HomePage degrades a failed read-only usage projection without mutating allowance state", async () => {
  mocks.readHostedAiUsageGate.mockRejectedValueOnce(
    new Error("usage projection unavailable"),
  );

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /Welcome to Murph/);
  assert.match(markup, /Some dashboard details are unavailable/);
  assert.doesNotMatch(markup, /Account notice/);
  assert.equal(mocks.readHostedAiUsageGate.mock.calls.length, 1);
});

test("HomePage retains an authoritative usage notice when its action projection fails", async () => {
  mocks.readHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "pulse_upgrade_edge",
      message:
        "You've used 100% of this month's included Pulse usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockRejectedValueOnce(
    new Error("usage action unavailable"),
  );

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /Some dashboard details are unavailable/);
  assert.match(markup, /used 100% of this month(?:&#x27;|')s included Pulse usage/u);
  assert.match(markup, /until your included usage resets/);
  assert.doesNotMatch(markup, />Add usage</);
});

test("HomeDataLoadAlert retries the current dashboard route", async () => {
  const { HomeDataLoadAlert } = await import(
    "../src/components/home/home-data-load-alert"
  );
  const rendered = await renderClientComponent(createElement(HomeDataLoadAlert));

  try {
    const retryButton = [...rendered.container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Try again");
    assert.ok(retryButton);

    await act(async () => {
      retryButton.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
      }));
    });

    assert.equal(mocks.routerRefresh.mock.calls.length, 1);
  } finally {
    await rendered.cleanup();
  }
});

test("DashboardCriticalLoadError refreshes the unavailable dashboard layout", async () => {
  const { DashboardCriticalLoadError } = await import(
    "../src/components/dashboard/dashboard-critical-load-error"
  );
  const rendered = await renderClientComponent(
    createElement(DashboardCriticalLoadError),
  );

  try {
    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
      }));
    });

    assert.equal(mocks.routerRefresh.mock.calls.length, 1);
  } finally {
    await rendered.cleanup();
  }
});

test("DashboardError gives non-home dashboard child failures a route-group reset", async () => {
  const reset = vi.fn();
  const { default: DashboardError } = await import(
    "../app/(dashboard)/error"
  );
  const rendered = await renderClientComponent(createElement(DashboardError, {
    error: new Error("records data unavailable"),
    reset,
  }));

  try {
    assert.match(
      rendered.container.textContent ?? "",
      /Your dashboard could not be loaded/,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /could not load this dashboard right now/,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Log in or sign up/,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /records data unavailable/,
    );

    await act(async () => {
      rendered.button.dispatchEvent(new rendered.window.Event("click", {
        bubbles: true,
      }));
    });

    assert.equal(reset.mock.calls.length, 1);
    assert.equal(mocks.routerRefresh.mock.calls.length, 0);
  } finally {
    await rendered.cleanup();
  }
});

test("HomePage hides the connect devices card when device sync is already active", async () => {
  mocks.shouldShowHomeDeviceSyncStep.mockResolvedValueOnce(false);

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /Welcome to Murph/);
  assert.doesNotMatch(markup, /Connect devices/);
  assert.doesNotMatch(markup, /href="\/connect"/);
  assert.match(markup, /Sync labs/);
  assert.match(markup, /Start an experiment/);
  assert.equal(mocks.shouldShowHomeDeviceSyncStep.mock.calls[0]?.[0]?.member, MEMBER);
  assert.equal(mocks.readHostedAiUsageGate.mock.calls[0]?.[0]?.memberId, MEMBER.id);
  assert.equal(
    mocks.readHostedAiUsageGate.mock.calls[0]?.[0]?.now.toISOString(),
    "2026-05-26T12:00:00.000Z",
  );
});

test("HomePage does not show a blocked banner while purchased usage remains", async () => {
  mocks.readHostedAiUsageGate.mockResolvedValueOnce({
    allowed: true,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    remainingUsdMicros: 2_000_000n,
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 2_000_000n,
    usageCreditLedgerVersion: 3n,
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.doesNotMatch(markup, /Account notice/);
  assert.doesNotMatch(markup, /Murph is paused/);
  assert.doesNotMatch(markup, />Add usage</);
  assert.equal(mocks.projectHostedPersonalAiUsageStatus.mock.calls.length, 0);
});

test("HomePage shows blocked Pulse usage with an add-usage action", async () => {
  mocks.readHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "pulse_upgrade_edge",
      message:
        "You've used 100% of this month's included Pulse usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValueOnce({
    generatedAt: "2026-05-26T12:00:00.000Z",
    recommendedAction: {
      kind: "add_usage",
      label: "Add usage",
      url: "/settings?addUsage=true#subscription",
    },
    status: "unavailable",
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /used 100% of this month(?:&#x27;|')s included Pulse usage/u);
  assert.match(markup, /Resets in 6 days/);
  assert.match(markup, /Murph is paused until you add usage or your allowance resets/);
  assert.doesNotMatch(markup, /You can add more usage now/);
  assert.match(markup, />Add usage</);
  assert.match(markup, /href="\/settings\?addUsage=true#subscription"/);
  assert.equal(mocks.readHostedAiUsageGate.mock.calls.length, 1);
  assert.equal(mocks.projectHostedPersonalAiUsageStatus.mock.calls.length, 1);
  assert.equal(
    mocks.projectHostedPersonalAiUsageStatus.mock.calls[0]?.[0]?.decision.userNotice.code,
    "pulse_upgrade_edge",
  );
});

test("HomePage identifies exhausted Max usage without Pulse or Edge copy", async () => {
  mocks.readHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_max_monthly",
    limitUsdMicros: 40_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 40_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "max_usage_limit_reached",
      message:
        "You've used 100% of this month's included Max usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValueOnce({
    generatedAt: "2026-05-26T12:00:00.000Z",
    recommendedAction: {
      kind: "add_usage",
      label: "Add usage",
      url: "/settings?addUsage=true#subscription",
    },
    status: "unavailable",
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /included Max usage/u);
  assert.doesNotMatch(markup, /included (?:Pulse|Edge) usage/u);
  assert.match(markup, />Add usage</);
  assert.equal(
    mocks.projectHostedPersonalAiUsageStatus.mock.calls[0]?.[0]?.decision.userNotice.code,
    "max_usage_limit_reached",
  );
});

test("HomePage keeps the exhausted Pulse block notice when action resolution fails closed", async () => {
  mocks.readHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "pulse_upgrade_edge",
      message:
        "You've used 100% of this month's included Pulse usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValueOnce({
    accessKind: "paid",
    forecast: null,
    generatedAt: "2026-05-26T12:00:00.000Z",
    periodEnd: "2026-06-01T00:00:00.000Z",
    periodKind: "monthly",
    periodStart: "2026-05-01T00:00:00.000Z",
    planCode: "launch_monthly",
    planName: "Pulse",
    recommendedAction: null,
    remainingPercent: 0,
    status: "exhausted",
    usedPercent: 100,
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /used 100% of this month(?:&#x27;|')s included Pulse usage/u);
  assert.match(markup, /Murph is paused until your included usage resets/);
  assert.doesNotMatch(markup, /You can add more usage now/);
  assert.doesNotMatch(markup, />Add usage</);
  assert.doesNotMatch(markup, /addUsage=true/);
});

test("UsageLimitBanner omits thread-container notices from the personal dashboard", async () => {
  const { UsageLimitBanner } = await import(
    "../src/components/home/usage-limit-banner"
  );

  const markup = renderToStaticMarkup(createElement(UsageLimitBanner, {
    noticeCode: "thread_usage_limit_reached",
  }));

  assert.equal(markup, "");
});

test("UsageLimitBanner names the member plan Core while preserving group continuity", async () => {
  const { UsageLimitBanner } = await import(
    "../src/components/home/usage-limit-banner"
  );

  const markup = renderToStaticMarkup(createElement(UsageLimitBanner, {
    noticeCode: "group_upgrade_pulse",
    recommendedAction: {
      kind: "change_plan",
      label: "Choose Core",
      targetPlanCode: "launch_group_monthly",
      url: "https://example.test/settings#subscription",
    },
  }));

  assert.match(markup, /included Core usage/u);
  assert.match(markup, /Murph is paused until your included usage resets/u);
  assert.match(markup, /Core keeps you connected/u);
  assert.doesNotMatch(markup, /group activity stays current/u);
  assert.doesNotMatch(markup, /included Group usage/u);
});

test("HomePage shows blocked Edge usage with an add-usage action", async () => {
  mocks.readHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_edge_monthly",
    limitUsdMicros: 25_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 25_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "edge_usage_limit_reached",
      message:
        "You've used 100% of this month's included Edge usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValueOnce({
    generatedAt: "2026-05-26T12:00:00.000Z",
    recommendedAction: {
      kind: "add_usage",
      label: "Add usage",
      url: "/settings?addUsage=true#subscription",
    },
    status: "unavailable",
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /used 100% of this month(?:&#x27;|')s included Edge usage/u);
  assert.match(markup, /Resets in 6 days/);
  assert.match(markup, /Murph is paused until you add usage or your allowance resets/);
  assert.doesNotMatch(markup, /You can add more usage now/);
  assert.match(markup, />Add usage</);
  assert.match(markup, /href="\/settings\?addUsage=true#subscription"/);
});

test("HomePage shows a blocked Family usage notice with the fallback add-usage action", async () => {
  mocks.readHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "family_sponsored_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-06-01T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-06-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "family_usage_limit_reached",
      message: "Unused test fixture message",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /used 100% of your included usage this month/u);
  assert.doesNotMatch(markup, /Other Family members have separate allowances/u);
  assert.match(markup, /Murph is paused until more usage is added or your allowance resets/);
  assert.doesNotMatch(markup, /shared allowance|Family(?:&#x27;|')s included usage/u);
  assert.match(markup, /Resets in 6 days/);
  assert.match(markup, />Add usage</);
  assert.match(markup, /href="\/settings\?addUsage=true#subscription"/);
});

test("HomePage shows exhausted starter usage with the existing Start Pulse action", async () => {
  mocks.readHostedAiUsageGate.mockResolvedValueOnce({
    allowed: false,
    allowanceSource: "direct_starter",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 0n,
    memberId: MEMBER.id,
    periodEnd: new Date("2026-05-08T00:00:00.000Z"),
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-05-08T00:00:00.000Z"),
    spentUsdMicros: 4_500_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 0n,
    userNotice: {
      code: "starter_usage_limit_reached",
      message: "You've used 100% of your starter usage. New usage is blocked.",
    },
  });
  mocks.projectHostedPersonalAiUsageStatus.mockResolvedValueOnce({
    generatedAt: "2026-05-26T12:00:00.000Z",
    recommendedAction: {
      kind: "start_pulse",
      label: "Start from usage projection",
      url: "https://example.test/settings#subscription",
    },
    status: "unavailable",
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /used 100% of your starter usage/u);
  assert.match(markup, /Murph is paused because your starter usage is exhausted/);
  assert.match(markup, /Start Pulse to continue/iu);
  assert.match(markup, /Start from usage projection/);
  assert.match(markup, /href="https:\/\/example\.test\/settings#subscription"/);
  assert.doesNotMatch(markup, /Resets in/u);
});

test("HomePage keeps pending onboarding usable without optional contact projection", async () => {
  mocks.resolveHostedMurphContactOption.mockRejectedValueOnce(
    new Error("contact context unavailable"),
  );

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const searchParams = {};
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve(searchParams),
    }),
  );

  assert.match(markup, /Welcome to Murph/);
  assert.doesNotMatch(markup, /Some dashboard details are unavailable/);
  assert.match(markup, /data-home-initial-visit-persona-picker="shown"/);
  assert.match(markup, /data-contact-action-href="none"/);
  assert.match(markup, /data-show-contact-card="false"/);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 1);

  const recoveredMarkup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve(searchParams),
    }),
  );

  assert.doesNotMatch(
    recoveredMarkup,
    /Some dashboard details are unavailable/,
  );
  assert.match(
    recoveredMarkup,
    /data-home-initial-visit-persona-picker="shown"/,
  );
  assert.match(recoveredMarkup, /data-contact-action-href="sms:\+15555550123"/);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 2);
});

test("HomePage presents connection results before canonical onboarding", async () => {
  const cases = [
    {
      expected: /Device connection complete/,
      searchParams: { deviceSyncCompletion: "1" },
    },
    {
      expected: /Device connection did not finish/,
      searchParams: {
        deviceSyncCompletion: "1",
        deviceSyncError: "OAUTH_STATE_INVALID",
        deviceSyncStatus: "error",
      },
    },
    {
      expected: /Gmail is connected/,
      searchParams: {
        connectedAppCompletion: "1",
        connectedAppStatus: "success",
        toolkit: "gmail",
      },
    },
    {
      expected: /Your integration connection did not finish/,
      searchParams: {
        connectedAppCompletion: "1",
        connectedAppStatus: "error",
      },
    },
  ] as const;
  const { default: HomePage } = await import("../app/(dashboard)/home/page");

  for (const testCase of cases) {
    const markup = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve(testCase.searchParams) }),
    );

    assert.match(markup, testCase.expected);
    assert.doesNotMatch(markup, /data-home-initial-visit-persona-picker/);
  }

  const plainHomeMarkup = renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve({}) }),
  );
  assert.match(
    plainHomeMarkup,
    /data-home-initial-visit-persona-picker="shown"/,
  );
});

test("HomePage starts callback messaging alongside canonical onboarding", async () => {
  type InitialState = {
    preferences: { persona: null; tone: null; voice: null };
    status: "pending";
  };
  type MessagingState = {
    identity: { phoneLookupKey: string };
    routing: null;
  };
  const resolveInitialState = vi.fn<(value: InitialState) => void>();
  const resolveMessagingState = vi.fn<(value: MessagingState) => void>();
  const signalInitialStarted = vi.fn<() => void>();
  const signalMessagingStarted = vi.fn<() => void>();
  const initialStarted = new Promise<void>((resolve) => {
    signalInitialStarted.mockImplementation(resolve);
  });
  const messagingStarted = new Promise<void>((resolve) => {
    signalMessagingStarted.mockImplementation(resolve);
  });
  mocks.readHostedInitialOnboardingState.mockImplementationOnce(() => {
    signalInitialStarted();
    return new Promise<InitialState>((resolve) => {
      resolveInitialState.mockImplementation(resolve);
    });
  });
  mocks.readHostedMemberMessagingSetupState.mockImplementationOnce(() => {
    signalMessagingStarted();
    return new Promise<MessagingState>((resolve) => {
      resolveMessagingState.mockImplementation(resolve);
    });
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const page = HomePage({
    searchParams: Promise.resolve({ deviceSyncCompletion: "1" }),
  });

  await Promise.all([initialStarted, messagingStarted]);
  assert.equal(mocks.readHostedInitialOnboardingState.mock.calls.length, 1);
  assert.equal(mocks.readHostedMemberMessagingSetupState.mock.calls.length, 1);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 0);

  resolveMessagingState({
    identity: { phoneLookupKey: "hbidx:phone:v1:member" },
    routing: null,
  });
  resolveInitialState({
    preferences: { persona: null, tone: null, voice: null },
    status: "pending",
  });
  const markup = renderToStaticMarkup(await page);

  assert.match(markup, /Device connection complete/);
  assert.doesNotMatch(markup, /data-home-initial-visit-persona-picker/);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 0);
});

test("HomePage retains callback completion when canonical onboarding fails", async () => {
  mocks.readHostedInitialOnboardingState.mockRejectedValueOnce(
    new Error("initial onboarding unavailable"),
  );

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({
        connectedAppCompletion: "1",
        connectedAppStatus: "success",
        toolkit: "gmail",
      }),
    }),
  );

  assert.match(markup, /Gmail is connected/);
  assert.match(markup, /Some dashboard details are unavailable/);
  assert.doesNotMatch(markup, /data-home-initial-visit-persona-picker/);
  assert.equal(mocks.readHostedMemberMessagingSetupState.mock.calls.length, 1);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 0);
});

test("HomePage skips the losing connected-app resolver after device completion", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");

  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({
        connectedAppCompletion: "1",
        connectedAppStatus: "success",
        deviceSyncCompletion: "1",
        toolkit: "gmail",
      }),
    }),
  );

  assert.match(markup, /Device connection complete/);
  assert.equal(mocks.resolveConnectedAppCompletionDialogModel.mock.calls.length, 0);
});

test("HomePage opens pending persona onboarding on plain home", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({}),
    }),
  );

  assert.match(markup, /Welcome to Murph/);
  assert.match(markup, /data-home-initial-visit-persona-picker="shown"/);
  assert.match(markup, /data-show-contact-card="true"/);
  assert.match(markup, /data-contact-action-href="sms:\+15555550123"/);
  assert.match(markup, /Persona onboarding/);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 1);
});

test("HomePage suppresses onboarding after native completion", async () => {
  mocks.readHostedInitialOnboardingState.mockResolvedValueOnce({
    preferences: {
      persona: "classic",
      tone: "formal",
      voice: "upbeat",
    },
    status: "completed",
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({}),
    }),
  );

  assert.doesNotMatch(markup, /data-home-initial-visit-persona-picker/);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 0);
});

test("HomePage skips the contact-card picker for Telegram-only members", async () => {
  mocks.resolveHostedMurphContactOption.mockResolvedValueOnce({
    href: "https://t.me/withmurph_bot",
    kind: "telegram",
    label: "Message Murph on Telegram",
    rel: "noopener noreferrer",
    target: "_blank",
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({}),
    }),
  );

  assert.match(markup, /data-home-initial-visit-persona-picker="shown"/);
  assert.match(markup, /data-show-contact-card="false"/);
  assert.match(markup, /data-contact-action-kind="telegram"/);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 1);
});

test("HomePage preserves the resolved email webmail composer for initial visits", async () => {
  mocks.resolveHostedMurphContactOption.mockResolvedValueOnce({
    href: "mailto:murph@example.test",
    kind: "email",
    label: "Email",
    webmail: {
      href: "https://mail.google.com/mail/u/0/?tf=cm&to=murph%40example.test",
      label: "Gmail",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({}),
    }),
  );

  assert.match(markup, /data-contact-action-kind="email"/);
  assert.match(
    markup,
    /data-contact-action-webmail-href="https:\/\/mail\.google\.com\/mail\/u\/0\/\?tf=cm&amp;to=murph%40example\.test"/,
  );
  assert.match(markup, /data-contact-action-webmail-label="Gmail"/);
});

test("HomePage reload keeps canonically pending onboarding visible", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(
    await HomePage({
      searchParams: Promise.resolve({}),
    }),
  );

  assert.match(markup, /data-home-initial-visit-persona-picker="shown"/);
  assert.equal(mocks.resolveHostedMurphContactOption.mock.calls.length, 1);
});

test("HomePage asks for the first message when Murph has no way to send one", async () => {
  // Telegram is linked but no inbound thread exists yet, so Murph cannot open
  // the conversation and has to ask for it on the dashboard instead.
  mocks.readHostedMemberMessagingSetupState.mockResolvedValue({
    identity: { phoneLookupKey: null },
    routing: {
      linqChatId: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      telegramThreadId: null,
      telegramUserId: "456",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /Message Murph/);
  assert.match(markup, /Murph can&#x27;t message you first/);
  assert.ok(markup.indexOf("Message Murph") < markup.indexOf("Connect devices"));
});

test("HomePage hides the message step once Murph has a way to reach the member", async () => {
  mocks.readHostedMemberMessagingSetupState.mockResolvedValue({
    identity: { phoneLookupKey: null },
    routing: {
      linqChatId: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      telegramThreadId: "456",
      telegramUserId: "456",
    },
  });

  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  const markup = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({}) }));

  assert.doesNotMatch(markup, /Murph can&#x27;t message you first/);
  assert.match(markup, /Connect devices/);
});
