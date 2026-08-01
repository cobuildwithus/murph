import assert from "node:assert/strict";

import { act, createElement, type ReactNode } from "react";
import { test, vi } from "vitest";

vi.mock("@/src/components/ui/sheet", () => ({
  Sheet: ({
    children,
    open,
  }: {
    children: ReactNode;
    open: boolean;
  }) => (open ? createElement("div", null, children) : null),
  SheetContent: ({
    children,
    ...props
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => createElement("div", { role: "dialog", ...props }, children),
  SheetDescription: ({ children }: { children: ReactNode }) =>
    createElement("p", null, children),
  SheetFooter: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  SheetHeader: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  SheetTitle: ({ children }: { children: ReactNode }) =>
    createElement("h2", null, children),
}));

import { deriveCategoryNote } from "../app/(dashboard)/environment/category-notes";
import { CategoryCard } from "../app/(dashboard)/environment/environment-components";
import {
  type HabitatValues,
  resolveHabitatScene,
} from "../app/(dashboard)/environment/home-model";
import { renderClientComponent } from "./render-client-component";

test("the fact drawer leaves arrow scrolling alone and uses explicit navigation buttons", async () => {
  const values: HabitatValues = {
    "sleep-environment": {
      darkness: "partial",
      night_temp_c: 23,
    },
  };
  const category = resolveHabitatScene(values).categories.find(
    (candidate) => candidate.id === "sleep",
  );
  assert.ok(category);
  const note = deriveCategoryNote(category, values);
  const rendered = await renderClientComponent(
    createElement(CategoryCard, {
      category,
      chatHref: "https://example.com/chat",
      note,
    }),
    {
      location: {
        hash: "",
        href: "https://local.withmurph.ai/environment",
        origin: "https://local.withmurph.ai",
        pathname: "/environment",
        search: "",
      },
    },
  );

  try {
    await clickButtonContaining(rendered.window, "Night temperature");
    const dialog = rendered.window.document.querySelector("[role='dialog']");
    assert.ok(dialog);
    assert.match(dialog.textContent ?? "", /Night temperature/);

    const cta = findInteractiveElement(
      rendered.window,
      "Talk to Murph about it",
    );
    for (const target of [dialog, cta]) {
      for (const key of ["ArrowUp", "ArrowDown"]) {
        const event = new rendered.window.Event("keydown", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "key", { value: key });
        assert.equal(target.dispatchEvent(event), true);
        assert.equal(event.defaultPrevented, false);
        assert.match(dialog.textContent ?? "", /Night temperature/);
      }
    }

    await clickButtonContaining(rendered.window, "Next fact");
    assert.match(dialog.textContent ?? "", /Darkness/);
    assert.doesNotMatch(dialog.textContent ?? "", /Night temperature/);
  } finally {
    await rendered.cleanup();
  }
});

async function clickButtonContaining(
  window: Window & typeof globalThis,
  text: string,
) {
  const button = Array.from(window.document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text)
      || candidate.getAttribute("aria-label")?.includes(text),
  );
  assert.ok(button instanceof window.HTMLButtonElement);
  await act(async () => {
    button.click();
  });
}

function findInteractiveElement(
  window: Window & typeof globalThis,
  text: string,
): HTMLElement {
  const element = Array.from(
    window.document.querySelectorAll<HTMLElement>("a, button"),
  ).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  assert.ok(element instanceof window.HTMLElement);
  return element;
}
