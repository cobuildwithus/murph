import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ logout: vi.fn() }),
  useUser: () => ({ user: { email: { address: "test@example.com" } } }),
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
  DropdownMenuItem: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DropdownMenuSeparator: () => createElement("hr"),
}));

import { Sidebar } from "../src/components/dashboard/sidebar";
import type { HostedDeviceSyncSettingsSource } from "../src/lib/device-sync/settings-surface";
import { summarizeSidebarDeviceSyncStatus } from "../src/lib/device-sync/sidebar-status";

test("Sidebar does not render the Overview page as a navigation item", () => {
  mocks.usePathname.mockReturnValue("/experiments");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.doesNotMatch(markup, />Overview<\/a>/);
});

test("Sidebar renders an active Biomarkers tab for the live RHR page", () => {
  mocks.usePathname.mockReturnValue("/biomarkers/resting-heart-rate");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /href="\/biomarkers\/resting-heart-rate"/);
  assert.match(
    markup,
    /data-active="true">\s*<a[^>]*href="\/biomarkers\/resting-heart-rate"[^>]*>Biomarkers<\/a>/,
  );
});

test("Sidebar keeps the Biomarkers tab active across biomarker section routes", () => {
  mocks.usePathname.mockReturnValue("/biomarkers/heart-rate-variability");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(
    markup,
    /data-active="true">\s*<a[^>]*href="\/biomarkers\/resting-heart-rate"[^>]*>Biomarkers<\/a>/,
  );
});

test("Sidebar renders account menu with signed-in user label", () => {
  mocks.usePathname.mockReturnValue("/overview");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /test@example\.com/);
  assert.match(markup, /Sign out/);
});

test("Sidebar does not render a hardcoded wearable connection status", () => {
  mocks.usePathname.mockReturnValue("/overview");

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
