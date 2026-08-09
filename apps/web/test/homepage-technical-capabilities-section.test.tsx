import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { TechnicalCapabilitiesSection } from "@/src/components/homepage/technical-capabilities-section";

function render(flags: {
  customInferenceAvailable: boolean;
  veniceAvailable: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(TechnicalCapabilitiesSection, flags),
  );
}

test("TechnicalCapabilitiesSection renders the agent runtime and every enabled inference choice", () => {
  const markup = render({
    customInferenceAvailable: true,
    veniceAvailable: true,
  });

  assert.match(markup, /Under the hood/);
  // The headline glues phrase groups with non-breaking spaces so it stacks as
  // "Built on Codex, / with a computer / of its own." at every width.
  assert.match(markup, /Built on Codex, with a computer of its own\./);
  // The member chooses model and reasoning effort; the runtime never claims to
  // switch configuration on its own.
  assert.match(
    markup,
    /You choose the model, the reasoning effort, and who supplies the inference\./,
  );
  assert.match(markup, />The inference path is yours\.<\/h3>/);
  assert.doesNotMatch(markup, /The agent stays\./);
  assert.doesNotMatch(markup, /changes model and reasoning effort/);
  assert.match(markup, /Codex CLI \+ App Server/);
  assert.match(markup, /be the most capable health agent in the world/);
  assert.match(markup, /keep the member in control/);
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
  // The provider-choice security anchor only renders behind the Venice flag,
  // which is off in production, so the section links nowhere.
  assert.doesNotMatch(markup, /model-provider/);
  assert.doesNotMatch(markup, /unlimited/i);
  assert.doesNotMatch(markup, /fully autonomous/i);
});

test("TechnicalCapabilitiesSection hides Venice when only the Venice flag is off", () => {
  const markup = render({
    customInferenceAvailable: true,
    veniceAvailable: false,
  });

  assert.doesNotMatch(markup, /Venice/);
  assert.doesNotMatch(markup, /privacy model fits you better/);
  assert.match(markup, /compatible model endpoint and key/);
  assert.match(markup, /Endpoint \+ key/);
});

test("TechnicalCapabilitiesSection hides the custom endpoint when only that flag is off", () => {
  const markup = render({
    customInferenceAvailable: false,
    veniceAvailable: true,
  });

  assert.match(markup, /Venice/);
  assert.doesNotMatch(markup, /endpoint and key/);
  assert.doesNotMatch(markup, /Endpoint \+ key/);
  assert.doesNotMatch(markup, /Bring your own/);
});

test("TechnicalCapabilitiesSection claims only managed and self-hosted paths when both provider flags are off", () => {
  const markup = render({
    customInferenceAvailable: false,
    veniceAvailable: false,
  });

  assert.doesNotMatch(markup, /Venice/);
  assert.doesNotMatch(markup, /endpoint and key/);
  assert.doesNotMatch(markup, /Endpoint \+ key/);
  assert.doesNotMatch(markup, /model-provider/);
  assert.match(markup, /OpenAI/);
  assert.match(markup, /Local OSS/);
  assert.match(markup, /Use managed models, or run an open-source model locally\./);
});
