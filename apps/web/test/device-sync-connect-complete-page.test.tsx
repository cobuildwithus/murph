import assert from "node:assert/strict";

import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";
import type { HostedAppSession } from "@/src/lib/hosted-onboarding/app-session";

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
  getHostedAppSession: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/settings-service", () => ({
  buildHostedDeviceSyncSettingsResponse: mocks.buildHostedDeviceSyncSettingsResponse,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  getHostedAppSession: mocks.getHostedAppSession,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

beforeEach(() => {
  vi.stubEnv("HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS", "+15550100001,+15550100002");
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "@murph_bot");
  mocks.getHostedAppSession.mockResolvedValue(buildHostedAppSession());
  mocks.getPrisma.mockReturnValue({ hostedMemberRouting: {} });
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
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

test("DeviceSyncConnectCompletePage prefers the signed-in member's assigned Messages line", async () => {
  const { default: DeviceSyncConnectCompletePage, metadata } = await import(
    "../app/device-sync/connect/complete/page"
  );
  const markup = renderToStaticMarkup(await DeviceSyncConnectCompletePage({
    searchParams: Promise.resolve({
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
      source: "assistant",
    }),
  }));

  assert.equal(metadata.title, "Device Connected - Murph");
  assert.match(markup, /WHOOP is connected/);
  assert.match(markup, /WHOOP is now available in your connected sources\./);
  assert.match(markup, /href="sms:\+15550100002\?body=I%20just%20connected%20my%20WHOOP"/);
  assert.match(markup, />Text Murph</);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.match(markup, /href="\/settings"[^>]*>.*View devices/s);
  expect(mocks.buildHostedDeviceSyncSettingsResponse).toHaveBeenCalledWith({
    member: buildHostedAppSession().member,
  });
  expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: { hostedMemberRouting: {} },
  });
});

test("DeviceSyncConnectCompletePage falls back to Telegram when no Messages line is assigned", async () => {
  const { default: DeviceSyncConnectCompletePage } = await import(
    "../app/device-sync/connect/complete/page"
  );
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

  const markup = renderToStaticMarkup(await DeviceSyncConnectCompletePage({
    searchParams: Promise.resolve({
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /href="https:\/\/t\.me\/murph_bot\?text=I\+just\+connected\+my\+WHOOP"/);
  assert.match(markup, /aria-label="Open Telegram in a new tab"/);
  assert.match(markup, />Open Telegram</);
  assert.doesNotMatch(markup, /href="sms:/);
});

test("DeviceSyncConnectCompletePage uses connect source labels for Junction-backed targets", async () => {
  const { default: DeviceSyncConnectCompletePage } = await import(
    "../app/device-sync/connect/complete/page"
  );
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

  const markup = renderToStaticMarkup(await DeviceSyncConnectCompletePage({
    searchParams: Promise.resolve({
      connectSource: "fitbit",
      connectTarget: "fitbit",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Fitbit is connected/);
  assert.match(markup, /Fitbit is now available in your connected sources\./);
  assert.match(markup, /href="sms:\+15550100002\?body=I%20just%20connected%20my%20Fitbit"/);
  assert.doesNotMatch(markup, /Junction is connected/);
  assert.doesNotMatch(markup, /Junction is now available/);
  assert.doesNotMatch(markup, /I%20just%20connected%20my%20Junction/);
});

test("DeviceSyncConnectCompletePage keeps the settings fallback when there is no messaging destination", async () => {
  const { default: DeviceSyncConnectCompletePage } = await import(
    "../app/device-sync/connect/complete/page"
  );
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

  const markup = renderToStaticMarkup(await DeviceSyncConnectCompletePage({
    searchParams: Promise.resolve({
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /WHOOP is connected/);
  assert.match(markup, /WHOOP is connected and ready in Murph\. No extra step is needed\./);
  assert.match(markup, /href="\/settings"[^>]*>.*View devices/s);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.doesNotMatch(markup, />Text Murph</);
  assert.doesNotMatch(markup, />Open Telegram</);
});

test("DeviceSyncConnectCompletePage keeps the no-session fallback generic", async () => {
  const { default: DeviceSyncConnectCompletePage } = await import(
    "../app/device-sync/connect/complete/page"
  );
  mocks.getHostedAppSession.mockResolvedValueOnce(null);

  const markup = renderToStaticMarkup(await DeviceSyncConnectCompletePage({
    searchParams: Promise.resolve({
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /WHOOP is connected/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  expect(mocks.buildHostedDeviceSyncSettingsResponse).not.toHaveBeenCalled();
  expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
});

test("DeviceSyncConnectCompletePage does not offer a messaging success CTA after callback errors", async () => {
  const { default: DeviceSyncConnectCompletePage } = await import(
    "../app/device-sync/connect/complete/page"
  );

  const markup = renderToStaticMarkup(await DeviceSyncConnectCompletePage({
    searchParams: Promise.resolve({
      deviceSyncError: "OAUTH_STATE_INVALID",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "error",
    }),
  }));

  assert.match(markup, /WHOOP connection did not finish/);
  assert.match(markup, /Try again from Murph when you are ready\./);
  assert.match(markup, /href="\/connect"[^>]*>.*Try again/s);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.doesNotMatch(markup, />Text Murph</);
  assert.doesNotMatch(markup, />Open Telegram</);
});

function buildHostedAppSession(): HostedAppSession {
  return {
    expiresAt: new Date("2026-06-02T22:05:48.000Z"),
    member: {
      billingStatus: "active",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    },
    privyUserId: "privy_123",
    sessionId: "hws_123",
  };
}

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
