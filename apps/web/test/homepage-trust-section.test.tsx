import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { TrustSection } from "@/src/components/homepage/trust-section";

test("TrustSection renders the trust pillars and message volume line", () => {
  const markup = renderToStaticMarkup(createElement(TrustSection));

  assert.match(markup, /Why people trust Murph/);
  assert.match(markup, /6,000\+ messages and counting/);
  assert.match(markup, /Studies cited/);
  assert.match(markup, /Apache 2\.0/);
  assert.match(markup, /Never sold/);
  assert.match(markup, /Export a structured copy of your vault or delete your account\./);
});
