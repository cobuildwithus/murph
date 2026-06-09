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

vi.mock("@/src/components/ui/sidebar", () => ({
  SidebarMenuButton: ({
    "aria-label": ariaLabel,
    children,
    className,
    onClick,
  }: {
    "aria-label"?: string;
    children?: ReactNode;
    className?: string;
    onClick?: () => void;
  }) =>
    createElement(
      "button",
      {
        "aria-label": ariaLabel,
        className,
        "data-slot": "sidebar-menu-button",
        onClick,
        type: "button",
      },
      children,
    ),
  SidebarMenuItem: ({ children }: { children?: ReactNode }) =>
    createElement("li", null, children),
}));

test("SidebarChatWithMurphContactDialog opens connected contact links", async () => {
  const { SidebarChatWithMurphContactDialog } = await import(
    "@/src/components/dashboard/sidebar-chat-contact-dialog"
  );
  const { button, cleanup, container, window } = await renderClientComponent(
    <SidebarChatWithMurphContactDialog
      options={[
        {
          href: "sms:+15550100001",
          kind: "text",
          label: "Messages",
        },
        {
          href: "https://t.me/withmurph_bot",
          kind: "telegram",
          label: "Telegram",
          rel: "noopener noreferrer",
          target: "_blank",
        },
        {
          href: "mailto:murph+alias123@mail.withmurph.ai?subject=Hey%20Murph",
          kind: "email",
          label: "Email",
        },
      ]}
    />,
  );

  try {
    assert.doesNotMatch(container.textContent ?? "", /Pick how you want/);

    await act(async () => {
      button.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    const links = [...container.querySelectorAll("a")];
    assert.match(container.textContent ?? "", /Pick how you want to reach Murph/);
    assert.deepEqual(
      links.map((link) => link.getAttribute("href")),
      [
        "sms:+15550100001",
        "https://t.me/withmurph_bot",
        "mailto:murph+alias123@mail.withmurph.ai?subject=Hey%20Murph",
      ],
    );
    assert.equal(links[1]?.getAttribute("target"), "_blank");
    assert.equal(links[1]?.getAttribute("rel"), "noopener noreferrer");
    assert.match(links[0]?.getAttribute("class") ?? "", /focus-visible:ring-2/);
  } finally {
    await cleanup();
  }
});
