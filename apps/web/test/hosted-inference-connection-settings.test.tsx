import assert from "node:assert/strict";

import { act, createElement, type InputHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HostedInferenceConnectionSettings,
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

describe("hosted inference connection settings", () => {
  beforeEach(() => {
    mocks.requestHostedOnboardingJson.mockReset();
  });

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
    assert.match(
      markup,
      /relevant conversation context, tool descriptions, and supported attachments/u,
    );
    assert.match(markup, /New core replies use Murph-managed inference/u);
    assert.match(markup, /type="password"/u);
    assert.match(markup, /Verify and save/u);
    assert.match(markup, /Public HTTPS on port 443/u);
    assert.match(markup, /Responses API/u);
    assert.match(markup, /Bearer token/u);
    assert.match(markup, />Inference mode</u);
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
    assert.match(markup, /Revision/u);
    assert.match(markup, />4</u);
    assert.match(markup, /Jul 30, 2026/u);
    assert.match(markup, /12:00 PM UTC/u);
    assert.match(markup, /normal-case \[overflow-wrap:anywhere\]/u);
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
    assert.match(markup, /data-disabled="true"/u);
    assert.match(
      markup,
      /Inference choices are read-only until personal Murph access is active/u,
    );
  });

  it("keeps verification inactive until an explicit mode save", async () => {
    mocks.requestHostedOnboardingJson
      .mockResolvedValueOnce({
        connection: savedConnection(false),
      })
      .mockResolvedValueOnce({ mode: "custom", updated: true })
      .mockResolvedValueOnce({ deleted: true });
    const view = await renderClientComponent(createElement(
      HostedInferenceConnectionSettings,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: true,
        initialConnection: null,
      },
    ));

    try {
      await act(() => {
        setInputValue(view, "hosted-inference-endpoint", "https://inference.example.test/v1/responses");
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
      assert.match(view.container.textContent ?? "", /Verified, inactive/u);
      assert.match(
        view.container.textContent ?? "",
        /New core replies use Murph-managed inference/u,
      );
      const saveMode = findButton(view.container, "Save inference mode");
      assert.equal(saveMode.disabled, true);
      assert.equal(nonEmptyLiveRegions(view.container).length, 1);

      await act(async () => {
        findRadio(view.container, "assistant-inference-custom").click();
      });
      assert.equal(saveMode.disabled, false);
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

      await act(async () => {
        saveMode.click();
        await Promise.resolve();
      });

      expect(mocks.requestHostedOnboardingJson).toHaveBeenNthCalledWith(2, {
        method: "POST",
        payload: { mode: "custom" },
        url: "/api/settings/assistant",
      });
      assert.match(view.container.textContent ?? "", /In use/u);
      assert.match(
        view.container.textContent ?? "",
        /New core replies use your verified endpoint/u,
      );
      assert.equal(nonEmptyLiveRegions(view.container).length, 1);

      await act(async () => {
        findButton(view.container, "Delete connection").click();
      });
      assert.match(
        view.container.textContent ?? "",
        /New core replies will switch to Murph-managed inference/u,
      );
      await act(async () => {
        findButton(view.container, "Delete").click();
        await Promise.resolve();
      });
      assert.match(view.container.textContent ?? "", /Connection deleted/u);
      assert.match(
        view.container.textContent ?? "",
        /New core replies use Murph-managed inference/u,
      );
      assert.deepEqual(
        nonEmptyLiveRegions(view.container).map((region) => region.textContent),
        ["Connection deleted. New core replies use Murph-managed inference."],
      );
    } finally {
      await view.cleanup();
    }
  });

  it("does not claim an inactive deletion changes routing", async () => {
    const view = await renderClientComponent(createElement(
      HostedInferenceConnectionSettings,
      {
        chatCompletionsAvailable: true,
        configurationAvailable: true,
        initialConnection: savedConnection(false),
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
        /will switch to Murph-managed inference/u,
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
      "murph-codex-0.145.0-portable-responses-v1" as const,
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

function findRadio(container: HTMLElement, id: string): HTMLElement {
  const radio = container.querySelector<HTMLElement>(`#${id}`);
  assert.ok(radio);
  return radio;
}

function nonEmptyLiveRegions(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[aria-live]")]
    .filter((region) => Boolean(region.textContent));
}
