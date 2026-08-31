import assert from "node:assert/strict";

import {
  act,
  createElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, test, vi } from "vitest";

import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/ui/dialog", async () => {
  const { cloneElement, createContext, useContext } = await import("react");
  const DialogContext = createContext({
    onOpenChange: undefined as ((open: boolean) => void) | undefined,
    open: false,
  });

  return {
    Dialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children?: ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => createElement(
      DialogContext.Provider,
      { value: { onOpenChange, open: Boolean(open) } },
      children,
    ),
    DialogContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) =>
      useContext(DialogContext).open
        ? createElement("div", { role: "dialog", ...props }, children)
        : null,
    DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
      createElement("p", props),
    DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
      createElement("div", props),
    DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
      createElement("h2", props),
    DialogTrigger: ({ render }: { render: ReactElement<{ onClick?: () => void }> }) => {
      const { onOpenChange } = useContext(DialogContext);
      return cloneElement(render, {
        onClick: () => {
          render.props.onClick?.();
          onOpenChange?.(true);
        },
      });
    },
  };
});

const START_PROMPT = "Hey Murph, help me lower my resting heart rate.";
const OPTIONS: readonly MurphContactOption[] = [
  {
    copyValue: "+15550100001",
    href: `sms:+15550100001?body=${encodeURIComponent(START_PROMPT)}`,
    kind: "text",
    label: "Messages",
  },
  {
    copyValue: "@withmurph_bot",
    href: `https://t.me/withmurph_bot?${new URLSearchParams({
      text: START_PROMPT,
    }).toString()}`,
    kind: "telegram",
    label: "Telegram",
    rel: "noopener noreferrer",
    target: "_blank",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

test("goal CTA starts an exact copy while preserving native draft-link navigation", async () => {
  const { GoalContactAction } = await import(
    "@/src/components/goals/goal-contact-action"
  );
  const rendered = await renderClientComponent(
    <GoalContactAction options={OPTIONS} startPrompt={START_PROMPT} />,
  );
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    const message = dialog.querySelector("textarea");
    assert.ok(message instanceof rendered.window.HTMLTextAreaElement);
    assert.ok(message.getAttribute("aria-describedby"));
    assert.equal(message.hasAttribute("readonly"), false);
    assert.match(
      dialog.textContent ?? "",
      /The same click copies it in case the app does not keep the draft/,
    );

    const editedPrompt =
      "Hey Murph, help me lower my resting heart rate over the next month.";
    await act(async () => {
      message.value = editedPrompt;
      message.dispatchEvent(
        new rendered.window.Event("input", { bubbles: true }),
      );
      message.dispatchEvent(
        new rendered.window.Event("change", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const openLinks = [...dialog.querySelectorAll("a")];
    assert.equal(openLinks.length, 2);
    const messagesHref = openLinks[0]?.getAttribute("href");
    const telegramHref = openLinks[1]?.getAttribute("href");
    assert.ok(messagesHref);
    assert.ok(telegramHref);
    assert.equal(new URL(messagesHref).searchParams.get("body"), editedPrompt);
    assert.equal(new URL(telegramHref).searchParams.get("text"), editedPrompt);

    const messagesAction = openLinks.find(
      (link) => link.textContent?.includes("Copy & open Messages"),
    );
    assert.ok(messagesAction);
    const messagesClick = new rendered.window.Event("click", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      messagesAction.dispatchEvent(messagesClick);
      await Promise.resolve();
    });

    assert.deepEqual(writeText.mock.calls, [[editedPrompt]]);
    assert.equal(messagesClick.defaultPrevented, false);
    assert.equal(rendered.assign.mock.calls.length, 0);
    assert.equal(openLinks[1]?.getAttribute("target"), "_blank");
    assert.equal(openLinks[1]?.getAttribute("rel"), "noopener noreferrer");
    assert.equal(
      openLinks[1]?.getAttribute("aria-label"),
      "Copy message and open Murph in Telegram (opens in a new tab)",
    );
    assert.match(dialog.textContent ?? "", /Message copied\. Paste it if the app/);
  } finally {
    await rendered.cleanup();
  }
});

test("goal CTA exposes manual open links when clipboard access fails", async () => {
  const { GoalContactAction } = await import(
    "@/src/components/goals/goal-contact-action"
  );
  const rendered = await renderClientComponent(
    <GoalContactAction options={OPTIONS} startPrompt={START_PROMPT} />,
  );
  const writeText = vi.fn().mockRejectedValue(new Error("clipboard blocked"));
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText,
    },
  });

  try {
    await act(async () => {
      rendered.button.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });

    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    const messagesAction = [...dialog.querySelectorAll("a")].find(
      (link) => link.textContent?.includes("Copy & open Messages"),
    );
    assert.ok(messagesAction);
    const messagesClick = new rendered.window.Event("click", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      messagesAction.dispatchEvent(messagesClick);
      await Promise.resolve();
    });

    assert.deepEqual(writeText.mock.calls, [[START_PROMPT]]);
    assert.equal(messagesClick.defaultPrevented, false);
    assert.equal(rendered.assign.mock.calls.length, 0);
    const message = dialog.querySelector("textarea");
    assert.ok(message instanceof rendered.window.HTMLTextAreaElement);
    assert.ok(message.getAttribute("aria-describedby"));
    assert.match(
      dialog.textContent ?? "",
      /Copying was blocked\. Select and copy the message manually/,
    );
    const openOnlyLinks = [...dialog.querySelectorAll("a")].filter(
      (link) => link.textContent?.includes("without copying"),
    );
    assert.equal(openOnlyLinks.length, 2);
    const openOnlyMessagesHref = openOnlyLinks[0]?.getAttribute("href");
    assert.ok(openOnlyMessagesHref);
    assert.equal(
      new URL(openOnlyMessagesHref).searchParams.get("body"),
      START_PROMPT,
    );
    assert.equal(openOnlyLinks[1]?.getAttribute("target"), "_blank");
    assert.equal(
      openOnlyLinks[1]?.getAttribute("rel"),
      "noopener noreferrer",
    );
  } finally {
    await rendered.cleanup();
  }
});
