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
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? createElement("div", { "data-dialog-open": "true" }, children) : null,
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
    await clickContaining(rendered, "Navy SEAL");
    await clickContaining(rendered, "Lowercase");

    const preview = rendered.container.querySelector(
      "[data-voice-preview='/audio/murph-personas/navy-seal/drill-sergeant.mp3']",
    );
    assert.ok(preview);
    assert.equal(
      preview.getAttribute("data-fallback-preview"),
      "/audio/murph-voices/drill-sergeant.mp3",
    );
    assert.equal(preview.getAttribute("data-preload"), "metadata");

    await clickContaining(rendered, "Continue with Navy SEAL");

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
    await clickContaining(rendered, "Skip");
    assert.equal(fetchMock.mock.calls.length, 0);
    assert.equal(onComplete.mock.calls.length, 1);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

async function clickContaining(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  text: string,
): Promise<void> {
  const button = Array.from(rendered.container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  assert.ok(button, `Missing button containing ${text}`);
  await act(async () => {
    button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
}
