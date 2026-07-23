import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { TrustSection } from "@/src/components/homepage/trust-section";
import { formatMessageVolume } from "@/src/lib/message-volume";

test("TrustSection renders the trust pillars and message volume line", () => {
  const markup = renderToStaticMarkup(createElement(TrustSection));

  assert.match(markup, /Why people trust Murph/);
  assert.match(markup, /5,000\+ messages and counting/);
  assert.match(markup, /Studies cited/);
  assert.match(markup, /Apache 2\.0/);
  assert.match(markup, /Never sold/);
  assert.match(markup, /Export a structured copy of your vault or delete your account\./);
});

test("formatMessageVolume rounds down to the nearest hundred", () => {
  assert.equal(formatMessageVolume(5_000), "5,000+");
  assert.equal(formatMessageVolume(12_345), "12,300+");
});
