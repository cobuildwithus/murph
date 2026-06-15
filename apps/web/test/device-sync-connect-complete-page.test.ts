import assert from "node:assert/strict";

import { createElement, type AnchorHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

const mocks = vi.hoisted(() => ({
  buildHostedDeviceSyncSettingsResponse: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  resolveHostedAiUsageGate: vi.fn(),
  shouldShowHomeDeviceSyncStep: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/src/components/home/feature-highlights", () => ({
  FeatureHighlights: () => createElement("section", null, "Feature highlights"),
}));

vi.mock("@/src/components/home/onboarding-steps", () => ({
  OnboardingSteps: () => createElement("section", null, "Onboarding steps"),
}));

vi.mock("@/src/components/home/upload-labs-action", () => ({
  UploadLabsActionFallback: () =>
    createElement("button", { type: "button" }, "Sync fallback"),
  UploadLabsMurphContactAction: () =>
    createElement("button", { type: "button" }, "Sync"),
}));

vi.mock("@/src/components/home/usage-limit-banner", () => ({
  UsageLimitBanner: () => createElement("section", null, "Usage limit"),
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: HTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) =>
    createElement("button", props, children),
  buttonVariants: ({ className }: { className?: string } = {}) => className ?? "",
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
  }) => (open ? createElement("div", { "data-dialog": "open" }, children) : null),
  DialogContent: (props: HTMLAttributes<HTMLDivElement> & {
    children?: ReactNode;
    showCloseButton?: boolean;
  }) => {
    const { children, showCloseButton, ...rest } = props;
    void showCloseButton;
    return createElement("div", rest, children);
  },
  DialogDescription: ({
    children,
    ...props
  }: HTMLAttributes<HTMLParagraphElement> & { children?: ReactNode }) =>
    createElement("p", props, children),
  DialogHeader: ({
    children,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) =>
    createElement("div", props, children),
  DialogTitle: ({
    children,
    ...props
  }: HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode }) =>
    createElement("h2", props, children),
}));

vi.mock("@/src/components/ui/page-header", () => ({
  PageHeader: ({
    description,
    eyebrow,
    title,
  }: {
    description: string;
    eyebrow: string;
    title: string;
  }) =>
    createElement("header", null, [
      createElement("p", { key: "eyebrow" }, eyebrow),
      createElement("h1", { key: "title" }, title),
      createElement("p", { key: "description" }, description),
    ]),
}));

vi.mock("@/src/lib/device-sync/home-onboarding", () => ({
  shouldShowHomeDeviceSyncStep: mocks.shouldShowHomeDeviceSyncStep,
}));

vi.mock("@/src/lib/device-sync/settings-service", () => ({
  buildHostedDeviceSyncSettingsResponse: mocks.buildHostedDeviceSyncSettingsResponse,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

const MEMBER = {
  billingStatus: "active",
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  id: "member_123",
  suspendedAt: null,
  updatedAt: new Date("2026-05-02T00:00:00.000Z"),
};

beforeEach(() => {
  vi.stubEnv("HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS", "+15550100001,+15550100002");
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "@murph_bot");
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: MEMBER,
    session: null,
  });
  mocks.getPrisma.mockReturnValue({ hostedMemberRouting: {} });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue(null);
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValue({
    generatedAt: "2026-05-03T22:05:48.000Z",
    ok: true,
    sources: [buildConnectedSource("whoop", "WHOOP")],
  });
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: "linq-chat",
    linqRecipientPhone: "+15550100002",
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: "telegram-thread",
    telegramUserId: "telegram-user",
    telegramUserLookupKey: "lookup",
  });
  mocks.resolveHostedAiUsageGate.mockResolvedValue(null);
  mocks.shouldShowHomeDeviceSyncStep.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

test("DeviceSyncConnectCompletePage redirects callbacks to the home completion dialog", async () => {
  const { default: DeviceSyncConnectCompletePage, metadata } = await import(
    "../app/device-sync/connect/complete/page"
  );

  await expect(DeviceSyncConnectCompletePage({
    searchParams: Promise.resolve({
      connectSource: "oura",
      connectTarget: "oura",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
      source: "connect",
    }),
  })).rejects.toThrow(
    "NEXT_REDIRECT:/home?deviceSyncCompletion=1&source=connect&connectSource=oura&connectTarget=oura&deviceSyncStatus=connected&deviceSyncProvider=junction",
  );

  assert.equal(metadata.title, "Device Connected - Murph");
  expect(mocks.redirect).toHaveBeenCalledWith(
    "/home?deviceSyncCompletion=1&source=connect&connectSource=oura&connectTarget=oura&deviceSyncStatus=connected&deviceSyncProvider=junction",
  );
});

test("HomePage shows the connected dialog with the signed-in member's assigned Messages line", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");

  const markup = renderToStaticMarkup(await HomePage({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
      source: "assistant",
    }),
  }));

  assert.match(markup, /WHOOP is connected/);
  assert.match(markup, /WHOOP is ready\. Say hi to start exploring your data\./);
  assert.match(markup, /data-device-sync-icon="watch"/);
  assert.match(markup, /href="sms:\+15550100002\?body=I%20just%20connected%20my%20WHOOP"/);
  assert.match(markup, />Text Murph</);
  assert.match(markup, /variant="ghost"[^>]*>Continue exploring</);
  assert.doesNotMatch(markup, /Go home/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  expect(mocks.buildHostedDeviceSyncSettingsResponse).toHaveBeenCalledWith({
    member: MEMBER,
  });
  expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: { hostedMemberRouting: {} },
  });
});

test("HomePage falls back to Telegram when no Messages line is assigned", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: "telegram-thread",
    telegramUserId: "telegram-user",
    telegramUserLookupKey: "lookup",
  });

  const markup = renderToStaticMarkup(await HomePage({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /href="https:\/\/t\.me\/murph_bot\?text=I\+just\+connected\+my\+WHOOP"/);
  assert.match(markup, /aria-label="Open Telegram in a new tab"/);
  assert.match(markup, />Open Telegram</);
  assert.match(markup, />Continue exploring</);
  assert.doesNotMatch(markup, /href="sms:/);
});

test("HomePage uses connect source labels for Junction-backed targets", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-03T22:05:48.000Z",
    ok: true,
    sources: [
      buildConnectedSource("junction", "Junction", [
        {
          providerLabel: "Fitbit",
          resourceCount: 1,
          sourceProviderSlug: "fitbit",
          status: "connected",
        },
      ]),
    ],
  });

  const markup = renderToStaticMarkup(await HomePage({
    searchParams: Promise.resolve({
      connectSource: "fitbit",
      connectTarget: "fitbit",
      deviceSyncCompletion: "1",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Fitbit is connected/);
  assert.match(markup, /Fitbit is ready\. Say hi to start exploring your data\./);
  assert.match(markup, /href="sms:\+15550100002\?body=I%20just%20connected%20my%20Fitbit"/);
  assert.doesNotMatch(markup, /Junction is connected/);
  assert.doesNotMatch(markup, /Junction is ready/);
  assert.doesNotMatch(markup, /I%20just%20connected%20my%20Junction/);
});

test("HomePage keeps a continue-only dialog when there is no messaging destination", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });

  const markup = renderToStaticMarkup(await HomePage({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /WHOOP is connected/);
  assert.match(markup, /WHOOP is ready\. Murph will start learning from your data\./);
  assert.match(markup, />Continue exploring</);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.doesNotMatch(markup, />Text Murph</);
  assert.doesNotMatch(markup, />Open Telegram</);
});

test("HomePage keeps the no-member fallback generic", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });

  const markup = renderToStaticMarkup(await HomePage({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.doesNotMatch(markup, /WHOOP is connected/);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  expect(mocks.buildHostedDeviceSyncSettingsResponse).not.toHaveBeenCalled();
  expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
});

test("HomePage does not trust connected query state without a matching active source", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-03T22:05:48.000Z",
    ok: true,
    sources: [],
  });

  const markup = renderToStaticMarkup(await HomePage({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.doesNotMatch(markup, /WHOOP is connected/);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.doesNotMatch(markup, />Text Murph</);
  assert.doesNotMatch(markup, />Open Telegram</);
});

test("HomePage does not offer a messaging success CTA after callback errors", async () => {
  const { default: HomePage } = await import("../app/(dashboard)/home/page");

  const markup = renderToStaticMarkup(await HomePage({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncError: "OAUTH_STATE_INVALID",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "error",
    }),
  }));

  assert.match(markup, /WHOOP connection did not finish/);
  assert.match(markup, /Try again from Murph when you are ready\./);
  assert.match(markup, /href="\/connect"[^>]*>.*Try again/s);
  assert.match(markup, />Continue exploring</);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.doesNotMatch(markup, />Text Murph</);
  assert.doesNotMatch(markup, />Open Telegram</);
});

function buildConnectedSource(
  provider: string,
  providerLabel: string,
  upstreamSources: HostedDeviceSyncSettingsSource["upstreamSources"] = [],
): HostedDeviceSyncSettingsSource {
  return {
    connectionId: "connection_123",
    connectedAt: "2026-05-03T22:05:47.835Z",
    detail: "Connected and ready.",
    displayName: null,
    guidance: "Murph keeps an eye on this in the background.",
    headline: "Connected",
    lastActivityAt: "2026-05-03T22:05:47.835Z",
    lastSuccessfulSyncAt: null,
    lastWebhookAt: null,
    nextReconcileAt: null,
    primaryAction: null,
    provider,
    providerConfigured: true,
    providerLabel,
    secondaryAction: null,
    state: "active",
    statusLabel: "Connected",
    tone: "calm",
    updatedAt: "2026-05-03T22:05:47.835Z",
    upstreamSources,
  };
}
