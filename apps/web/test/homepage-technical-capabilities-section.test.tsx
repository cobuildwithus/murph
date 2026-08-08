import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { TechnicalCapabilitiesSection } from "@/src/components/homepage/technical-capabilities-section";

test("TechnicalCapabilitiesSection renders the agent runtime and inference choices", () => {
  const markup = renderToStaticMarkup(
    createElement(TechnicalCapabilitiesSection, { veniceAvailable: true }),
  );

  assert.match(markup, /Under the hood/);
  assert.match(markup, /You send a text\. A whole computer goes to work\./);
  assert.match(markup, /Codex CLI \+ App Server/);
  assert.match(markup, /Its own computer/);
  assert.match(markup, /A real phone number/);
  assert.match(markup, /Bounded subagents/);
  assert.match(markup, /low · medium · high · xhigh/);
  assert.match(markup, /OpenAI/);
  assert.match(markup, /Venice/);
  assert.match(markup, /privacy model fits you better/);
  assert.match(markup, /compatible model endpoint and key/);
  assert.match(markup, /Endpoint \+ key/);
  assert.match(markup, /Local OSS/);
  assert.match(markup, /href="\/security#model-provider"/);
  assert.doesNotMatch(markup, /unlimited/i);
  assert.doesNotMatch(markup, /fully autonomous/i);
});

test("TechnicalCapabilitiesSection hides Venice and its security anchor when the provider flag is off", () => {
  const markup = renderToStaticMarkup(
    createElement(TechnicalCapabilitiesSection, { veniceAvailable: false }),
  );

  assert.doesNotMatch(markup, /Venice/);
  assert.doesNotMatch(markup, /privacy model fits you better/);
  assert.doesNotMatch(markup, /model-provider/);
  assert.match(markup, /OpenAI/);
  assert.match(markup, /compatible model endpoint and key/);
  assert.match(markup, /Endpoint \+ key/);
  assert.match(markup, /Local OSS/);
});
