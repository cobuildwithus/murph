import assert from "node:assert/strict";

import { act, createElement, type HTMLAttributes, type ReactNode } from "react";
import { test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/murph/murph-contact-card-picker", () => ({
  MurphContactCardPicker({
    onAddToContacts,
    onOpenChange,
    onSkip,
    open,
  }: {
    onAddToContacts?: () => void;
    onOpenChange: (open: boolean) => void;
    onSkip?: () => void;
    open: boolean;
  }) {
    return open
      ? createElement(
          "section",
          { "data-murph-contact-card-picker": "open" },
          createElement("p", null, "Add Murph to your contacts"),
          createElement(
            "button",
            { onClick: () => onAddToContacts?.(), type: "button" },
            "Add contact card",
          ),
          createElement(
            "button",
            {
              onClick: () => {
                onSkip?.();
                onOpenChange(false);
              },
              type: "button",
            },
            "Skip contact card",
          ),
          createElement(
            "button",
            { onClick: () => onOpenChange(false), type: "button" },
            "Dismiss contact card",
          ),
        )
      : null;
  },
}));

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

test("HomeInitialVisitDialogClient shows the contact-card picker first for text members", async () => {
  const { HomeInitialVisitDialogClient } = await import(
    "../app/(dashboard)/home/initial-visit-dialog-client"
  );
  const { cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitDialogClient, {
      contactAction: {
        href: "sms:+15550100001",
        kind: "text",
        label: "Messages",
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
    assert.match(container.textContent ?? "", /Add Murph to your contacts/);
    assert.doesNotMatch(container.textContent ?? "", /Welcome to Murph/);

    const addContactButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Add contact card",
    );
    assert.ok(addContactButton);

    await act(async () => {
      addContactButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    assert.match(container.textContent ?? "", /Welcome to Murph/);
    assert.match(container.textContent ?? "", /Message Murph to get started/);
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

test("HomeInitialVisitDialogClient advances from the contact-card picker on skip or dismiss", async () => {
  const { HomeInitialVisitDialogClient } = await import(
    "../app/(dashboard)/home/initial-visit-dialog-client"
  );

  for (const buttonText of ["Skip contact card", "Dismiss contact card"]) {
    const { cleanup, container, window } = await renderClientComponent(
      createElement(HomeInitialVisitDialogClient, {
        contactAction: {
          href: "sms:+15550100001",
          kind: "text",
          label: "Messages",
        },
      }),
      {
        requireButton: false,
      },
    );

    try {
      assert.match(container.textContent ?? "", /Add Murph to your contacts/);
      const stageButton = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === buttonText,
      );
      assert.ok(stageButton);

      await act(async () => {
        stageButton.dispatchEvent(new window.Event("click", { bubbles: true }));
      });

      assert.match(container.textContent ?? "", /Welcome to Murph/);
      assert.equal(container.querySelector("[data-murph-contact-card-picker='open']"), null);
    } finally {
      await cleanup();
    }
  }
});

test("HomeInitialVisitDialogClient closes after launching Telegram", async () => {
  const { HomeInitialVisitDialogClient } = await import(
    "../app/(dashboard)/home/initial-visit-dialog-client"
  );
  const telegramHref =
    "https://t.me/murphdevelopment_bot?text=Hey+Murph%2C+do+your+thing";
  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(HomeInitialVisitDialogClient, {
      contactAction: {
        href: telegramHref,
        kind: "telegram",
        label: "Telegram",
        rel: "noopener noreferrer",
        target: "_blank",
      },
    }),
    {
      requireButton: false,
    },
  );

  try {
    assert.doesNotMatch(container.textContent ?? "", /Add Murph to your contacts/);
    assert.match(container.textContent ?? "", /Welcome to Murph/);

    const link = container.querySelector("a");
    assert.ok(link);
    assert.equal(link.getAttribute("href"), telegramHref);
    assert.equal(link.getAttribute("target"), "_blank");

    const click = new window.Event("click", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      link.dispatchEvent(click);
    });

    assert.equal(click.defaultPrevented, false);
    assert.equal(assign.mock.calls.length, 0);
    assert.equal(container.querySelector("[data-dialog-open='true']"), null);
  } finally {
    await cleanup();
  }
});

test("HomeInitialVisitDialogClient starts at the welcome dialog when no contact channel is ready", async () => {
  const { HomeInitialVisitDialogClient } = await import(
    "../app/(dashboard)/home/initial-visit-dialog-client"
  );
  const { cleanup, container } = await renderClientComponent(
    createElement(HomeInitialVisitDialogClient, {
      contactAction: null,
    }),
    {
      requireButton: false,
    },
  );

  try {
    assert.doesNotMatch(container.textContent ?? "", /Add Murph to your contacts/);
    assert.match(container.textContent ?? "", /Welcome to Murph/);
    assert.equal(container.querySelector("a")?.getAttribute("href"), "/settings");
  } finally {
    await cleanup();
  }
});
