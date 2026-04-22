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

test("Sidebar shows Oura connected status", () => {
  mocks.usePathname.mockReturnValue("/overview");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /Oura connected/);
});
