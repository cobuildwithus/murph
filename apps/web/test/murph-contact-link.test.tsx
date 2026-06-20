import assert from "node:assert/strict";

import { act, createElement } from "react";
import { test, vi } from "vitest";

import { MurphContactLink } from "@/src/components/murph/murph-contact-link";

import { renderClientComponent } from "./render-client-component";

test("MurphContactLink leaves Telegram web text links to normal navigation", async () => {
  const telegramHref =
    "https://t.me/murphdevelopment_bot?text=Hey+Murph%2C+do+your+thing";
  const onClick = vi.fn();
  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(
      MurphContactLink,
      {
        actionLabel: "Text Murph",
        onClick,
        option: {
          href: telegramHref,
          kind: "telegram",
          label: "Telegram",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      },
      "Text Murph",
    ),
    {
      requireButton: false,
    },
  );

  try {
    const link = container.querySelector("a");
    assert.ok(link);
    assert.equal(link.getAttribute("href"), telegramHref);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");

    const click = new window.Event("click", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      link.dispatchEvent(click);
    });

    assert.equal(click.defaultPrevented, false);
    assert.equal(onClick.mock.calls.length, 1);
    assert.equal(assign.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});

test("MurphContactLink leaves non-Telegram links to normal navigation", async () => {
  const onClick = vi.fn();
  const { assign, cleanup, container, window } = await renderClientComponent(
    createElement(
      MurphContactLink,
      {
        actionLabel: "Text Murph",
        onClick,
        option: {
          href: "sms:+15550100001?body=Hey%20Murph%2C%20do%20your%20thing",
          kind: "text",
          label: "Messages",
        },
      },
      "Text Murph",
    ),
    {
      requireButton: false,
    },
  );

  try {
    const link = container.querySelector("a");
    assert.ok(link);

    const click = new window.Event("click", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      link.dispatchEvent(click);
    });

    assert.equal(click.defaultPrevented, false);
    assert.equal(onClick.mock.calls.length, 1);
    assert.equal(assign.mock.calls.length, 0);
  } finally {
    await cleanup();
  }
});
