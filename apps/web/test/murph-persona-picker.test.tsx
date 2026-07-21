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
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { className, "data-dialog-content": "true" }, children),
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

test("MurphPersonaPicker saves persona, writing style, and voice atomically", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      assistantPersona: "navy-seal",
      assistantTone: "casual",
      assistantVoice: "drill-sergeant",
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
    await clickControlContaining(rendered, "Navy SEAL");
    await clickControlContaining(rendered, "Lowercase");

    const preview = rendered.container.querySelector(
      "[data-voice-preview='/audio/murph-personas/navy-seal/drill-sergeant.mp3']",
    );
    assert.ok(preview);
    assert.equal(
      preview.getAttribute("data-fallback-preview"),
      "/audio/murph-voices/drill-sergeant.mp3",
    );
    assert.equal(preview.getAttribute("data-preload"), "metadata");

    await clickControlContaining(rendered, "Continue");

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(fetchMock.mock.calls[0]?.[0], "/api/settings/assistant-style");
    assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), {
      persona: "navy-seal",
      tone: "casual",
      voice: "drill-sergeant",
    });
    assert.equal(onComplete.mock.calls.length, 1);
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

test("MurphPersonaPicker exposes independent native radio groups", async () => {
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
    const fieldsets = Array.from(rendered.container.querySelectorAll("fieldset"));
    assert.deepEqual(
      fieldsets.map((fieldset) =>
        fieldset.querySelector("legend")?.textContent?.trim()
      ),
      ["Murph persona", "Text style", "Voice"],
    );

    const names = fieldsets.map((fieldset) => {
      const radios = Array.from(
        fieldset.querySelectorAll<HTMLInputElement>("input[type='radio']"),
      );
      assert.equal(radios.filter((radio) => radio.checked).length, 1);
      assert.ok(radios.length > 1);
      assert.equal(new Set(radios.map((radio) => radio.name)).size, 1);
      return radios[0]?.name;
    });
    assert.equal(new Set(names).size, 3);
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
    assert.equal(savePreference.mock.calls.length, 1);
    assert.ok(
      Array.from(rendered.container.querySelectorAll("input[type='radio']"))
        .every((radio) => (radio as HTMLInputElement).disabled),
    );
    const skipButton = Array.from(rendered.container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("Skip"));
    assert.ok(skipButton, "Missing Skip button");
    assert.equal(skipButton.hasAttribute("disabled"), true);
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
    tone: "casual" as const,
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
    await clickControlContaining(rendered, "Lowercase");
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

async function clickControlContaining(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  text: string,
): Promise<void> {
  const control = Array.from(
    rendered.container.querySelectorAll("button, label"),
  ).find((candidate) => candidate.textContent?.includes(text));
  assert.ok(control, `Missing control containing ${text}`);
  await act(async () => {
    const input = control.querySelector("input[type='radio']");
    if (input instanceof rendered.window.HTMLInputElement) {
      input.checked = true;
      input.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      return;
    }
    (control as HTMLElement).click();
  });
}
