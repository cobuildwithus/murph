import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { TechnicalCapabilitiesSection } from "@/src/components/homepage/technical-capabilities-section";

test("TechnicalCapabilitiesSection describes OpenAI models and the agent runtime", () => {
  const markup = renderToStaticMarkup(createElement(TechnicalCapabilitiesSection));

  assert.match(markup, /Built on Codex, with a computer of its own\./);
  assert.match(markup, /You choose the OpenAI model and reasoning effort\./);
  assert.match(markup, /Codex CLI \+ App Server/);
  assert.match(markup, /Its own computer/);
  assert.match(markup, /A real phone number/);
  assert.match(markup, /Bounded subagents/);
  assert.match(markup, /low · medium · high · xhigh/);
  assert.match(markup, /Powered by OpenAI/);
  assert.doesNotMatch(markup, /Venice|Endpoint \+ key|Local OSS|No model lock-in/);
  assert.doesNotMatch(markup, /unlimited|fully autonomous/i);
});
