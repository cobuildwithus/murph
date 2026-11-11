import assert from "node:assert/strict";

import { HostedBillingStatus } from "@prisma/client";
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
  readHostedMemberBillingEligibilityState: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  routerRefresh: vi.fn(),
  readHostedAiUsageGate: vi.fn(),
  shouldShowHomeDeviceSyncStep: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
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


vi.mock("@/src/lib/device-sync/settings-service", () => ({
  buildHostedDeviceSyncSettingsResponse: mocks.buildHostedDeviceSyncSettingsResponse,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberBillingEligibilityState: mocks.readHostedMemberBillingEligibilityState,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

const MEMBER = {
  billingStatus: HostedBillingStatus.active,
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
  mocks.readHostedMemberBillingEligibilityState.mockResolvedValue(null);
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
  mocks.readHostedAiUsageGate.mockResolvedValue(null);
  mocks.shouldShowHomeDeviceSyncStep.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

test("DeviceSyncConnectCompletePage redirects callbacks to the settings completion dialog", async () => {
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
    "NEXT_REDIRECT:/settings?deviceSyncCompletion=1&source=connect&connectSource=oura&connectTarget=oura&deviceSyncStatus=connected&deviceSyncProvider=junction",
  );

  assert.equal(metadata.title, "Device Connected - Murph");
  expect(mocks.redirect).toHaveBeenCalledWith(
    "/settings?deviceSyncCompletion=1&source=connect&connectSource=oura&connectTarget=oura&deviceSyncStatus=connected&deviceSyncProvider=junction",
  );
});

test("resolveDeviceSyncCompletionDialogModel owns the WHOOP action contract", async () => {
  const { resolveDeviceSyncCompletionDialogModel } = await import(
    "@/src/lib/device-sync/connect-completion"
  );

  const model = await resolveDeviceSyncCompletionDialogModel({
    member: MEMBER,
    searchParams: {
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    },
  });

  expect(model?.setupGuide?.downloadAction).toEqual({
    ariaLabel: "Download App to sync WHOOP through Apple Health",
    href: "https://apps.apple.com/us/app/murph-ai/id6786145859",
    label: "Download App",
    rel: "noopener noreferrer",
    target: "_blank",
  });
  expect(model?.contactAction).toMatchObject({
    href: "sms:+15550100002?body=I%20just%20connected%20my%20WHOOP",
    kind: "imessage",
  });
});

test("ConnectionCompletion shows the connected dialog with the signed-in member's assigned Messages line", async () => {

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
      source: "assistant",
    }),
  }));

  assert.match(markup, /WHOOP is connected/);
  assert.match(markup, /Heads up: WHOOP doesn&#x27;t share all of your data automatically\./);
  assert.match(markup, /Syncing through Apple Health gives Murph the complete picture\./);
  assert.match(markup, /brand-logos\/connect\/whoop\.svg/);
  assert.doesNotMatch(markup, /data-completion-unverified/);
  assert.match(markup, /aria-label="See how to sync all of your WHOOP data"/);
  assert.match(markup, />Get full sync</);
  assert.doesNotMatch(markup, /href="whoop:/);
  assert.match(markup, /href="sms:\+15550100002\?body=I%20just%20connected%20my%20WHOOP"/);
  assert.match(markup, /Open Messages</);
  assert.match(markup, />Continue</);
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

test("ConnectionCompletion renders replay-stripped matching store truth as connected", async () => {

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "whoop",
      connectTarget: "whoop",
      deviceSyncCompletion: "1",
    }),
  }));

  assert.match(markup, /WHOOP is connected/);
  assert.match(markup, /WHOOP doesn&#x27;t share all of your data automatically\./);
  assert.match(markup, />Get full sync</);
  assert.match(markup, /href="sms:\+15550100002\?body=I%20just%20connected%20my%20WHOOP"/);
  assert.match(markup, /Open Messages</);
  assert.doesNotMatch(markup, /data-completion-unverified/);
  assert.doesNotMatch(markup, /Device connection complete/);
});

test("ConnectionCompletion uses a DB-assigned Messages line even when it is not in the legacy env pool", async () => {
  vi.stubEnv("HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS", "+15550100001");
  mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
    linqChatId: "linq-chat",
    linqRecipientPhone: "+15550100999",
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
      source: "assistant",
    }),
  }));

  assert.match(markup, /href="sms:\+15550100999\?body=I%20just%20connected%20my%20WHOOP"/);
  assert.match(markup, /Open Messages</);
  assert.doesNotMatch(markup, /href="sms:\+15550100001/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
});

test("ConnectionCompletion falls back to Telegram when no Messages line is assigned", async () => {
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

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /href="https:\/\/t\.me\/murph_bot\?text=I%20just%20connected%20my%20WHOOP"/);
  assert.match(markup, /aria-label="Text Murph in Telegram"/);
  assert.match(markup, />Text Murph</);
  assert.match(markup, />Continue</);
  assert.doesNotMatch(markup, /href="sms:/);
});

test("ConnectionCompletion uses connect source labels for Junction-backed targets", async () => {
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

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "fitbit",
      connectTarget: "fitbit",
      deviceSyncCompletion: "1",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Fitbit is connected/);
  assert.match(markup, /Go back to your chat\./);
  assert.match(markup, /href="sms:\+15550100002\?body=I%20just%20connected%20my%20Fitbit"/);
  assert.doesNotMatch(markup, /Junction is connected/);
  assert.doesNotMatch(markup, /Junction is ready/);
  assert.doesNotMatch(markup, /I%20just%20connected%20my%20Junction/);
  assert.doesNotMatch(markup, /WHOOP doesn&#x27;t share/);
  assert.doesNotMatch(markup, /apps\.apple\.com\/us\/app\/murph-ai/);
  assert.doesNotMatch(markup, />Get full sync</);
});

test("ConnectionCompletion does not attribute setup-only Mobvoi callbacks to an active Junction source", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-03T22:05:48.000Z",
    ok: true,
    sources: [
      buildConnectedSource("junction", "Junction", [
        {
          providerLabel: "Oura",
          resourceCount: 1,
          sourceProviderSlug: "oura",
          status: "connected",
        },
      ]),
    ],
  });

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "mobvoi-health",
      deviceSyncCompletion: "1",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Junction is connected/);
  assert.doesNotMatch(markup, /Mobvoi \/ TicWatch/u);
  assert.doesNotMatch(markup, /I%20just%20connected%20my%20Mobvoi/u);
});

test("ConnectionCompletion preserves a completed non-WHOOP Junction source when WHOOP is also connected", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-03T22:05:48.000Z",
    ok: true,
    sources: [
      buildConnectedSource("junction", "Junction", [
        {
          providerLabel: "WHOOP",
          resourceCount: 1,
          sourceProviderSlug: "whoop",
          status: "connected",
        },
        {
          providerLabel: "Fitbit",
          resourceCount: 1,
          sourceProviderSlug: "fitbit",
          status: "connected",
        },
      ]),
    ],
  });

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "fitbit",
      connectTarget: "fitbit",
      deviceSyncCompletion: "1",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Fitbit is connected/);
  assert.match(markup, /Go back to your chat\./);
  assert.match(markup, /href="sms:\+15550100002\?body=I%20just%20connected%20my%20Fitbit"/);
  assert.doesNotMatch(markup, /WHOOP doesn&#x27;t share/);
  assert.doesNotMatch(markup, /apps\.apple\.com\/us\/app\/murph-ai/);
  assert.doesNotMatch(markup, />Get full sync</);
});

test("ConnectionCompletion does not trust replay-stripped Junction child matches unless the child is connected", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-03T22:05:48.000Z",
    ok: true,
    sources: [
      buildConnectedSource("junction", "Junction", [
        {
          providerLabel: "Garmin",
          resourceCount: 1,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
        {
          providerLabel: "Oura",
          resourceCount: 1,
          sourceProviderSlug: "oura",
          status: "error",
        },
      ]),
    ],
  });

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "oura",
      connectTarget: "oura",
      deviceSyncCompletion: "1",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.match(markup, /data-completion-unverified="true"/);
  assert.doesNotMatch(markup, /Oura is connected/);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /Open Messages</);
});

test("ConnectionCompletion matches replay-stripped Junction upstream aliases by resolved connect identity", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-03T22:05:48.000Z",
    ok: true,
    sources: [
      buildConnectedSource("junction", "Junction", [
        {
          connectSourceId: "whoop",
          connectTarget: "whoop",
          providerLabel: "WHOOP",
          resourceCount: 1,
          sourceProviderSlug: "whoop_v2",
          status: "connected",
        },
      ]),
    ],
  });

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "whoop",
      connectTarget: "whoop",
      deviceSyncCompletion: "1",
    }),
  }));

  assert.match(markup, /WHOOP is connected/);
  assert.match(markup, /WHOOP doesn&#x27;t share all of your data automatically\./);
  assert.match(markup, />Get full sync</);
  assert.match(markup, /href="sms:\+15550100002\?body=I%20just%20connected%20my%20WHOOP"/);
  assert.match(markup, /Open Messages</);
  assert.doesNotMatch(markup, /data-completion-unverified/);
});

test("ConnectionCompletion keeps a continue-only dialog when there is no messaging destination", async () => {
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

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /WHOOP is connected/);
  assert.match(markup, /WHOOP doesn&#x27;t share all of your data automatically\./);
  assert.match(markup, />Get full sync</);
  assert.doesNotMatch(markup, /data-completion-unverified/);
  assert.match(markup, />Continue</);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.doesNotMatch(markup, /Open Messages</);
  assert.doesNotMatch(markup, /aria-label="Text Murph in Telegram"/);
});

test("ConnectionCompletion keeps the no-member fallback generic", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.match(markup, /data-completion-unverified="true"/);
  assert.doesNotMatch(markup, /WHOOP is connected/);
  assert.doesNotMatch(markup, /apps\.apple\.com\/us\/app\/murph-ai/);
  assert.doesNotMatch(markup, />Get full sync</);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  expect(mocks.buildHostedDeviceSyncSettingsResponse).not.toHaveBeenCalled();
  expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
});

test("ConnectionCompletion marks replay-stripped member completions unverified when strict identity misses", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-03T22:05:48.000Z",
    ok: true,
    sources: [buildConnectedSource("oura", "Oura")],
  });

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "whoop",
      connectTarget: "whoop",
      deviceSyncCompletion: "1",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.match(markup, /data-completion-unverified="true"/);
  assert.doesNotMatch(markup, /WHOOP is connected/);
  assert.doesNotMatch(markup, /Oura is connected/);
  assert.doesNotMatch(markup, /apps\.apple\.com\/us\/app\/murph-ai/);
  assert.doesNotMatch(markup, />Get full sync</);
  assert.doesNotMatch(markup, /Open Messages</);
  assert.doesNotMatch(markup, /href="sms:/);
});

test("ConnectionCompletion keeps bare completion markers generic and verified", async () => {

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.doesNotMatch(markup, /data-completion-unverified/);
  assert.doesNotMatch(markup, /WHOOP is connected/);
  assert.doesNotMatch(markup, /Open Messages</);
});

test("ConnectionCompletion marks replay-stripped no-member completions unverified", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "whoop",
      connectTarget: "whoop",
      deviceSyncCompletion: "1",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.match(markup, /data-completion-unverified="true"/);
  assert.doesNotMatch(markup, /WHOOP is connected/);
  assert.doesNotMatch(markup, /apps\.apple\.com\/us\/app\/murph-ai/);
  assert.doesNotMatch(markup, />Get full sync</);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  expect(mocks.buildHostedDeviceSyncSettingsResponse).not.toHaveBeenCalled();
  expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
});

test("ConnectionCompletion does not trust connected query state without a matching active source", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-03T22:05:48.000Z",
    ok: true,
    sources: [],
  });

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.match(markup, /data-completion-unverified="true"/);
  assert.doesNotMatch(markup, /WHOOP is connected/);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.doesNotMatch(markup, /Open Messages</);
  assert.doesNotMatch(markup, /aria-label="Text Murph in Telegram"/);
});

test("ConnectionCompletion marks connected callbacks unverified when settings fail to load", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockRejectedValueOnce(
    new Error("settings unavailable"),
  );

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.match(markup, /data-completion-unverified="true"/);
  assert.doesNotMatch(markup, /WHOOP is connected/);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.doesNotMatch(markup, /Open Messages</);
});

test("ConnectionCompletion does not mark provider-only completion URLs unverified", async () => {

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncProvider: "whoop",
    }),
  }));

  assert.match(markup, /Device connection complete/);
  assert.match(markup, /Open Murph to confirm your connected sources\./);
  assert.doesNotMatch(markup, /data-completion-unverified/);
  assert.doesNotMatch(markup, /WHOOP is connected/);
  assert.doesNotMatch(markup, /Open Messages</);
});

test("ConnectionCompletion does not offer a messaging success CTA after callback errors", async () => {

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      deviceSyncCompletion: "1",
      deviceSyncError: "OAUTH_STATE_INVALID",
      deviceSyncProvider: "whoop",
      deviceSyncStatus: "error",
    }),
  }));

  assert.match(markup, /WHOOP didn’t connect\./);
  assert.match(markup, /Nothing changed\. Try again\./);
  assert.doesNotMatch(markup, /data-completion-unverified/);
  assert.match(markup, /href="\/connect"[^>]*>.*Try again/s);
  assert.match(markup, />Continue</);
  assert.doesNotMatch(markup, /apps\.apple\.com\/us\/app\/murph-ai/);
  assert.doesNotMatch(markup, />Get full sync</);
  assert.doesNotMatch(markup, /href="sms:/);
  assert.doesNotMatch(markup, /t\.me\/murph_bot/);
  assert.doesNotMatch(markup, /Open Messages</);
  assert.doesNotMatch(markup, /aria-label="Text Murph in Telegram"/);
});

test("ConnectionCompletion guides failed Fitbit links toward Google Health setup", async () => {

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "fitbit",
      connectTarget: "fitbit",
      deviceSyncCompletion: "1",
      deviceSyncError: "JUNCTION_LINK_FAILED",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "error",
      source: "connect",
    }),
  }));

  assert.match(markup, /Fitbit didn’t connect\./);
  assert.match(
    markup,
    /Fitbit now connects through Google Health\. Open the Google Health app, sign in with your Google Account, and finish setup\. Then try again and allow every permission\./,
  );
  assert.match(markup, /href="\/connect"[^>]*>.*Try again/s);
  assert.doesNotMatch(markup, /Nothing changed\. Try again\./);
});

test("ConnectionCompletion keeps generic retry copy for other Fitbit callback failures", async () => {

  const markup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectSource: "fitbit",
      connectTarget: "fitbit",
      deviceSyncCompletion: "1",
      deviceSyncError: "CALLBACK_PROOF_INVALID",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "error",
      source: "connect",
    }),
  }));

  assert.match(markup, /Fitbit didn’t connect\./);
  assert.match(markup, /Nothing changed\. Try again\./);
  assert.doesNotMatch(markup, /Google Health/);
});

test("ConnectionCompletion keeps connected-app completion dialogs verified", async () => {

  const successMarkup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectedAppCompletion: "1",
      connectedAppStatus: "success",
      toolkit: "gmail",
    }),
  }));

  assert.match(successMarkup, /Gmail is connected/);
  assert.match(successMarkup, /brand-logos\/connect\/gmail\.svg/);
  assert.doesNotMatch(successMarkup, /data-completion-unverified/);

  const failureMarkup = renderToStaticMarkup(await ConnectionCompletion({
    searchParams: Promise.resolve({
      connectedAppCompletion: "1",
      connectedAppStatus: "error",
    }),
  }));

  assert.match(failureMarkup, /Your integration didn’t connect\./);
  assert.match(failureMarkup, /Ask Murph for a new link\./);
  assert.doesNotMatch(failureMarkup, /brand-logos\/connect/);
  assert.doesNotMatch(failureMarkup, /data-completion-unverified/);
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

async function ConnectionCompletion({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { renderConnectionCompletion } = await import("@/src/components/device-sync/connection-completion");
  const { authenticatedMember } = await mocks.getHostedPageAuthSnapshot();
  return renderConnectionCompletion({ member: authenticatedMember, searchParams: await searchParams });
}
