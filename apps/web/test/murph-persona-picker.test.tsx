import assert from "node:assert/strict";

import {
  act,
  createElement,
  forwardRef,
  useImperativeHandle,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import type { MurphPersonaPreferences } from "@/src/components/murph/murph-persona-picker";

import { renderClientComponent } from "./render-client-component";

const componentMocks = vi.hoisted(() => ({
  playerPlay: vi.fn(),
  useIsMobile: vi.fn(() => false),
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    onOpenChange,
    open,
  }: {
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
  }) =>
    open
      ? createElement(
          "div",
          { "data-dialog-open": "true" },
          createElement(
            "button",
            {
              "data-dialog-dismiss": "true",
              onClick: () => onOpenChange?.(false),
              type: "button",
            },
            "Dismiss",
          ),
          children,
        )
      : null,
  DialogContent: ({ children, className, style }: HTMLAttributes<HTMLDivElement>) =>
    createElement(
      "div",
      { className, "data-dialog-content": "true", style },
      children,
    ),
  DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

vi.mock("@/src/components/ui/drawer", () => ({
  Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? createElement("div", { "data-drawer-open": "true" }, children) : null,
  DrawerContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { className, "data-drawer-content": "true" }, children),
  DrawerDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DrawerFooter: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DrawerHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DrawerTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

vi.mock("@/src/components/ui/voice-memo-player", () => ({
  VoiceMemoPlayer: forwardRef<
    { play: () => void },
    { fallbackSrc?: string; preload?: string; src: string }
  >(function MockVoiceMemoPlayer({ fallbackSrc, preload, src }, ref) {
    useImperativeHandle(ref, () => ({ play: componentMocks.playerPlay }));
    return createElement("div", {
      "data-fallback-preview": fallbackSrc,
      "data-preload": preload,
      "data-voice-preview": src,
    });
  }),
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: componentMocks.useIsMobile,
}));

beforeEach(() => {
  componentMocks.playerPlay.mockReset();
  componentMocks.useIsMobile.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("MurphPersonaPicker saves the selected persona, voice, and tone atomically", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      assistantPersona: "navy-seal-with-stoic-philosopher",
      assistantTone: "casual",
      assistantVoice: "husky",
    }),
    init,
  }));
  vi.stubGlobal("fetch", fetchMock);
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onComplete,
      onOpenChange,
      open: true,
    }),
    { requireButton: false },
  );

  try {
    const stepTitle = rendered.container.querySelector(
      "[data-persona-picker-step-title]",
    );
    assert.ok(stepTitle instanceof rendered.window.HTMLElement);
    const focusStepTitle = vi.fn();
    Object.defineProperty(stepTitle, "focus", {
      configurable: true,
      value: focusStepTitle,
    });

    await clickControlContaining(rendered, "Navy SEAL");
    await clickControlContaining(rendered, "Continue");
    assert.deepEqual(focusStepTitle.mock.calls[0], [{ preventScroll: true }]);
    await clickControlContaining(rendered, "Stoic Philosopher");
    await clickControlContaining(rendered, "Continue");

    const preview = rendered.container.querySelector(
      "[data-voice-preview='/audio/murph-personas/navy-seal/husky.mp3']",
    );
    assert.ok(preview);
    assert.equal(
      preview.getAttribute("data-fallback-preview"),
      "/audio/murph-voices/husky.mp3",
    );
    assert.equal(preview.getAttribute("data-preload"), "metadata");

    await act(async () => {
      (preview as HTMLElement).click();
    });
    await clickControlContaining(rendered, "Continue");
    assert.match(rendered.container.textContent ?? "", /Pick Murph’s tone/u);
    const toneOptions = rendered.container.querySelector(
      "[data-persona-picker-step='tone'] fieldset > div",
    );
    assert.ok(toneOptions instanceof rendered.window.HTMLElement);
    assert.ok(toneOptions.classList.contains("flex"));
    assert.ok(toneOptions.classList.contains("flex-col"));
    await clickControlContaining(rendered, "Casual");
    await clickControlContaining(rendered, "Continue");

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(fetchMock.mock.calls[0]?.[0], "/api/settings/assistant-style");
    assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), {
      persona: "navy-seal-with-stoic-philosopher",
      tone: "casual",
      voice: "husky",
    });
    assert.deepEqual(onComplete.mock.calls[0], [{
      persona: "navy-seal-with-stoic-philosopher",
      tone: "casual",
      voice: "husky",
    }]);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker reuses the main and supporting steps without changing tone or voice", async () => {
  const savePreference = vi.fn(async (preferences: MurphPersonaPreferences) =>
    preferences
  );
  const onOpenChange = vi.fn();
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      initialPersona: "classic-with-navy-seal",
      initialTone: "formal",
      initialVoice: "grandpa",
      mode: "personality",
      onOpenChange,
      open: true,
      savePreference,
    }),
    { requireButton: false },
  );

  try {
    assert.match(rendered.container.textContent ?? "", /Step 1 of 2/u);
    assert.match(rendered.container.textContent ?? "", /Cancel/u);
    await clickControlContaining(rendered, "Scientist");
    await clickControlContaining(rendered, "Continue");
    assert.match(rendered.container.textContent ?? "", /Step 2 of 2/u);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Choose a voice/u);
    await clickControlContaining(rendered, "Classic");
    await clickControlContaining(rendered, "Save personality");

    assert.deepEqual(savePreference.mock.calls[0], [{
      persona: "scientist-with-classic",
      tone: "formal",
      voice: "grandpa",
    }]);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker skips without writing preferences", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onComplete,
      onOpenChange,
      open: true,
    }),
    { requireButton: false },
  );

  try {
    await clickControlContaining(rendered, "Skip");
    assert.equal(fetchMock.mock.calls.length, 0);
    assert.equal(onComplete.mock.calls.length, 1);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker puts truthful progress and retry on the visible Skip action", async () => {
  let rejectSkip: ((reason?: unknown) => void) | undefined;
  const skipPreference = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectSkip = reject;
    }))
    .mockResolvedValueOnce(undefined);
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onComplete,
      onOpenChange,
      open: true,
      skipPreference,
    }),
    { requireButton: false },
  );

  try {
    await clickControlContaining(rendered, "Skip");
    const skippingButton = Array.from(
      rendered.container.querySelectorAll("button"),
    ).find((candidate) => candidate.textContent?.includes("Skipping…"));
    const continueButton = Array.from(
      rendered.container.querySelectorAll("button"),
    ).find((candidate) => candidate.textContent?.trim() === "Continue");
    assert.ok(skippingButton, "Missing Skipping progress on the Skip action");
    assert.equal(skippingButton.getAttribute("aria-busy"), "true");
    assert.equal(skippingButton.hasAttribute("disabled"), true);
    assert.ok(continueButton, "Missing unchanged Continue action");
    assert.equal(continueButton.getAttribute("aria-busy"), "false");
    assert.doesNotMatch(continueButton.textContent ?? "", /Saving/u);

    assert.ok(rejectSkip);
    await act(async () => {
      rejectSkip?.(new Error("offline"));
      await Promise.resolve();
    });

    const alert = rendered.container.querySelector("[role='alert']");
    assert.match(alert?.textContent ?? "", /Could not skip setup/u);
    assert.doesNotMatch(alert?.textContent ?? "", /Could not save your Murph/u);
    await clickControlContaining(rendered, "Retry skip");

    assert.equal(skipPreference.mock.calls.length, 2);
    assert.deepEqual(onComplete.mock.calls[0], [null]);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker exposes finishing and an explicit retry after dismissing a later step", async () => {
  let rejectSkip: ((reason?: unknown) => void) | undefined;
  const skipPreference = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectSkip = reject;
    }))
    .mockResolvedValueOnce(undefined);
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onComplete,
      onOpenChange,
      open: true,
      skipPreference,
    }),
    { requireButton: false },
  );

  try {
    await clickControlContaining(rendered, "Navy SEAL");
    await clickControlContaining(rendered, "Continue");
    const dismiss = rendered.container.querySelector("[data-dialog-dismiss]");
    assert.ok(dismiss instanceof rendered.window.HTMLButtonElement);
    await act(async () => dismiss.click());

    assert.match(rendered.container.textContent ?? "", /Finishing…/u);
    assert.match(rendered.container.textContent ?? "", /Navy SEAL leads/u);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Saving…/u);

    assert.ok(rejectSkip);
    await act(async () => {
      rejectSkip?.(new Error("offline"));
      await Promise.resolve();
    });

    assert.match(
      rendered.container.querySelector("[role='alert']")?.textContent ?? "",
      /Could not skip setup/u,
    );
    assert.match(rendered.container.textContent ?? "", /Navy SEAL leads/u);
    await clickControlContaining(rendered, "Retry skip");

    assert.equal(skipPreference.mock.calls.length, 2);
    assert.deepEqual(onComplete.mock.calls[0], [null]);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker chooses a main personality and an optional supporting personality", async () => {
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onOpenChange: vi.fn(),
      open: true,
    }),
    { requireButton: false },
  );

  try {
    const mainFieldset = rendered.container.querySelector("fieldset");
    assert.equal(
      mainFieldset?.querySelector("legend")?.textContent?.trim(),
      "Main Murph personality",
    );
    const mainRadios = Array.from(
      mainFieldset?.querySelectorAll<HTMLInputElement>("input[type='radio']")
        ?? [],
    );
    assert.equal(mainRadios.length, 6);
    assertCardFocusUsesSingleBorder(mainRadios);
    assert.equal(mainRadios.filter((radio) => radio.checked).length, 1);
    assert.equal(new Set(mainRadios.map((radio) => radio.name)).size, 1);
    assert.match(rendered.container.textContent ?? "", /Classic/u);
    assert.match(rendered.container.textContent ?? "", /Navy SEAL/u);
    assert.match(rendered.container.textContent ?? "", /Stoic Philosopher/u);
    assert.match(rendered.container.textContent ?? "", /Scientist/u);
    assert.match(rendered.container.textContent ?? "", /Hype Coach/u);
    assert.match(rendered.container.textContent ?? "", /Straight-Talking Friend/u);
    assert.equal(
      rendered.container.querySelectorAll("[data-persona-glyph]").length,
      6,
    );
    const friendGlyph = rendered.container.querySelector(
      "[data-persona-glyph='straight-talking-friend']",
    );
    assert.equal(friendGlyph?.querySelectorAll("circle").length, 2);
    assert.equal(friendGlyph?.querySelectorAll("path").length, 2);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Text style|Voice/u);

    await clickControlContaining(rendered, "Navy SEAL");
    await clickControlContaining(rendered, "Continue");

    const supportFieldset = rendered.container.querySelector("fieldset");
    assert.equal(
      supportFieldset?.querySelector("legend")?.textContent?.trim(),
      "Supporting Murph personality",
    );
    const supportRadios = Array.from(
      supportFieldset?.querySelectorAll<HTMLInputElement>("input[type='radio']")
        ?? [],
    );
    assert.equal(supportRadios.length, 6);
    assertCardFocusUsesSingleBorder(supportRadios);
    assert.equal(supportRadios.filter((radio) => radio.checked).length, 1);
    assert.equal(new Set(supportRadios.map((radio) => radio.name)).size, 1);
    assert.notEqual(mainRadios[0]?.name, supportRadios[0]?.name);
    assert.match(rendered.container.textContent ?? "", /Navy SEAL leads/u);
    assert.match(rendered.container.textContent ?? "", /No supporting personality/u);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Drill Sergeant/u);
    assert.equal(
      rendered.container.querySelector("[data-voice-preview]"),
      null,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Normal capitalization|Relaxed, lowercase/u,
    );

    await clickControlContaining(rendered, "Stoic Philosopher");
    assert.match(
      rendered.container.textContent ?? "",
      /Supported by Stoic Philosopher/u,
    );

    await clickControlContaining(rendered, "Continue");
    const voiceFieldset = rendered.container.querySelector("fieldset");
    assert.equal(
      voiceFieldset?.querySelector("legend")?.textContent?.trim(),
      "Murph voice",
    );
    assert.match(
      voiceFieldset?.textContent ?? "",
      /Recommended for Navy SEAL/u,
    );
    assert.match(voiceFieldset?.textContent ?? "", /Other voices/u);
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Choose how .* should sound/u,
    );
    const voiceRadios = Array.from(
      voiceFieldset?.querySelectorAll<HTMLInputElement>("input[type='radio']") ?? [],
    );
    assert.equal(voiceRadios.length, 22);
    assertCardFocusUsesSingleBorder(voiceRadios);
    assert.equal(voiceRadios.filter((radio) => radio.checked).length, 1);
    assert.equal(
      voiceRadios.find((radio) => radio.checked)?.value,
      "drill-sergeant",
    );
    assert.notEqual(supportRadios[0]?.name, voiceRadios[0]?.name);

    await clickControlContaining(rendered, "Radio host");
    await clickControlContaining(rendered, "Radio host");
    assert.match(rendered.container.textContent ?? "", /Other voices/u);
    const radioHost = voiceRadios.find((radio) => radio.value === "radio-host");
    assert.ok(radioHost);
    const radioHostLabel = radioHost.ownerDocument.querySelector(
      `label[for='${radioHost.id}']`,
    );
    assert.match(radioHostLabel?.className ?? "", /absolute inset-0/u);

    await clickControlContaining(rendered, "Continue");
    const toneFieldset = rendered.container.querySelector("fieldset");
    assert.equal(
      toneFieldset?.querySelector("legend")?.textContent?.trim(),
      "Murph tone",
    );
    const toneRadios = Array.from(
      toneFieldset?.querySelectorAll<HTMLInputElement>("input[type='radio']")
        ?? [],
    );
    assert.equal(toneRadios.length, 2);
    assertCardFocusUsesSingleBorder(toneRadios);
    assert.equal(
      toneRadios.find((radio) => radio.checked)?.value,
      "formal",
    );
    assert.match(toneFieldset?.textContent ?? "", /Formal/u);
    assert.match(toneFieldset?.textContent ?? "", /Casual/u);
    assert.doesNotMatch(toneFieldset?.textContent ?? "", /Standard sentence case/u);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker constrains its desktop dialog and left-aligns the subtitle", async () => {
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onOpenChange: vi.fn(),
      open: true,
    }),
    { requireButton: false },
  );

  try {
    const dialog = rendered.container.querySelector<HTMLElement>(
      "[data-dialog-content='true']",
    );
    const step = rendered.container.querySelector<HTMLElement>(
      "[data-persona-picker-step='main']",
    );
    const stepTitle = rendered.container.querySelector<HTMLElement>(
      "[data-persona-picker-step-title]",
    );
    const description = stepTitle?.parentElement?.querySelector("p");
    assert.ok(dialog);
    assert.ok(step);
    assert.ok(description);
    assert.equal(dialog.style.width, "52rem");
    assert.equal(dialog.style.maxWidth, "calc(100vw - 2rem)");
    assert.match(dialog.className, /min-w-0/u);
    assert.match(step.className, /min-w-0/u);
    assert.match(step.className, /overflow-x-hidden/u);
    assert.match(description.className, /text-left/u);
    await clickControlContaining(rendered, "Continue");
    await clickControlContaining(rendered, "Continue");
    await clickControlContaining(rendered, "Continue");
    assert.equal(dialog.style.width, "21rem");
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker restores a saved combination into main and support choices", async () => {
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      initialPersona: "scientist-with-classic",
      onOpenChange: vi.fn(),
      open: true,
    }),
    { requireButton: false },
  );

  try {
    const mainFieldset = rendered.container.querySelector("fieldset");
    const selectedMain = Array.from(
      mainFieldset?.querySelectorAll<HTMLInputElement>("input[type='radio']") ?? [],
    ).find((radio) => radio.checked);
    assert.equal(selectedMain?.value, "scientist");

    await clickControlContaining(rendered, "Continue");
    const supportFieldset = rendered.container.querySelector("fieldset");
    const selectedSupport = Array.from(
      supportFieldset?.querySelectorAll<HTMLInputElement>("input[type='radio']") ?? [],
    ).find((radio) => radio.checked);
    assert.equal(selectedSupport?.value, "classic");
    assert.match(rendered.container.textContent ?? "", /Scientist leads/u);
    assert.match(rendered.container.textContent ?? "", /Supported by Classic/u);

    await clickControlContaining(rendered, "Continue");
    assert.match(rendered.container.textContent ?? "", /Recommended for Scientist/u);
    assert.ok(
      rendered.container.querySelector(
        "[data-voice-preview='/audio/murph-personas/scientist/radio-host.mp3']",
      ),
    );
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker disables dismissal and controls while saving", async () => {
  let resolveSave: ((value: {
    persona: "classic";
    tone: "formal";
    voice: "upbeat";
  }) => void) | undefined;
  const savePreference = vi.fn(
    () => new Promise<{
      persona: "classic";
      tone: "formal";
      voice: "upbeat";
    }>((resolve) => {
      resolveSave = resolve;
    }),
  );
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onComplete,
      onOpenChange,
      open: true,
      savePreference,
    }),
    { requireButton: false },
  );

  try {
    await clickControlContaining(rendered, "Continue");
    await clickControlContaining(rendered, "Continue");
    await clickControlContaining(rendered, "Continue");
    await clickControlContaining(rendered, "Continue");
    assert.equal(savePreference.mock.calls.length, 1);
    assert.ok(
      Array.from(
        rendered.container.querySelectorAll(
          "input[type='radio'], [role='radio']",
        ),
      ).every(
        (control) =>
          control.hasAttribute("disabled")
          || control.getAttribute("aria-disabled") === "true",
      ),
    );
    const backButton = Array.from(rendered.container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("Back"));
    assert.ok(backButton, "Missing Back button");
    assert.equal(backButton.hasAttribute("disabled"), true);
    const savingButton = rendered.container
      .querySelector("[data-icon='inline-start']")
      ?.closest("button");
    assert.ok(savingButton, "Missing saving button");
    assert.equal(savingButton.hasAttribute("disabled"), true);

    const dismiss = rendered.container.querySelector("[data-dialog-dismiss]");
    assert.ok(dismiss instanceof rendered.window.HTMLButtonElement);
    await act(async () => dismiss.click());
    assert.equal(onOpenChange.mock.calls.length, 0);

    assert.ok(resolveSave);
    await act(async () => {
      resolveSave?.({ persona: "classic", tone: "formal", voice: "upbeat" });
    });
    assert.deepEqual(onComplete.mock.calls[0], [
      { persona: "classic", tone: "formal", voice: "upbeat" },
    ]);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker retains choices after an error and retries them", async () => {
  const saved = {
    persona: "navy-seal" as const,
    tone: "formal" as const,
    voice: "drill-sergeant" as const,
  };
  const savePreference = vi.fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(saved);
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onComplete,
      onOpenChange,
      open: true,
      savePreference,
    }),
    { requireButton: false },
  );

  try {
    await clickControlContaining(rendered, "Navy SEAL");
    await clickControlContaining(rendered, "Continue");
    await clickControlContaining(rendered, "Continue");
    await clickControlContaining(rendered, "Continue");
    await clickControlContaining(rendered, "Continue");

    assert.match(
      rendered.container.querySelector("[role='alert']")?.textContent ?? "",
      /choices are still here/iu,
    );
    assert.equal(onComplete.mock.calls.length, 0);
    assert.equal(onOpenChange.mock.calls.length, 0);
    await clickControlContaining(rendered, "Continue");
    assert.deepEqual(savePreference.mock.calls, [[saved], [saved]]);
    assert.deepEqual(onComplete.mock.calls[0], [saved]);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

function assertCardFocusUsesSingleBorder(
  radios: readonly HTMLInputElement[],
): void {
  for (const radio of radios) {
    const card = radio.parentElement;
    const label = radio.ownerDocument.querySelector(
      `label[for='${radio.id}']`,
    );
    assert.match(card?.className ?? "", /has-\[:focus-visible\]:border-primary/u);
    assert.match(card?.className ?? "", /has-\[:focus-visible\]:border-2/u);
    assert.doesNotMatch(
      label?.className ?? "",
      /peer-focus-visible:(?:outline|ring)/u,
    );
  }
}

async function clickControlContaining(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  text: string,
): Promise<void> {
  const control = Array.from(
    rendered.container.querySelectorAll("button, label"),
  ).find((candidate) => candidate.textContent?.includes(text));
  assert.ok(control, `Missing control containing ${text}`);
  await act(async () => {
    const radioButton = control.querySelector("[role='radio']");
    if (radioButton) {
      (radioButton as HTMLElement).click();
      return;
    }
    const associatedInput =
      control instanceof rendered.window.HTMLLabelElement && control.htmlFor
        ? control.ownerDocument.getElementById(control.htmlFor)
        : null;
    const input =
      control.querySelector("input[type='radio'], input[type='checkbox']")
      ?? associatedInput;
    if (input instanceof rendered.window.HTMLInputElement) {
      input.click();
      return;
    }
    (control as HTMLElement).click();
  });
}
