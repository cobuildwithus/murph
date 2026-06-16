import assert from "node:assert/strict";

import { act, createElement, type HTMLAttributes, type ReactNode } from "react";
import { test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => open ? createElement("div", { "data-dialog-open": "true" }, children) : null,
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { className, "data-dialog-content": "true" }, children),
  DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

test("HomeInitialVisitDialogClient shows the Murph contact CTA and dismisses to explore", async () => {
  const { HomeInitialVisitDialogClient } = await import(
    "../app/(dashboard)/home/initial-visit-dialog-client"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitDialogClient, {
      contactAction: {
        ariaLabel: "Text Murph in Messages",
        href: "sms:+15550100001",
      },
    }),
    {
      location: {
        hash: "#notes",
        href: "https://join.example.test/home?initialVisit=true&tab=overview#notes",
        pathname: "/home",
        search: "?initialVisit=true&tab=overview",
      },
      requireButton: false,
    },
  );

  try {
    assert.match(container.textContent ?? "", /Welcome to Murph/);
    assert.match(container.textContent ?? "", /connect a device/);
    assert.match(container.textContent ?? "", /Text Murph/);
    assert.ok(container.querySelector("[data-home-initial-visit-logo='murph']"));
    assert.equal(
      container.querySelector("a")?.getAttribute("href"),
      "sms:+15550100001",
    );

    const exploreButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Start exploring",
    );
    assert.ok(exploreButton);

    await act(async () => {
      exploreButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    assert.equal(container.querySelector("[data-dialog-open='true']"), null);
  } finally {
    await cleanup();
  }
});
