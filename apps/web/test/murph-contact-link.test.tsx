import assert from "node:assert/strict";

import { act, createElement } from "react";
import { test, vi } from "vitest";

import { MurphContactLink } from "@/src/components/murph/murph-contact-link";

import { renderClientComponent } from "./render-client-component";

test("MurphContactLink opens Telegram text links with the raw href prop", async () => {
  const telegramHref =
    "tg://resolve?domain=murphdevelopment_bot&text=Let's%20get%20started";
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

    const click = new window.Event("click", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      link.dispatchEvent(click);
    });

    assert.equal(click.defaultPrevented, true);
    assert.equal(onClick.mock.calls.length, 1);
    assert.deepEqual(assign.mock.calls, [[telegramHref]]);
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
          href: "sms:+15550100001?body=Let's%20get%20started",
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
