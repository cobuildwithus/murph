import assert from "node:assert/strict";

import { act, createElement, type InputHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HostedInferenceConnectionPane,
} from "@/src/components/settings/hosted-inference-connection-settings";
import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  HostedOnboardingApiError: class HostedOnboardingApiError extends Error {},
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/ui/input", () => ({
  Input({ onChange, ...props }: InputHTMLAttributes<HTMLInputElement>) {
    return createElement("input", {
      ...props,
      onChange,
      onInput: onChange,
    });
  },
}));

describe("hosted inference connection pane", () => {
  beforeEach(() => {
    mocks.requestHostedOnboardingJson.mockReset();
  });

  it("explains the privacy boundary before collecting a secret", () => {
    const markup = renderToStaticMarkup(createElement(
      HostedInferenceConnectionPane,
      {
        chatCompletionsAvailable: false,
        configurationAvailable: true,
        connection: null,
        onConnectionChange: () => {},
        selected: false,
      },
    ));

    assert.match(
      markup,
      /relevant conversation context, tool descriptions, and\s+supported attachments/u,
    );
    assert.match(
      markup,
      /credential is encrypted and\s+is never placed in the assistant runner/u,
    );
    assert.match(markup, /type="password"/u);
    assert.match(markup, /Verify and save/u);
    assert.match(markup, /Public HTTPS on port 443/u);
    assert.match(markup, /Responses API/u);
    assert.match(markup, /Bearer token/u);
    assert.match(markup, />Custom connection details</u);
    assert.match(
      markup,
      /aria-describedby="hosted-inference-images-description"/u,
    );
    assert.match(markup, /id="hosted-inference-images-description"/u);
    assert.doesNotMatch(markup, />Chat Completions</u);
  });

  it("renders only sanitized metadata for a saved connection", () => {
    const markup = renderToStaticMarkup(createElement(
      HostedInferenceConnectionPane,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: true,
        connection: savedConnection(true),
        onConnectionChange: () => {},
        selected: true,
      },
    ));

    assert.match(markup, /inference\.example\.test/u);
    assert.match(markup, /example-model/u);
    assert.match(markup, /In use/u);
    assert.match(markup, /Revision/u);
    assert.match(markup, />4</u);
    assert.match(markup, /Jul 30, 2026/u);
    assert.match(markup, /12:00 PM UTC/u);
    assert.doesNotMatch(markup, /type="password"/u);
    assert.doesNotMatch(markup, /https:\/\/inference\.example\.test/u);
  });

  it("shows a verified connection as inactive until it is routed", () => {
    const markup = renderToStaticMarkup(createElement(
      HostedInferenceConnectionPane,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: true,
        connection: savedConnection(false),
        onConnectionChange: () => {},
        selected: false,
      },
    ));

    assert.match(markup, /Verified, inactive/u);
    assert.doesNotMatch(markup, /In use/u);
  });

  it("disables changes when personal assistant configuration is unavailable", () => {
    const markup = renderToStaticMarkup(createElement(
      HostedInferenceConnectionPane,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: false,
        connection: null,
        onConnectionChange: () => {},
        selected: false,
      },
    ));

    assert.match(markup, /disabled=""/u);
    assert.match(
      markup,
      /Endpoint choices are read-only until personal Murph access is active/u,
    );
  });

  it("hands a verified connection upward without routing replies to it", async () => {
    const connectionChanges: unknown[] = [];
    mocks.requestHostedOnboardingJson.mockResolvedValueOnce({
      connection: savedConnection(false),
    });
    const view = await renderClientComponent(createElement(
      HostedInferenceConnectionPane,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: true,
        connection: null,
        onConnectionChange: (next: unknown) => connectionChanges.push(next),
        selected: false,
      },
    ));

    try {
      await act(() => {
        setInputValue(
          view,
          "hosted-inference-endpoint",
          "https://inference.example.test/v1/responses",
        );
        setInputValue(view, "hosted-inference-model", "example-model");
        setInputValue(view, "hosted-inference-secret", "synthetic-secret");
      });
      await act(async () => {
        submitForm(view);
        await Promise.resolve();
      });

      expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(1, {
        method: "PUT",
        payload: {
          auth: { kind: "bearer", secret: "synthetic-secret" },
          contextWindowTokens: 131_072,
          endpointUrl: "https://inference.example.test/v1/responses",
          expectedRevision: null,
          model: "example-model",
          protocol: "responses",
          supportsImages: false,
        },
        url: "/api/settings/inference-connection",
      });
      // Verification is not activation: the pane never calls the mode route.
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);
      assert.deepEqual(connectionChanges, [savedConnection(false)]);
      assert.match(
        view.container.textContent ?? "",
        /Choose Your endpoint and save to route inference to it/u,
      );
      assert.equal(nonEmptyLiveRegions(view.container).length, 1);
    } finally {
      await view.cleanup();
    }
  });

  it("warns that deleting the routed endpoint returns replies to Murph", async () => {
    const view = await renderClientComponent(createElement(
      HostedInferenceConnectionPane,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: true,
        connection: savedConnection(true),
        onConnectionChange: () => {},
        selected: true,
      },
    ));

    try {
      await act(async () => {
        findButton(view.container, "Delete connection").click();
      });
      assert.match(
        view.container.textContent ?? "",
        /Inference will return to your managed provider/u,
      );
    } finally {
      await view.cleanup();
    }
  });

  it("does not claim an inactive deletion changes routing", async () => {
    const view = await renderClientComponent(createElement(
      HostedInferenceConnectionPane,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: true,
        connection: savedConnection(false),
        onConnectionChange: () => {},
        selected: false,
      },
    ));

    try {
      await act(async () => {
        findButton(view.container, "Delete connection").click();
      });
      assert.match(
        view.container.textContent ?? "",
        /Delete the saved endpoint and credential\?/u,
      );
      assert.doesNotMatch(
        view.container.textContent ?? "",
        /Inference will return to your managed provider/u,
      );
    } finally {
      await view.cleanup();
    }
  });
});

function savedConnection(selected: boolean) {
  return {
    contextWindowTokens: 131_072,
    endpointHost: "inference.example.test",
    model: "example-model",
    protocol: "responses" as const,
    revision: 4,
    selected,
    supportsImages: false,
    verificationProfile:
      "murph-codex-0.147.0-portable-responses-v1" as const,
    verifiedAt: "2026-07-30T12:00:00.000Z",
  };
}

function setInputValue(
  view: Awaited<ReturnType<typeof renderClientComponent>>,
  id: string,
  value: string,
): void {
  const input = view.container.querySelector<HTMLInputElement>(`#${id}`);
  assert.ok(input);
  input.value = value;
  input.dispatchEvent(new view.window.Event("input", { bubbles: true }));
}

function submitForm(
  view: Awaited<ReturnType<typeof renderClientComponent>>,
): void {
  const form = view.container.querySelector("form");
  assert.ok(form);
  form.dispatchEvent(new view.window.Event("submit", {
    bubbles: true,
    cancelable: true,
  }));
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent === label);
  assert.ok(button);
  return button;
}

function nonEmptyLiveRegions(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[aria-live]")]
    .filter((region) => Boolean(region.textContent));
}
