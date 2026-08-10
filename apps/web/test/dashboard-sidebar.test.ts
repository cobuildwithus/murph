import assert from "node:assert/strict";

import {
  act,
  cloneElement,
  createElement,
  isValidElement,
  useEffect,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logoutHostedAppSession: vi.fn(),
  refresh: vi.fn(),
  requestHostedOnboardingJson: vi.fn(),
  setOpenMobile: vi.fn(),
  usePathname: vi.fn(),
}));

vi.mock("next/link", () => ({
  default(props: { children?: ReactNode; className?: string; href: string }) {
    return createElement(
      "a",
      { className: props.className, href: props.href },
      props.children,
    );
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useRouter: () => ({
    refresh: mocks.refresh,
  }),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel", () => ({
  HostedAuthPanel: () => createElement("div", null, "Hosted auth panel"),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-app-session-client", () => ({
  logoutHostedAppSession: mocks.logoutHostedAppSession,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-privy-logout", () => ({
  HostedPrivyLogout: ({ onDone }: { onDone: () => void }) => {
    useEffect(() => {
      onDone();
    }, [onDone]);

    return null;
  },
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({
    children,
    className,
    type,
  }: {
    children?: ReactNode;
    className?: string;
    type?: "button" | "submit" | "reset";
  }) => createElement("button", { className, type }, children),
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DialogContent: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DialogDescription: ({ children }: { children: ReactNode }) =>
    createElement("p", null, children),
  DialogHeader: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DialogTitle: ({ children }: { children: ReactNode }) =>
    createElement("h2", null, children),
}));

vi.mock("@/src/components/ui/sidebar", () => ({
  useSidebar: () => ({
    setOpenMobile: mocks.setOpenMobile,
  }),
  Sidebar: ({ children }: { children: ReactNode }) =>
    createElement("nav", null, children),
  SidebarHeader: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  SidebarContent: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  SidebarFooter: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  SidebarMenu: ({ children }: { children: ReactNode }) =>
    createElement("ul", null, children),
  SidebarMenuItem: ({ children }: { children: ReactNode }) =>
    createElement("li", null, children),
  SidebarMenuButton: ({
    "aria-label": ariaLabel,
    children,
    render,
    isActive,
  }: {
    "aria-label"?: string;
    children?: ReactNode;
    render?: ReactNode;
    isActive?: boolean;
  }) =>
    createElement(
      "div",
      { "aria-label": ariaLabel, "data-active": isActive ? "true" : "false" },
      render ?? children,
    ),
}));

vi.mock("@/src/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  AvatarFallback: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("@/src/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DropdownMenuTrigger: ({
    render,
    children,
  }: {
    render?: ReactNode;
    children?: ReactNode;
  }) => createElement("div", null, render, children),
  DropdownMenuContent: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DropdownMenuGroup: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
    render,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    render?: ReactNode;
  }) => isValidElement<{ children?: ReactNode }>(render)
    ? createElement("div", null, cloneElement(render, undefined, children))
    : createElement(
        "div",
        {
          "aria-disabled": disabled ? "true" : undefined,
          onClick,
          role: "menuitem",
        },
        children,
      ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DropdownMenuSeparator: () => createElement("hr"),
}));

import { Sidebar } from "../src/components/dashboard/sidebar";
import type { HostedDeviceSyncSettingsSource } from "../src/lib/device-sync/settings-surface";
import { summarizeSidebarDeviceSyncStatus } from "../src/lib/device-sync/sidebar-status";
import { renderClientComponent } from "./render-client-component";

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
});

beforeEach(() => {
  mocks.usePathname.mockReturnValue("/experiments");
  mocks.logoutHostedAppSession.mockReset();
  mocks.logoutHostedAppSession.mockResolvedValue(undefined);
  mocks.requestHostedOnboardingJson.mockReset();
  mocks.requestHostedOnboardingJson.mockRejectedValue(new Error("unavailable"));
  mocks.refresh.mockClear();
  mocks.setOpenMobile.mockClear();
});

test("Sidebar renders Patterns instead of the internal Overview route", () => {
  mocks.usePathname.mockReturnValue("/experiments");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /href="\/home"[^>]*>\s*<svg/);
  assert.match(markup, /href="\/patterns"/);
  assert.match(markup, />Patterns<\/a>/);
  assert.doesNotMatch(markup, /href="\/overview"/);
  assert.doesNotMatch(markup, />Overview<\/a>/);
});

test("Sidebar marks Patterns as active on its page", () => {
  mocks.usePathname.mockReturnValue("/patterns");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(
    markup,
    /data-active="true">\s*<a[^>]*href="\/patterns"[^>]*>[\s\S]*Patterns<\/a>/,
  );
});

test("Sidebar renders Environment as an active primary destination", () => {
  mocks.usePathname.mockReturnValue("/environment");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(
    markup,
    /data-active="true">\s*<a[^>]*href="\/environment"[^>]*>[\s\S]*Environment<\/a>/,
  );
});

test("Sidebar renders an active Biomarkers tab for the live RHR page", () => {
  mocks.usePathname.mockReturnValue("/biomarkers/resting-heart-rate");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /href="\/biomarkers"/);
  assert.match(
    markup,
    /data-active="true">\s*<a[^>]*href="\/biomarkers"[^>]*>[\s\S]*Biomarkers<\/a>/,
  );
});

test("Sidebar does not render research-only Age navigation", () => {
  mocks.usePathname.mockReturnValue("/home");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.doesNotMatch(markup, /href="\/age"/);
  assert.doesNotMatch(markup, />Age<\/a>/);
});

test("Sidebar keeps the read-only Labs catalog out of navigation", () => {
  mocks.usePathname.mockReturnValue("/labs");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.doesNotMatch(markup, /href="\/labs"/);
  assert.doesNotMatch(markup, />Labs<\/a>/);
});

test("Sidebar keeps the private Training page out of navigation", () => {
  mocks.usePathname.mockReturnValue("/training");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.doesNotMatch(markup, /href="\/training"/);
  assert.doesNotMatch(markup, />Training<\/a>/);
});

test("Sidebar keeps the Biomarkers tab active across biomarker section routes", () => {
  mocks.usePathname.mockReturnValue("/biomarkers/heart-rate-variability");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(
    markup,
    /data-active="true">\s*<a[^>]*href="\/biomarkers"[^>]*>[\s\S]*Biomarkers<\/a>/,
  );
});

test("Sidebar keeps Records out of navigation", () => {
  mocks.usePathname.mockReturnValue("/records/connect");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.doesNotMatch(markup, /href="\/records"/);
  assert.doesNotMatch(markup, />Records<\/a>/);
});

test("Sidebar ignores supplied signed-in user labels in the account trigger", () => {
  mocks.usePathname.mockReturnValue("/experiments");

  const markup = renderToStaticMarkup(
    createElement(Sidebar, {
      initialAuth: {
        authenticated: true,
        label: "initial@example.com",
      },
    }),
  );

  assert.match(markup, /href="\/settings"[^>]*>Settings<\/a>/);
  assert.match(markup, /Sign out/);
  assert.match(markup, /aria-label="Open user menu"/);
  assert.doesNotMatch(markup, /initial@example\.com/);
  assert.doesNotMatch(markup, />Account</);
});

test("Sidebar renders signed-in account controls without a visible fallback label", () => {
  mocks.usePathname.mockReturnValue("/experiments");

  const markup = renderToStaticMarkup(
    createElement(Sidebar, {
      initialAuth: {
        authenticated: true,
        label: null,
      },
    }),
  );

  assert.match(markup, /href="\/settings"[^>]*>Settings<\/a>/);
  assert.match(markup, /Sign out/);
  assert.doesNotMatch(markup, />Account</);
  assert.doesNotMatch(markup, /\*{3,4}\s*\d{4}/);
  assert.doesNotMatch(markup, /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/);
  assert.doesNotMatch(markup, /\bdid:[a-z]+:[\w.-]+\b/);
});

test("Sidebar surfaces a visible error when sign out fails", async () => {
  let rejectSignOut!: (reason?: unknown) => void;

  mocks.logoutHostedAppSession.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectSignOut = reject;
      }),
  );

  const { cleanup, container, window } = await renderClientComponent(
    createElement(Sidebar, {
      initialAuth: {
        authenticated: true,
        label: null,
      },
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const signOutItem = Array.from(
    container.querySelectorAll('[role="menuitem"]'),
  ).find((element) => element.textContent === "Sign out");
  assert.ok(signOutItem);

  await act(async () => {
    signOutItem.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  assert.equal(mocks.logoutHostedAppSession.mock.calls.length, 1);
  assert.match(container.textContent ?? "", /Signing out\.\.\./);

  await act(async () => {
    signOutItem.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });

  assert.equal(mocks.logoutHostedAppSession.mock.calls.length, 1);

  await act(async () => {
    rejectSignOut(new Error("network"));
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.equal(mocks.refresh.mock.calls.length, 0);
  assert.match(
    container.textContent ?? "",
    /Sign out did not finish\. Try again\./,
  );
  assert.equal(
    container.querySelector('[role="alert"]')?.textContent,
    "Sign out did not finish. Try again.",
  );

  mocks.logoutHostedAppSession.mockResolvedValueOnce(undefined);

  await act(async () => {
    signOutItem.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.equal(mocks.logoutHostedAppSession.mock.calls.length, 2);
  assert.equal(mocks.refresh.mock.calls.length, 1);
  assert.doesNotMatch(
    container.textContent ?? "",
    /Sign out did not finish\. Try again\./,
  );
  assert.equal(container.querySelector('[role="alert"]'), null);
});

test("Sidebar keeps Settings out of the primary navigation", () => {
  mocks.usePathname.mockReturnValue("/settings");

  const markup = renderToStaticMarkup(
    createElement(Sidebar, {
      initialAuth: {
        authenticated: true,
        label: null,
      },
    }),
  );

  assert.match(markup, /href="\/settings"[^>]*>Settings<\/a>/);
  assert.doesNotMatch(
    markup,
    /data-active="true">\s*<a[^>]*href="\/settings"[^>]*>Settings<\/a>/,
  );
});

test("Sidebar renders the supplied server chat action", () => {
  mocks.usePathname.mockReturnValue("/experiments");

  const markup = renderToStaticMarkup(
    createElement(Sidebar, {
      chatAction: createElement(
        "li",
        null,
        createElement(
          "a",
          {
            href: "sms:+15550100001",
          },
          "Chat with Murph",
        ),
      ),
    }),
  );

  assert.match(markup, /href="sms:\+15550100001"[^>]*>Chat with Murph<\/a>/);
  assert.doesNotMatch(markup, /href="\/chat"[^>]*>Chat with Murph<\/a>/);
});

test("Sidebar renders a login CTA card when signed out", () => {
  mocks.usePathname.mockReturnValue("/experiments");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /Experiments tailored to you/);
  assert.match(markup, /<button[^>]*>Log in or sign up<\/button>/);
  assert.match(markup, /w-full/);
  assert.doesNotMatch(markup, /Sign up/);
  assert.doesNotMatch(markup, />Account</);
  assert.doesNotMatch(markup, /Sign out/);
});

test("Sidebar uses initial server app-session auth", () => {
  mocks.usePathname.mockReturnValue("/experiments");

  const markup = renderToStaticMarkup(
    createElement(Sidebar, {
      initialAuth: {
        authenticated: true,
        label: "initial@example.com",
      },
    }),
  );

  assert.match(markup, /Sign out/);
  assert.doesNotMatch(markup, /Log in or sign up/);
  assert.doesNotMatch(markup, /initial@example\.com/);
  assert.doesNotMatch(markup, />Account</);
});

test("Sidebar does not render a hardcoded wearable connection status", () => {
  mocks.usePathname.mockReturnValue("/experiments");

  const markup = renderToStaticMarkup(
    createElement(Sidebar, {
      initialAuth: {
        authenticated: true,
        label: null,
      },
    }),
  );

  assert.doesNotMatch(markup, /Oura connected/);
});

test("summarizeSidebarDeviceSyncStatus reflects connected source state", () => {
  assert.deepEqual(
    summarizeSidebarDeviceSyncStatus([
      createDeviceSyncSource({
        providerLabel: "WHOOP",
        statusLabel: "Connected",
        state: "active",
        tone: "calm",
      }),
    ]),
    {
      message: "WHOOP connected",
      tone: "connected",
    },
  );
});

test("summarizeSidebarDeviceSyncStatus shortens the generic wearable source label", () => {
  assert.deepEqual(
    summarizeSidebarDeviceSyncStatus([
      createDeviceSyncSource({
        provider: "junction",
        providerLabel: "Wearable source",
        statusLabel: "Setup incomplete",
        state: "active",
        tone: "attention",
      }),
    ]),
    {
      message: "Wearable setup incomplete",
      tone: "attention",
    },
  );
});

test("summarizeSidebarDeviceSyncStatus uses a single connected upstream source label", () => {
  assert.deepEqual(
    summarizeSidebarDeviceSyncStatus([
      createDeviceSyncSource({
        provider: "junction",
        providerLabel: "Junction",
        statusLabel: "Connected",
        state: "active",
        tone: "calm",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            resourceCount: 3,
            sourceProviderSlug: "garmin",
            status: "connected",
          },
        ],
      }),
    ]),
    {
      message: "Garmin connected",
      tone: "connected",
    },
  );
});

test("summarizeSidebarDeviceSyncStatus summarizes multiple connected upstream sources", () => {
  assert.deepEqual(
    summarizeSidebarDeviceSyncStatus([
      createDeviceSyncSource({
        provider: "junction",
        providerLabel: "Junction",
        statusLabel: "Connected",
        state: "active",
        tone: "calm",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            resourceCount: 3,
            sourceProviderSlug: "garmin",
            status: "connected",
          },
          {
            providerLabel: "Oura",
            resourceCount: 2,
            sourceProviderSlug: "oura",
            status: "connected",
          },
        ],
      }),
    ]),
    {
      message: "2 wearables connected",
      tone: "connected",
    },
  );
});

test("summarizeSidebarDeviceSyncStatus prioritizes reconnect and disconnected states", () => {
  assert.deepEqual(
    summarizeSidebarDeviceSyncStatus([
      createDeviceSyncSource({
        providerLabel: "Garmin",
        statusLabel: "Connected",
        state: "active",
        tone: "calm",
      }),
      createDeviceSyncSource({
        providerLabel: "WHOOP",
        statusLabel: "Needs reconnect",
        state: "reauthorization_required",
        tone: "attention",
      }),
    ]),
    {
      message: "WHOOP needs reconnect",
      tone: "attention",
    },
  );

  assert.deepEqual(
    summarizeSidebarDeviceSyncStatus([
      createDeviceSyncSource({
        providerLabel: "WHOOP",
        statusLabel: "Disconnected",
        state: "disconnected",
        tone: "muted",
      }),
    ]),
    {
      message: "WHOOP disconnected",
      tone: "muted",
    },
  );
});

test("summarizeSidebarDeviceSyncStatus preserves unavailable connected state", () => {
  assert.deepEqual(
    summarizeSidebarDeviceSyncStatus([
      createDeviceSyncSource({
        providerLabel: "Garmin",
        statusLabel: "Unavailable",
        state: "unavailable",
        tone: "muted",
      }),
    ]),
    {
      message: "Garmin unavailable",
      tone: "muted",
    },
  );
});

function createDeviceSyncSource(
  overrides: Partial<HostedDeviceSyncSettingsSource>,
): HostedDeviceSyncSettingsSource {
  const providerLabel = overrides.providerLabel ?? "Wearable";

  return {
    connectionId: "conn_123",
    connectedAt: "2026-04-27T00:00:00.000Z",
    detail: "",
    displayName: null,
    guidance: "",
    headline: "",
    lastActivityAt: null,
    lastSuccessfulSyncAt: null,
    lastWebhookAt: null,
    nextReconcileAt: null,
    primaryAction: null,
    provider: providerLabel.toLowerCase(),
    providerConfigured: true,
    providerLabel,
    secondaryAction: null,
    state: "active",
    statusLabel: "Connected",
    tone: "calm",
    updatedAt: null,
    upstreamSources: [],
    ...overrides,
  };
}
