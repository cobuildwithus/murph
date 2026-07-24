import assert from "node:assert/strict";

import { act, createElement, type HTMLAttributes, type ReactNode } from "react";
import { beforeEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/ui/dialog", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const DialogContext = React.createContext<{
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }>({
    onOpenChange: () => {},
    open: false,
  });

  return {
    Dialog: ({
      children,
      onOpenChange = () => {},
      open = false,
    }: {
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) =>
      createElement(
        DialogContext.Provider,
        { value: { onOpenChange, open } },
        children,
      ),
    DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) => {
      const context = React.useContext(DialogContext);
      return context.open
        ? createElement("div", { className, role: "dialog" }, children)
        : null;
    },
    DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
      createElement("p", props),
    DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
      createElement("div", props),
    DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
      createElement("h2", props),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("opens one picker dialog with every channel row and closes on selection", async () => {
  const { ComputerHandoffReplyAction } = await import(
    "@/src/components/computer-use/computer-handoff-reply-action"
  );
  const rendered = await renderClientComponent(
    createElement(ComputerHandoffReplyAction, {
      options: [textReplyOption(), telegramReplyOption()],
    }),
  );

  try {
    const trigger = rendered.button;
    assert.ok(trigger);
    assert.match(trigger.textContent ?? "", /Reply to Murph/);
    assert.equal(trigger.getAttribute("aria-label"), "Reply to Murph");
    assert.equal(
      rendered.container.querySelectorAll("button").length,
      1,
    );
    assert.equal(
      rendered.container.querySelectorAll('[role="dialog"]').length,
      0,
    );
    assert.equal(rendered.container.querySelector("a"), null);

    await act(async () => {
      trigger.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    assert.equal(
      rendered.container.querySelectorAll('[role="dialog"]').length,
      1,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Pick how you want to reply\./,
    );
    const textLink = rendered.container.querySelector('a[href^="sms:"]');
    assert.ok(textLink);
    assert.equal(
      textLink.getAttribute("href"),
      "sms:+15555550100?body=Done%20with%20the%20browser%20task.",
    );
    assert.match(textLink.textContent ?? "", /Messages/);
    assert.equal(
      textLink.getAttribute("aria-label"),
      "Reply to Murph in Messages",
    );
    const telegramLink = rendered.container.querySelector(
      'a[href^="https://t.me/"]',
    );
    assert.ok(telegramLink);
    assert.equal(
      telegramLink.getAttribute("href"),
      "https://t.me/withmurph_bot?text=Done+with+the+browser+task.",
    );
    assert.match(telegramLink.textContent ?? "", /Telegram/);
    assert.equal(
      telegramLink.getAttribute("aria-label"),
      "Reply to Murph in Telegram (opens in a new tab)",
    );

    await act(async () => {
      textLink.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
  } finally {
    await rendered.cleanup();
  }
});

test("renders a single resolved channel as a direct link without a picker", async () => {
  const { ComputerHandoffReplyAction } = await import(
    "@/src/components/computer-use/computer-handoff-reply-action"
  );
  const rendered = await renderClientComponent(
    createElement(ComputerHandoffReplyAction, {
      options: [textReplyOption()],
    }),
    { requireButton: false },
  );

  try {
    assert.equal(rendered.container.querySelector("button"), null);
    assert.equal(
      rendered.container.querySelectorAll('[role="dialog"]').length,
      0,
    );
    const directLink = rendered.container.querySelector("a");
    assert.ok(directLink);
    assert.match(directLink.textContent ?? "", /Reply to Murph/);
    assert.equal(
      directLink.getAttribute("href"),
      "sms:+15555550100?body=Done%20with%20the%20browser%20task.",
    );
    assert.equal(
      directLink.getAttribute("aria-label"),
      "Reply to Murph in Messages",
    );
  } finally {
    await rendered.cleanup();
  }
});

function textReplyOption() {
  return {
    href: "sms:+15555550100?body=Done%20with%20the%20browser%20task.",
    kind: "text" as const,
    label: "Messages",
  };
}

function telegramReplyOption() {
  return {
    href: "https://t.me/withmurph_bot?text=Done+with+the+browser+task.",
    kind: "telegram" as const,
    label: "Telegram",
    rel: "noopener noreferrer",
    target: "_blank",
  };
}
