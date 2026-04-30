import assert from "node:assert/strict";

import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

type MockPrivyUser = {
  email?: { address: string };
  id?: string;
  phone?: { number: string };
} | null;

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  usePrivy: vi.fn<() => {
    authenticated: boolean;
    logout: () => void;
    ready: boolean;
  }>(() => ({
    authenticated: false,
    logout: vi.fn(),
    ready: false,
  })),
  useUser: vi.fn<() => { user: MockPrivyUser }>(() => ({
    user: { email: { address: "test@example.com" } },
  })),
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
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: mocks.usePrivy,
  useUser: mocks.useUser,
}));

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel", () => ({
  HostedAuthPanel: () => createElement("div", null, "Hosted auth panel"),
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
    render,
    isActive,
  }: {
    render: ReactNode;
    isActive?: boolean;
  }) =>
    createElement(
      "div",
      { "data-active": isActive ? "true" : "false" },
      render,
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
    render,
  }: {
    children: ReactNode;
    render?: ReactNode;
  }) => isValidElement<{ children?: ReactNode }>(render)
    ? createElement("div", null, cloneElement(render, undefined, children))
    : createElement("div", null, children),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DropdownMenuSeparator: () => createElement("hr"),
}));

import { Sidebar } from "../src/components/dashboard/sidebar";
import type { HostedDeviceSyncSettingsSource } from "../src/lib/device-sync/settings-surface";
import { summarizeSidebarDeviceSyncStatus } from "../src/lib/device-sync/sidebar-status";

beforeEach(() => {
  mocks.usePathname.mockReturnValue("/experiments");
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout: vi.fn(),
    ready: false,
  });
  mocks.useUser.mockReturnValue({
    user: { email: { address: "test@example.com" } },
  });
});

test("Sidebar does not render the Overview page as a navigation item", () => {
  mocks.usePathname.mockReturnValue("/experiments");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /href="\/home"[^>]*>\s*<img[^>]*alt="Murph"/);
  assert.doesNotMatch(markup, /href="\/overview"/);
  assert.doesNotMatch(markup, />Overview<\/a>/);
});

test("Sidebar renders an active Biomarkers tab for the live RHR page", () => {
  mocks.usePathname.mockReturnValue("/biomarkers/resting-heart-rate");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /href="\/biomarkers\/resting-heart-rate"/);
  assert.match(
    markup,
    /data-active="true">\s*<a[^>]*href="\/biomarkers\/resting-heart-rate"[^>]*>[\s\S]*Biomarkers<\/a>/,
  );
});

test("Sidebar keeps the Biomarkers tab active across biomarker section routes", () => {
  mocks.usePathname.mockReturnValue("/biomarkers/heart-rate-variability");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(
    markup,
    /data-active="true">\s*<a[^>]*href="\/biomarkers\/resting-heart-rate"[^>]*>[\s\S]*Biomarkers<\/a>/,
  );
});

test("Sidebar renders account menu with signed-in user label", () => {
  mocks.usePathname.mockReturnValue("/experiments");
  mocks.useUser.mockReturnValue({
    user: { email: { address: "test@example.com" }, id: "privy-user-1" },
  });

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /test@example\.com/);
  assert.match(markup, /href="\/settings"[^>]*>Settings<\/a>/);
  assert.match(markup, /Sign out/);
});

test("Sidebar keeps Settings out of the primary navigation", () => {
  mocks.usePathname.mockReturnValue("/settings");
  mocks.useUser.mockReturnValue({
    user: { email: { address: "test@example.com" }, id: "privy-user-1" },
  });

  const markup = renderToStaticMarkup(createElement(Sidebar));

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
  mocks.useUser.mockReturnValue({ user: null });

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /Experiments tailored to you/);
  assert.match(markup, /<button[^>]*>Log in or sign up<\/button>/);
  assert.match(markup, /w-full/);
  assert.doesNotMatch(markup, /Sign up/);
  assert.doesNotMatch(markup, />Account</);
  assert.doesNotMatch(markup, /Sign out/);
});

test("Sidebar uses initial server auth while Privy client state is not ready", () => {
  mocks.usePathname.mockReturnValue("/experiments");
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout: vi.fn(),
    ready: false,
  });
  mocks.useUser.mockReturnValue({ user: null });

  const markup = renderToStaticMarkup(
    createElement(Sidebar, {
      initialAuth: {
        authenticated: true,
        label: "initial@example.com",
      },
    }),
  );

  assert.match(markup, /initial@example\.com/);
  assert.match(markup, /Sign out/);
  assert.doesNotMatch(markup, /Log in or sign up/);
});

test("Sidebar trusts signed-out Privy client state after it becomes ready", () => {
  mocks.usePathname.mockReturnValue("/experiments");
  mocks.usePrivy.mockReturnValue({
    authenticated: false,
    logout: vi.fn(),
    ready: true,
  });
  mocks.useUser.mockReturnValue({ user: null });

  const markup = renderToStaticMarkup(
    createElement(Sidebar, {
      initialAuth: {
        authenticated: true,
        label: "initial@example.com",
      },
    }),
  );

  assert.match(markup, /Log in or sign up/);
  assert.doesNotMatch(markup, /initial@example\.com/);
  assert.doesNotMatch(markup, /Sign out/);
});

test("Sidebar does not render a hardcoded wearable connection status", () => {
  mocks.usePathname.mockReturnValue("/experiments");
  mocks.useUser.mockReturnValue({
    user: { email: { address: "test@example.com" }, id: "privy-user-1" },
  });

  const markup = renderToStaticMarkup(createElement(Sidebar));

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
    ...overrides,
  };
}
