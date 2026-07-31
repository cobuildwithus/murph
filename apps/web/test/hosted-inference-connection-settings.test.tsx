import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, vi } from "vitest";

import {
  HostedInferenceConnectionSettings,
} from "@/src/components/settings/hosted-inference-connection-settings";

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  HostedOnboardingApiError: class HostedOnboardingApiError extends Error {},
  requestHostedOnboardingJson: vi.fn(),
}));

describe("hosted inference connection settings", () => {
  it("explains the privacy and no-fallback boundary before collecting a secret", () => {
    const markup = renderToStaticMarkup(createElement(
      HostedInferenceConnectionSettings,
      {
        chatCompletionsAvailable: false,
        configurationAvailable: true,
        initialConnection: null,
      },
    ));

    assert.match(
      markup,
      /Murph never switches away from your endpoint after an endpoint failure/u,
    );
    assert.match(markup, /type="password"/u);
    assert.match(markup, /Verify and save/u);
    assert.match(markup, /Public HTTPS on port 443/u);
    assert.doesNotMatch(markup, />Chat Completions</u);
  });

  it("renders only sanitized metadata for a saved connection", () => {
    const markup = renderToStaticMarkup(createElement(
      HostedInferenceConnectionSettings,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: true,
        initialConnection: {
          contextWindowTokens: 131_072,
          endpointHost: "inference.example.test",
          model: "example-model",
          protocol: "responses",
          revision: 4,
          selected: true,
          supportsImages: false,
          verificationProfile:
            "murph-codex-0.145.0-portable-responses-v1",
          verifiedAt: "2026-07-30T12:00:00.000Z",
        },
      },
    ));

    assert.match(markup, /inference\.example\.test/u);
    assert.match(markup, /example-model/u);
    assert.match(markup, /In use/u);
    assert.doesNotMatch(markup, /type="password"/u);
    assert.doesNotMatch(markup, /https:\/\/inference\.example\.test/u);
  });

  it("disables changes when personal assistant configuration is unavailable", () => {
    const markup = renderToStaticMarkup(createElement(
      HostedInferenceConnectionSettings,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: false,
        initialConnection: null,
      },
    ));

    assert.match(markup, /disabled=""/u);
  });
});
