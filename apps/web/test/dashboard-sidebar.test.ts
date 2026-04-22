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

vi.mock("@/src/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SheetContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => createElement("div", { className }, children),
  SheetTrigger: ({ render }: { render: ReactNode }) => render,
}));

import { Sidebar } from "../src/components/dashboard/sidebar";

test("Sidebar renders an active Biomarkers tab for the live RHR page", () => {
  mocks.usePathname.mockReturnValue("/biomarkers/resting-heart-rate");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(markup, /href="\/biomarkers\/resting-heart-rate"/);
  assert.match(
    markup,
    /class="[^"]*bg-white\/10 font-semibold text-white[^"]*" href="\/biomarkers\/resting-heart-rate">Biomarkers<\/a>/,
  );
});

test("Sidebar keeps the Biomarkers tab active across biomarker section routes", () => {
  mocks.usePathname.mockReturnValue("/biomarkers/heart-rate-variability");

  const markup = renderToStaticMarkup(createElement(Sidebar));

  assert.match(
    markup,
    /class="[^"]*bg-white\/10 font-semibold text-white[^"]*" href="\/biomarkers\/resting-heart-rate">Biomarkers<\/a>/,
  );
});
