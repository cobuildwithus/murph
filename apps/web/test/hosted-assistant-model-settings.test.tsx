import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_OPENAI_PROVIDER,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  HOSTED_ASSISTANT_VENICE_PROVIDER,
} from "@murphai/hosted-execution/assistant-model";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { HostedAssistantModelSettings } from "@/src/components/settings/hosted-assistant-model-settings";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("next/image", () => ({
  default(props: {
    alt: string;
    "aria-hidden"?: boolean;
    className?: string;
    height: number;
    src: string;
    width: number;
  }) {
    return createElement("img", props);
  },
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  HostedOnboardingApiError: class HostedOnboardingApiError extends Error {
    readonly code: string | null;

    constructor(input: { code: string | null; message: string }) {
      super(input.message);
      this.code = input.code;
    }
  },
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

vi.mock("@/src/components/ui/button", () => ({
  Button({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return createElement("button", props, children);
  },
}));

vi.mock("@/src/components/ui/badge", () => ({
  Badge({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
    return createElement("span", props, children);
  },
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog({
    children,
    onOpenChange,
    open,
  }: {
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
  }) {
    return open
      ? createElement(
          "div",
          { role: "dialog" },
          children,
          createElement(
            "button",
            {
              "data-dialog-dismiss": "true",
              onClick: () => onOpenChange?.(false),
              type: "button",
            },
            "Dismiss dialog",
          ),
        )
      : null;
  },
  DialogContent({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) {
    return createElement("div", props, children);
  },
  DialogDescription({
    children,
    ...props
  }: React.HTMLAttributes<HTMLParagraphElement>) {
    return createElement("p", props, children);
  },
  DialogHeader({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) {
    return createElement("div", props, children);
  },
  DialogTitle({
    children,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement>) {
    return createElement("h2", props, children);
  },
}));

vi.mock("@/src/components/settings/hosted-plan-upgrade-button", () => ({
  UpgradeToEdgeButton({ children }: { children?: ReactNode }) {
    return createElement("button", { type: "button" }, children ?? "Upgrade to Edge");
  },
}));

const activeCleanups = new Set<() => void>();
const requireFromAssistantModelSettingsTest = createRequire(import.meta.url);
const { parseHTML } = loadLinkedom();

afterEach(() => {
  for (const cleanup of [...activeCleanups].reverse()) {
    cleanup();
  }
  activeCleanups.clear();
  vi.clearAllMocks();
});

test("eligible Pulse members can choose Luna or Terra and discover the Edge upgrade", () => {
  const markup = renderToStaticMarkup(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: true,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    }),
  );

  assert.match(markup, />Luna</);
  assert.match(markup, />Terra</);
  assert.match(markup, />Sol</);
  assert.match(markup, /Sol requires an active Edge plan\./);
  assert.match(markup, /High usage · Edge required/);
  assert.match(markup, />Upgrade to Edge<\/button>/);
  assert.match(markup, /role="radio"/);
  assert.match(markup, /Save change/);
  assert.match(markup, new RegExp(`value="${HOSTED_ASSISTANT_SOL_MODEL}"`));
});

test("other non-Edge members can still choose Luna or Terra without an invalid upgrade action", () => {
  const markup = renderToStaticMarkup(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    }),
  );

  assert.match(markup, />Luna</);
  assert.match(markup, />Terra</);
  assert.match(markup, />Sol</);
  assert.match(markup, /requires an active Edge plan\./);
  assert.doesNotMatch(markup, />Upgrade to Edge<\/button>/);
  assert.match(markup, /role="radio"/);
  assert.match(markup, /Save change/);
  assert.match(markup, new RegExp(`value="${HOSTED_ASSISTANT_SOL_MODEL}"`));
});

test("members can switch the provider without changing Terra, Luna, or Sol", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    dormantSolPreference: false,
    model: HOSTED_ASSISTANT_TERRA_MODEL,
    ok: true,
    provider: HOSTED_ASSISTANT_VENICE_PROVIDER,
    solAvailable: true,
    updated: true,
  });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      initialProvider: HOSTED_ASSISTANT_OPENAI_PROVIDER,
      solAvailable: true,
      veniceAvailable: true,
    }),
  );
  assert.match(view.container.textContent ?? "", /Core replies use OpenAI\./u);
  assert.doesNotMatch(
    view.container.textContent ?? "",
    /Direct inference through OpenAI/u,
  );
  await act(async () => {
    findButton(view.container, "Change").click();
  });
  assert.match(view.document.body.textContent ?? "", /Choose provider/u);
  assert.match(
    view.document.body.textContent ?? "",
    /Direct inference through OpenAI/u,
  );
  assert.match(
    view.document.body.textContent ?? "",
    /Privacy-first\. Venice stores no prompts or replies\./u,
  );
  assert.match(
    view.document.body.textContent ?? "",
    /This only changes core replies\. Image generation, voice, search, and other tools still use their specialized providers\./u,
  );
  const providerDialog = view.document.querySelector<HTMLElement>(
    '[role="dialog"]',
  );
  assert.ok(providerDialog);
  assert.ok(
    providerDialog.querySelector(
      'img[src="/brand-logos/assistant-providers/openai-light.svg"]',
    ),
  );
  assert.ok(
    providerDialog.querySelector(
      'img[src="/brand-logos/assistant-providers/venice-light.svg"]',
    ),
  );
  const veniceControl = findProviderRadio(
    view.document,
    HOSTED_ASSISTANT_VENICE_PROVIDER,
  );
  await act(async () => {
    veniceControl.click();
  });
  assert.equal(view.document.querySelector('[role="dialog"]'), null);
  assert.match(
    view.container.textContent ?? "",
    /Core replies switch to Venice after Save\./u,
  );
  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      provider: HOSTED_ASSISTANT_VENICE_PROVIDER,
    },
    url: "/api/settings/assistant-model",
  });
  assert.match(view.container.textContent ?? "", /Terra through Venice/u);
  assert.match(view.container.textContent ?? "", /Core replies use Venice\./u);
  assert.match(
    view.container.textContent ?? "",
    /New core replies will use Terra through Venice\. A reply already in progress may finish with your previous choice\./u,
  );
  assert.ok(isRadioChecked(findModelRadio(
    view.container,
    HOSTED_ASSISTANT_TERRA_MODEL,
  )));
  view.cleanup();
});

test("closing the provider dialog leaves the draft unchanged", async () => {
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      initialProvider: HOSTED_ASSISTANT_OPENAI_PROVIDER,
      solAvailable: true,
      veniceAvailable: true,
    }),
  );
  const saveButton = findButton(view.container, "Save change");

  await act(async () => {
    findButton(view.container, "Change").click();
  });
  const dismissButton = view.document.querySelector<HTMLButtonElement>(
    '[data-dialog-dismiss="true"]',
  );
  assert.ok(dismissButton);
  await act(async () => {
    dismissButton.click();
  });

  assert.equal(view.document.querySelector('[role="dialog"]'), null);
  assert.match(view.container.textContent ?? "", /Core replies use OpenAI\./u);
  assert.ok(saveButton.disabled);
  expect(mocks.requestHostedOnboardingJson).not.toHaveBeenCalled();

  view.cleanup();
});

test("a model-only save adopts the server's canonical provider", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    dormantSolPreference: false,
    model: HOSTED_ASSISTANT_LUNA_MODEL,
    ok: true,
    provider: HOSTED_ASSISTANT_OPENAI_PROVIDER,
    solAvailable: true,
    updated: true,
  });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      initialProvider: HOSTED_ASSISTANT_VENICE_PROVIDER,
      solAvailable: true,
      veniceAvailable: true,
    }),
  );

  await act(async () => {
    findModelRadio(view.container, HOSTED_ASSISTANT_LUNA_MODEL).click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: { model: HOSTED_ASSISTANT_LUNA_MODEL },
    url: "/api/settings/assistant-model",
  });
  assert.match(view.container.textContent ?? "", /Core replies use OpenAI\./u);
  assert.match(
    view.container.textContent ?? "",
    /New core replies will use Luna through OpenAI\./u,
  );

  view.cleanup();
});

test("a provider-only save preserves a dormant Sol preference", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    dormantSolPreference: true,
    model: HOSTED_ASSISTANT_TERRA_MODEL,
    ok: true,
    provider: HOSTED_ASSISTANT_VENICE_PROVIDER,
    solAvailable: false,
    updated: true,
  });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: true,
      configurationAvailable: true,
      initialDormantSolPreference: true,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      initialProvider: HOSTED_ASSISTANT_OPENAI_PROVIDER,
      solAvailable: false,
      veniceAvailable: true,
    }),
  );
  await act(async () => {
    findButton(view.container, "Change").click();
  });
  await act(async () => {
    findProviderRadio(
      view.document,
      HOSTED_ASSISTANT_VENICE_PROVIDER,
    ).click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: {
      provider: HOSTED_ASSISTANT_VENICE_PROVIDER,
    },
    url: "/api/settings/assistant-model",
  });
  assert.match(view.container.textContent ?? "", /Sol is still saved/u);
  assert.equal(findButton(view.container, "Save change").disabled, false);

  view.cleanup();
});

test("a combined provider and model save preserves both choices for retry", async () => {
  const combinedPayload = {
    model: HOSTED_ASSISTANT_SOL_MODEL,
    provider: HOSTED_ASSISTANT_VENICE_PROVIDER,
  };
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValueOnce({
      dormantSolPreference: false,
      model: HOSTED_ASSISTANT_SOL_MODEL,
      ok: true,
      provider: HOSTED_ASSISTANT_VENICE_PROVIDER,
      solAvailable: true,
      updated: true,
    });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      initialProvider: HOSTED_ASSISTANT_OPENAI_PROVIDER,
      solAvailable: true,
      veniceAvailable: true,
    }),
  );
  const solInput = findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL);

  await act(async () => {
    findButton(view.container, "Change").click();
  });
  await act(async () => {
    findProviderRadio(
      view.document,
      HOSTED_ASSISTANT_VENICE_PROVIDER,
    ).click();
    solInput.click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenLastCalledWith({
    method: "POST",
    payload: combinedPayload,
    url: "/api/settings/assistant-model",
  });
  assert.equal(
    view.container.querySelector('[role="alert"]')?.textContent,
    "We couldn’t save this change. Try again.",
  );
  assert.match(
    view.container.textContent ?? "",
    /Core replies switch to Venice after Save\./u,
  );
  assert.ok(isRadioChecked(solInput));
  assert.equal(findButton(view.container, "Save change").disabled, false);

  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
  expect(mocks.requestHostedOnboardingJson).toHaveBeenLastCalledWith({
    method: "POST",
    payload: combinedPayload,
    url: "/api/settings/assistant-model",
  });
  const statusLine = view.container.querySelector<HTMLElement>(
    '[aria-live="polite"]',
  );
  assert.ok(statusLine);
  assert.match(statusLine.textContent ?? "", /Sol through Venice/u);
  assert.match(view.container.textContent ?? "", /Core replies use Venice\./u);
  assert.equal(statusLine.className.includes("whitespace-nowrap"), false);
  assert.ok(findButton(view.container, "Save change").disabled);

  view.cleanup();
});

test("non-Edge members can explicitly save Luna as their default model", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    dormantSolPreference: false,
    model: HOSTED_ASSISTANT_LUNA_MODEL,
    ok: true,
    solAvailable: false,
    updated: true,
  });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: true,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    }),
  );
  const lunaInput = findModelRadio(
    view.container,
    HOSTED_ASSISTANT_LUNA_MODEL,
  );

  assert.ok(findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL).disabled);
  await act(async () => {
    lunaInput?.click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: { model: HOSTED_ASSISTANT_LUNA_MODEL },
    url: "/api/settings/assistant-model",
  });
  assert.match(
    view.container.textContent ?? "",
    /Future core replies will use GPT-5\.6 Luna\./,
  );
  assert.ok(isRadioChecked(lunaInput));
  assert.ok(findButton(view.container, "Save change").disabled);

  view.cleanup();
});

test("Edge members can explicitly save Sol as their default model", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    dormantSolPreference: false,
    model: HOSTED_ASSISTANT_SOL_MODEL,
    ok: true,
    solAvailable: true,
    updated: true,
  });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: true,
    }),
  );
  assert.match(
    view.container.textContent ?? "",
    /Choose the intelligence behind your personal health assistant\./,
  );
  const terraInput = findModelRadio(
    view.container,
    HOSTED_ASSISTANT_TERRA_MODEL,
  );
  const solInput = findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL);
  const saveButton = findButton(view.container, "Save change");

  assert.ok(isRadioChecked(terraInput));
  assert.equal(isRadioChecked(solInput), false);
  assert.ok(saveButton.disabled);

  await act(async () => {
    solInput?.click();
  });

  assert.equal(isRadioChecked(terraInput), false);
  assert.ok(isRadioChecked(solInput));
  assert.match(
    findModelLabel(view.container, HOSTED_ASSISTANT_TERRA_MODEL).textContent ?? "",
    /Current/,
  );
  assert.match(
    findModelLabel(view.container, HOSTED_ASSISTANT_SOL_MODEL).textContent ?? "",
    /Selected/,
  );
  assert.equal(saveButton.disabled, false);

  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: { model: HOSTED_ASSISTANT_SOL_MODEL },
    url: "/api/settings/assistant-model",
  });
  assert.match(
    view.container.textContent ?? "",
    /Future core replies will use GPT-5\.6 Sol\./,
  );
  assert.ok(findButton(view.container, "Save change").disabled);

  view.cleanup();
});

test("a generic save failure keeps the selected model available to retry", async () => {
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValueOnce({
      dormantSolPreference: false,
      model: HOSTED_ASSISTANT_SOL_MODEL,
      ok: true,
      solAvailable: true,
      updated: true,
    });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: true,
    }),
  );
  const solInput = findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL);

  await act(async () => {
    solInput?.click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  assert.equal(
    view.container.querySelector('[role="alert"]')?.textContent,
    "We couldn’t save this change. Try again.",
  );
  assert.ok(isRadioChecked(solInput));
  assert.equal(findButton(view.container, "Save change").disabled, false);

  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  assert.match(
    view.container.textContent ?? "",
    /Future core replies will use GPT-5\.6 Sol\./,
  );
  assert.ok(findButton(view.container, "Save change").disabled);
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);

  view.cleanup();
});

test("model radios stay labeled and the form becomes busy while saving", async () => {
  let resolveRequest: ((value: {
    dormantSolPreference: false;
    model: typeof HOSTED_ASSISTANT_SOL_MODEL;
    ok: true;
    solAvailable: true;
    updated: true;
  }) => void) | undefined;
  const request = new Promise<{
    dormantSolPreference: false;
    model: typeof HOSTED_ASSISTANT_SOL_MODEL;
    ok: true;
    solAvailable: true;
    updated: true;
  }>((resolve) => {
    resolveRequest = resolve;
  });
  mocks.requestHostedOnboardingJson.mockReturnValue(request);
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: true,
    }),
  );
  const options = [
    {
      accent: "#777b7d",
      artwork: "luna",
      backgroundAccent: "#777b7d",
      description: "Fast health intelligence",
      model: HOSTED_ASSISTANT_LUNA_MODEL,
      name: "Luna",
      usage: "Low usage",
    },
    {
      accent: "#557d78",
      artwork: "terra",
      backgroundAccent: "#4f7f97",
      description: "Advanced health intelligence",
      model: HOSTED_ASSISTANT_TERRA_MODEL,
      name: "Terra",
      usage: "Balanced usage",
    },
    {
      accent: "#8f6817",
      artwork: "sol",
      backgroundAccent: "#d9ad35",
      description: "Highest health intelligence",
      model: HOSTED_ASSISTANT_SOL_MODEL,
      name: "Sol",
      usage: "High usage",
    },
  ] as const;
  const artworkRadii: number[] = [];

  for (const option of options) {
    const input = findModelRadio(view.container, option.model);
    const label = view.container.querySelector(`label[for="${input.id}"]`);
    const visibleRadio = label?.querySelector('[role="radio"]');
    assert.equal(
      visibleRadio?.getAttribute("aria-labelledby"),
      `${input.id}-title`,
    );
    assert.equal(
      visibleRadio?.getAttribute("aria-describedby"),
      `${input.id}-description ${input.id}-meta`,
    );
    const artwork = label?.querySelector(
      `svg[data-model-artwork="${option.artwork}"][aria-hidden="true"]`,
    );
    assert.ok(artwork);
    const artworkRadius = Number(
      artwork.querySelector("circle")?.getAttribute("r"),
    );
    assert.ok(Number.isFinite(artworkRadius));
    artworkRadii.push(artworkRadius);
    assert.ok(
      label?.className.includes(
        `has-data-checked:border-[${option.accent}]`,
      ),
    );
    assert.ok(
      label?.className.includes(
        `[&_[data-slot=radio-group-item][data-checked]]:bg-[${option.accent}]`,
      ),
    );
    assert.ok(
      label?.className.includes(`hover:border-[${option.accent}]/40`),
    );
    assert.ok(
      label?.className.includes(
        `hover:bg-[${option.backgroundAccent}]/5`,
      ),
    );
    assert.ok(
      label?.className.includes(
        `has-data-checked:hover:border-[${option.accent}]`,
      ),
    );
    assert.ok(
      label?.className.includes(
        `has-data-checked:hover:bg-[${option.backgroundAccent}]/10`,
      ),
    );
    assert.ok(!label?.className.includes("hover:border-primary/35"));
    assert.match(label?.textContent ?? "", new RegExp(option.name));
    assert.match(label?.textContent ?? "", new RegExp(option.description));
    assert.match(label?.textContent ?? "", new RegExp(option.usage));
  }
  assert.ok(
    artworkRadii[0] < artworkRadii[1]
      && artworkRadii[1] < artworkRadii[2],
  );

  const solInput = findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL);
  await act(async () => {
    solInput?.click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  const form = view.container.querySelector("form");
  const fieldset = view.container.querySelector("fieldset");
  assert.equal(form?.getAttribute("aria-busy"), "true");
  assert.equal(fieldset?.querySelector("legend")?.textContent, "Default model");
  assert.ok(fieldset?.hasAttribute("disabled"));
  assert.ok(findButton(view.container, "Saving…").disabled);

  await act(async () => {
    assert.ok(resolveRequest);
    resolveRequest({
      dormantSolPreference: false,
      model: HOSTED_ASSISTANT_SOL_MODEL,
      ok: true,
      solAvailable: true,
      updated: true,
    });
    await request;
  });

  assert.equal(form?.getAttribute("aria-busy"), "false");
  assert.equal(fieldset?.hasAttribute("disabled"), false);
  assert.ok(findButton(view.container, "Save change").disabled);

  view.cleanup();
});

test("a stale Edge page removes Sol without changing the saved model", async () => {
  const { HostedOnboardingApiError } = await import(
    "@/src/components/hosted-onboarding/client-api"
  );
  mocks.requestHostedOnboardingJson.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
      message: "ineligible",
    }),
  );
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_LUNA_MODEL,
      solAvailable: true,
    }),
  );
  const solInput = findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL);

  await act(async () => {
    solInput?.click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  assert.match(
    view.container.textContent ?? "",
    /Your Edge access changed\. Murph will keep using GPT-5\.6 Luna\./,
  );
  const lunaInput = findModelRadio(view.container, HOSTED_ASSISTANT_LUNA_MODEL);
  assert.ok(isRadioChecked(lunaInput));
  assert.ok(findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL).disabled);
  assert.ok(findButton(view.container, "Save change").disabled);

  view.cleanup();
});

test("a stale Venice page falls back to OpenAI and removes the unavailable choice", async () => {
  const { HostedOnboardingApiError } = await import(
    "@/src/components/hosted-onboarding/client-api"
  );
  mocks.requestHostedOnboardingJson.mockRejectedValue(
    new HostedOnboardingApiError({
      code: "ASSISTANT_PROVIDER_VENICE_UNAVAILABLE",
      message: "unavailable",
    }),
  );
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      initialProvider: HOSTED_ASSISTANT_OPENAI_PROVIDER,
      solAvailable: true,
      veniceAvailable: true,
    }),
  );
  await act(async () => {
    findButton(view.container, "Change").click();
  });
  await act(async () => {
    findProviderRadio(
      view.document,
      HOSTED_ASSISTANT_VENICE_PROVIDER,
    ).click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  assert.match(
    view.container.textContent ?? "",
    /Venice is no longer available\. Murph will keep using OpenAI\./,
  );
  assert.doesNotMatch(view.container.textContent ?? "", /Core replies/u);
  assert.equal(findOptionalButton(view.container, "Change"), undefined);
  assert.ok(findButton(view.container, "Save change").disabled);

  view.cleanup();
});

test("refreshed eligibility resets the client state after an Edge upgrade", async () => {
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: true,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    }),
  );

  assert.ok(findModelRadio(view.container, HOSTED_ASSISTANT_LUNA_MODEL));
  assert.ok(findModelRadio(view.container, HOSTED_ASSISTANT_TERRA_MODEL));
  assert.ok(findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL).disabled);

  await view.rerender(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: true,
    }),
  );

  const terraInput = findModelRadio(
    view.container,
    HOSTED_ASSISTANT_TERRA_MODEL,
  );
  const solInput = findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL);
  assert.ok(isRadioChecked(terraInput));
  assert.equal(isRadioChecked(solInput), false);
  assert.equal(solInput.disabled, false);
  assert.ok(findButton(view.container, "Save change").disabled);

  view.cleanup();
});

test("the canonical save response removes Sol after an Edge downgrade", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    dormantSolPreference: false,
    model: HOSTED_ASSISTANT_LUNA_MODEL,
    ok: true,
    solAvailable: false,
    updated: true,
  });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_SOL_MODEL,
      solAvailable: true,
    }),
  );
  const lunaInput = findModelRadio(view.container, HOSTED_ASSISTANT_LUNA_MODEL);

  await act(async () => {
    lunaInput?.click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  assert.ok(findModelRadio(view.container, HOSTED_ASSISTANT_SOL_MODEL).disabled);
  assert.ok(findModelRadio(view.container, HOSTED_ASSISTANT_TERRA_MODEL));
  assert.ok(isRadioChecked(lunaInput));
  assert.match(
    view.container.textContent ?? "",
    /Future core replies will use GPT-5\.6 Luna\./,
  );

  view.cleanup();
});

test("a dormant Sol preference is explained and can be replaced with Terra", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    dormantSolPreference: false,
    model: HOSTED_ASSISTANT_TERRA_MODEL,
    ok: true,
    solAvailable: false,
    updated: true,
  });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: true,
      configurationAvailable: true,
      initialDormantSolPreference: true,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    }),
  );

  assert.match(
    view.container.textContent ?? "",
    /Terra is active while Edge is paused\. Sol is still saved and will return with Edge\./,
  );
  assert.equal(findButton(view.container, "Save change").disabled, false);

  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
    method: "POST",
    payload: { model: HOSTED_ASSISTANT_TERRA_MODEL },
    url: "/api/settings/assistant-model",
  });
  assert.doesNotMatch(
    view.container.textContent ?? "",
    /Sol is still saved/,
  );
  assert.ok(findButton(view.container, "Save change").disabled);

  view.cleanup();
});

test("members without active personal access see read-only model controls", () => {
  const markup = renderToStaticMarkup(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: false,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    }),
  );

  assert.match(
    markup,
    /Model choices are read-only until personal Murph access is active\./,
  );
  assert.match(markup, /<fieldset[^>]*disabled=""/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Save change<\/button>/);
  assert.doesNotMatch(markup, /Sol requires an active Edge plan/);
});

test("members without active personal access see both provider and model controls explained", () => {
  const markup = renderToStaticMarkup(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      configurationAvailable: false,
      initialDormantSolPreference: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      initialProvider: HOSTED_ASSISTANT_OPENAI_PROVIDER,
      solAvailable: false,
      veniceAvailable: true,
    }),
  );

  assert.match(
    markup,
    /Provider and model choices are read-only until personal Murph access is active\./,
  );
  assert.match(markup, /Core replies use.*OpenAI/su);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Change<\/button>/u);
  assert.doesNotMatch(markup, /Choose provider/u);
});

function findModelRadio(
  container: HTMLElement,
  model: string,
): HTMLInputElement {
  const radio = container.querySelector<HTMLInputElement>(
    `[id="assistant-model-${model}"]`,
  );
  assert.ok(radio);
  return radio;
}

function isRadioChecked(radio: HTMLInputElement): boolean {
  return radio.checked;
}

function findModelLabel(container: HTMLElement, model: string): HTMLLabelElement {
  const label = container.querySelector<HTMLLabelElement>(
    `label[for="assistant-model-${model}"]`,
  );
  assert.ok(label);
  return label;
}

function findProviderRadio(
  container: ParentNode,
  provider: string,
): HTMLElement {
  const radio = container.querySelector<HTMLElement>(
    `[id="assistant-provider-${provider}"]`,
  );
  assert.ok(radio);
  return radio;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = findOptionalButton(container, label);
  assert.ok(button);
  return button;
}

function findOptionalButton(
  container: ParentNode,
  label: string,
): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  );
}

function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  assert.ok(form);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function renderClient(element: ReactNode) {
  const { document, window } = parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  const cleanupGlobals = installGlobals(window, document);
  activeCleanups.add(cleanupGlobals);
  const container = document.getElementById("root");
  assert.ok(container);

  let root: Root | null = createRoot(container);

  await act(async () => {
    root?.render(element);
  });

  return {
    cleanup: () => {
      act(() => {
        root?.unmount();
        root = null;
      });
      cleanupGlobals();
      activeCleanups.delete(cleanupGlobals);
    },
    container,
    document,
    rerender: async (nextElement: ReactNode) => {
      await act(async () => {
        root?.render(nextElement);
      });
    },
  };
}

function installGlobals(
  window: Window & typeof globalThis,
  document: Document,
) {
  const restoreEntries = [
    setGlobal("window", window),
    setGlobal("self", window),
    setGlobal("document", document),
    setGlobal("navigator", window.navigator),
    setGlobal("HTMLElement", window.HTMLElement),
    setGlobal("Node", window.Node),
    setGlobal("Event", window.Event),
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true),
  ];

  return () => {
    for (const restore of restoreEntries.reverse()) {
      restore();
    }
  };
}

function setGlobal(key: string, value: unknown) {
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalThis, key);
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, key);

  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (hadOwnProperty) {
      assert.ok(previousDescriptor);
      Object.defineProperty(globalThis, key, previousDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, key);
  };
}

function loadLinkedom(): {
  parseHTML: (html: string) => {
    document: Document;
    window: Window & typeof globalThis;
  };
} {
  const resolvePaths = [
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "node_modules/.pnpm/node_modules"),
  ];

  for (const resolvePath of resolvePaths) {
    try {
      const resolvedEntry = requireFromAssistantModelSettingsTest.resolve(
        "linkedom",
        { paths: [resolvePath] },
      );
      return requireFromAssistantModelSettingsTest(resolvedEntry) as {
        parseHTML: (html: string) => {
          document: Document;
          window: Window & typeof globalThis;
        };
      };
    } catch {
      continue;
    }
  }

  throw new Error("linkedom is required for assistant model settings tests");
}
