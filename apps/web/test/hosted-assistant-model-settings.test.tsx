import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

import {
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
} from "@murphai/hosted-execution/assistant-model";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { HostedAssistantModelSettings } from "@/src/components/settings/hosted-assistant-model-settings";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
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

test("eligible Pulse members see Sol with an Edge upgrade action", () => {
  const markup = renderToStaticMarkup(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: true,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    }),
  );

  assert.match(markup, /Available models/);
  assert.match(markup, /GPT-5\.6 Terra/);
  assert.match(markup, /GPT-5\.6 Sol/);
  assert.match(markup, /Upgrade to Edge to unlock GPT-5\.6 Sol\./);
  assert.match(markup, />Upgrade to Edge<\/button>/);
  assert.doesNotMatch(markup, /type="radio"/);
  assert.doesNotMatch(markup, /Save model/);
});

test("other non-Edge members can discover Sol without an invalid upgrade action", () => {
  const markup = renderToStaticMarkup(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    }),
  );

  assert.match(markup, /GPT-5\.6 Terra/);
  assert.match(markup, /GPT-5\.6 Sol/);
  assert.match(markup, /Available with an active Edge plan\./);
  assert.doesNotMatch(markup, />Upgrade to Edge<\/button>/);
  assert.doesNotMatch(markup, /type="radio"/);
  assert.doesNotMatch(markup, /Save model/);
});

test("Edge members can explicitly save Sol as their default model", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    model: HOSTED_ASSISTANT_SOL_MODEL,
    ok: true,
    solAvailable: true,
    updated: true,
  });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: true,
    }),
  );
  assert.match(
    view.container.textContent ?? "",
    /An idle run can take up to three minutes to close\./,
  );
  const terraInput = view.container.querySelector<HTMLInputElement>(
    `input[value="${HOSTED_ASSISTANT_TERRA_MODEL}"]`,
  );
  const solInput = view.container.querySelector<HTMLInputElement>(
    `input[value="${HOSTED_ASSISTANT_SOL_MODEL}"]`,
  );
  const saveButton = findButton(view.container, "Save model");

  assert.ok(terraInput?.checked);
  assert.equal(solInput?.checked, false);
  assert.ok(saveButton.disabled);

  await act(async () => {
    solInput?.click();
  });

  assert.equal(terraInput?.checked, false);
  assert.ok(solInput?.checked);
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
    /Default model updated to GPT-5\.6 Sol\./,
  );
  assert.ok(findButton(view.container, "Save model").disabled);

  view.cleanup();
});

test("a generic save failure keeps the selected model available to retry", async () => {
  mocks.requestHostedOnboardingJson
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValueOnce({
      model: HOSTED_ASSISTANT_SOL_MODEL,
      ok: true,
      solAvailable: true,
      updated: true,
    });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: true,
    }),
  );
  const solInput = view.container.querySelector<HTMLInputElement>(
    `input[value="${HOSTED_ASSISTANT_SOL_MODEL}"]`,
  );

  await act(async () => {
    solInput?.click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  assert.equal(
    view.container.querySelector('[role="alert"]')?.textContent,
    "Could not update your default model. Try again.",
  );
  assert.ok(solInput?.checked);
  assert.equal(findButton(view.container, "Save model").disabled, false);

  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  assert.match(
    view.container.textContent ?? "",
    /Default model updated to GPT-5\.6 Sol\./,
  );
  assert.ok(findButton(view.container, "Save model").disabled);
  expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);

  view.cleanup();
});

test("model radios stay labeled and the form becomes busy while saving", async () => {
  let resolveRequest: ((value: {
    model: typeof HOSTED_ASSISTANT_SOL_MODEL;
    ok: true;
    solAvailable: true;
    updated: true;
  }) => void) | undefined;
  const request = new Promise<{
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
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: true,
    }),
  );
  const options = [
    {
      description: "Balanced for everyday work. The Murph default.",
      model: HOSTED_ASSISTANT_TERRA_MODEL,
      name: "GPT-5.6 Terra",
    },
    {
      description:
        "The most capable GPT-5.6 model for harder work. Uses more of your Edge plan’s AI usage.",
      model: HOSTED_ASSISTANT_SOL_MODEL,
      name: "GPT-5.6 Sol",
    },
  ] as const;

  for (const option of options) {
    const input = view.container.querySelector<HTMLInputElement>(
      `input[value="${option.model}"]`,
    );
    assert.ok(input);
    const nameId = input.getAttribute("aria-labelledby");
    const descriptionId = input.getAttribute("aria-describedby");
    assert.ok(nameId);
    assert.ok(descriptionId);
    assert.equal(
      view.container.querySelector(`[id="${nameId}"]`)?.textContent,
      option.name,
    );
    assert.equal(
      view.container.querySelector(`[id="${descriptionId}"]`)?.textContent,
      option.description,
    );
  }

  const solInput = view.container.querySelector<HTMLInputElement>(
    `input[value="${HOSTED_ASSISTANT_SOL_MODEL}"]`,
  );
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
      model: HOSTED_ASSISTANT_SOL_MODEL,
      ok: true,
      solAvailable: true,
      updated: true,
    });
    await request;
  });

  assert.equal(form?.getAttribute("aria-busy"), "false");
  assert.equal(fieldset?.hasAttribute("disabled"), false);
  assert.ok(findButton(view.container, "Save model").disabled);

  view.cleanup();
});

test("a stale Edge page becomes read-only when Sol is no longer available", async () => {
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
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: true,
    }),
  );
  const solInput = view.container.querySelector<HTMLInputElement>(
    `input[value="${HOSTED_ASSISTANT_SOL_MODEL}"]`,
  );

  await act(async () => {
    solInput?.click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  const alert = view.container.querySelector('[role="alert"]');
  assert.equal(
    alert?.textContent,
    "Your Edge access changed. GPT-5.6 Terra is now active.",
  );
  assert.equal(view.container.querySelector('input[type="radio"]'), null);
  assert.equal(
    [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save model",
    ),
    undefined,
  );

  view.cleanup();
});

test("refreshed eligibility resets the client state after an Edge upgrade", async () => {
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: true,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: false,
    }),
  );

  assert.equal(view.container.querySelector('input[type="radio"]'), null);

  await view.rerender(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      initialModel: HOSTED_ASSISTANT_TERRA_MODEL,
      solAvailable: true,
    }),
  );

  const terraInput = view.container.querySelector<HTMLInputElement>(
    `input[value="${HOSTED_ASSISTANT_TERRA_MODEL}"]`,
  );
  const solInput = view.container.querySelector<HTMLInputElement>(
    `input[value="${HOSTED_ASSISTANT_SOL_MODEL}"]`,
  );
  assert.ok(terraInput?.checked);
  assert.equal(solInput?.checked, false);
  assert.ok(findButton(view.container, "Save model").disabled);

  view.cleanup();
});

test("the canonical save response removes Sol after an Edge downgrade", async () => {
  mocks.requestHostedOnboardingJson.mockResolvedValue({
    model: HOSTED_ASSISTANT_TERRA_MODEL,
    ok: true,
    solAvailable: false,
    updated: true,
  });
  const view = await renderClient(
    createElement(HostedAssistantModelSettings, {
      canUpgradeToEdge: false,
      initialModel: HOSTED_ASSISTANT_SOL_MODEL,
      solAvailable: true,
    }),
  );
  const terraInput = view.container.querySelector<HTMLInputElement>(
    `input[value="${HOSTED_ASSISTANT_TERRA_MODEL}"]`,
  );

  await act(async () => {
    terraInput?.click();
  });
  await act(async () => {
    submitForm(view.container);
    await Promise.resolve();
  });

  assert.equal(view.container.querySelector('input[type="radio"]'), null);
  assert.match(view.container.textContent ?? "", /GPT-5\.6 Terra/);
  assert.match(
    view.container.textContent ?? "",
    /Default model updated to GPT-5\.6 Terra\./,
  );

  view.cleanup();
});

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  );
  assert.ok(button);
  return button;
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
