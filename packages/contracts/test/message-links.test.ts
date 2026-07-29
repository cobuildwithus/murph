import assert from "node:assert/strict";

import { test } from "vitest";

import {
  RICH_LINK_URL_MAX_LENGTH,
  splitTrailingHttpsLink,
} from "../src/message-links.ts";

test("splits one terminal HTTPS URL without rewriting the preceding message", () => {
  assert.deepEqual(
    splitTrailingHttpsLink("Open the group invite:\nhttps://www.withmurph.ai/groups/join/abc123   "),
    {
      linkUrl: "https://www.withmurph.ai/groups/join/abc123",
      message: "Open the group invite:",
    },
  );
});

test("unwraps a terminal HTTPS URL and removes sentence punctuation", () => {
  assert.deepEqual(
    splitTrailingHttpsLink("Open it (<https://www.withmurph.ai/pay/session_123>)."),
    {
      linkUrl: "https://www.withmurph.ai/pay/session_123",
      message: "Open it",
    },
  );
});

test("supports a link-only message", () => {
  assert.deepEqual(
    splitTrailingHttpsLink("  https://www.withmurph.ai/connect/device  \n"),
    {
      linkUrl: "https://www.withmurph.ai/connect/device",
      message: "",
    },
  );
});

test("keeps payment URL paths, queries, and fragments intact", () => {
  assert.deepEqual(
    splitTrailingHttpsLink(
      "https://pay.example.test/checkout/session_123?prefilled_email=false#payment",
    ),
    {
      linkUrl:
        "https://pay.example.test/checkout/session_123?prefilled_email=false#payment",
      message: "",
    },
  );
});

test("leaves non-terminal, non-HTTPS, credentialed, and oversized URLs unchanged", () => {
  const oversizedUrl = `https://example.com/${"a".repeat(RICH_LINK_URL_MAX_LENGTH)}`;
  const messages = [
    "Open https://www.withmurph.ai/groups/join/abc123 when you're ready.",
    "Open this: http://www.withmurph.ai/groups/join/abc123",
    "Open this: https:example.com/path",
    "Open this: https://user:password@example.com/private",
    `Open this: ${oversizedUrl}`,
  ];

  for (const message of messages) {
    assert.deepEqual(splitTrailingHttpsLink(message), {
      linkUrl: null,
      message,
    });
  }
});
