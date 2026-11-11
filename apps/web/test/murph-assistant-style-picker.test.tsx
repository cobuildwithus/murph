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
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => open
    ? createElement(
        "div",
        { "data-dialog-open": "true" },
        createElement("button", {
          "data-dialog-dismiss": "true",
          onClick: () => onOpenChange?.(false),
          type: "button",
        }, "Dismiss"),
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
  Drawer: ({
    children,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => open ? createElement("div", { "data-drawer-open": "true" }, children) : null,
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
    { showDuration?: boolean; src: string }
  >(
    function MockVoiceMemoPlayer({ showDuration, src }, ref) {
      useImperativeHandle(ref, () => ({ play: componentMocks.playerPlay }));
      return createElement("div", {
        "data-show-duration": String(showDuration),
        "data-voice-preview": src,
      });
    },
  ),
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

test("a stalled preference save becomes retryable when its request deadline expires", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  ));
  const onOpenChange = vi.fn();
  const rendered = await renderStylePicker({
    initialTone: "casual",
    onOpenChange,
  });
  try {
    await clickButton(rendered, "Save");
    await act(async () => { deadline.abort(new DOMException("Timed out", "TimeoutError")); });
    assert.match(rendered.container.textContent ?? "", /Could not confirm the save/u);
    assert.equal(findRadioInput(rendered.container, "Casual")?.checked, true);
    assert.equal(findButton(rendered.container, "Save")?.disabled, false);
    await clickButton(rendered, "Cancel");
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);
  } finally {
    timeout.mockRestore();
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker filters voice rows without clearing the selected hidden voice", async () => {
  const rendered = await renderStylePicker({
    initialStep: "voice",
    initialVoice: "drill-sergeant",
  });

  try {
    assert.ok(findRadioInput(rendered.container, "Drill sergeant"));
    assert.ok(findRadioInput(rendered.container, "Warm and friendly"));
    assert.equal(
      findRadioInput(rendered.container, "Drill sergeant")?.checked,
      true,
    );

    await clickButton(rendered, "Female");
    assert.equal(findRadioInput(rendered.container, "Drill sergeant"), null);
    assert.ok(findRadioInput(rendered.container, "Warm and friendly"));
    assert.match(rendered.container.textContent ?? "", /Selected: Drill sergeant/u);

    await clickButton(rendered, "All");
    assert.equal(
      findRadioInput(rendered.container, "Drill sergeant")?.checked,
      true,
    );

    await clickButton(rendered, "Male");
    assert.ok(findRadioInput(rendered.container, "Football announcer"));
    assert.equal(findRadioInput(rendered.container, "Warm and friendly"), null);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker does not persist the display-only voice filter", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      assistantTone: null,
      assistantVoice: "classic",
    }),
    init,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderStylePicker({
    initialStep: "voice",
    initialVoice: "classic",
  });

  try {
    await clickButton(rendered, "Female");
    await clickButton(rendered, "Save");

    assert.equal(fetchMock.mock.calls.length, 1);
    const init = fetchMock.mock.calls[0]?.[1];
    assert.deepEqual(JSON.parse(String(init?.body)), {
      voice: "classic",
    });
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker preselects Classic Murph and persists the upbeat id when no voice is saved", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      assistantTone: null,
      assistantVoice: "upbeat",
    }),
    init,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const rendered = await renderStylePicker({
    initialStep: "voice",
  });

  try {
    assert.equal(
      findRadioInput(rendered.container, "Classic Murph")?.checked,
      true,
    );

    await clickButton(rendered, "Save");

    assert.equal(fetchMock.mock.calls.length, 1);
    const init = fetchMock.mock.calls[0]?.[1];
    assert.deepEqual(JSON.parse(String(init?.body)), {
      voice: "upbeat",
    });
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker shows each tone as a sample message rather than a description", async () => {
  const rendered = await renderStylePicker({
    initialStep: "tone",
  });

  try {
    const text = rendered.container.textContent ?? "";
    assert.match(
      text,
      /Your sleep is down this week\. Want to work on sleep first\?/u,
    );
    assert.match(
      text,
      /sleep is way down this week\. wanna fix sleep first\?/u,
    );
    assert.doesNotMatch(text, /pounds|lbs|weight/iu);
    assert.equal(findRadioInput(rendered.container, "Formal")?.checked, true);
    assert.equal(findRadioInput(rendered.container, "Casual")?.checked, false);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker preserves an explicitly saved casual tone", async () => {
  const savePreference = vi.fn(
    async (preferences: { tone: string } | { voice: string }) => {
      void preferences;
      return {
        tone: "casual" as const,
        voice: null,
      };
    },
  );
  const rendered = await renderStylePicker({
    initialStep: "tone",
    initialTone: "casual",
    savePreference,
  });

  try {
    assert.equal(findRadioInput(rendered.container, "Casual")?.checked, true);
    assert.equal(findRadioInput(rendered.container, "Formal")?.checked, false);

    await clickButton(rendered, "Save");

    assert.deepEqual(savePreference.mock.calls[0]?.[0], { tone: "casual" });
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker freezes controls and ignores dismissal while a save is in flight", async () => {
  let resolveSave: (() => void) | null = null;
  const fetchMock = vi.fn(
    () =>
      new Promise((resolve) => {
        resolveSave = () =>
          resolve({
            ok: true,
            json: async () => ({
              assistantTone: "formal",
              assistantVoice: null,
            }),
          });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const rendered = await renderStylePicker({
    initialStep: "tone",
    onSaved,
    onOpenChange,
  });

  try {
    await clickButton(rendered, "Save");
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(findRadioInput(rendered.container, "Casual")?.disabled, true);
    assert.equal(findRadioInput(rendered.container, "Formal")?.checked, true);

    // Escape/backdrop dismissal while the save is pending must not close the
    // picker and orphan the request's result.
    const dismiss = rendered.container.querySelector("[data-dialog-dismiss]");
    assert.ok(dismiss instanceof rendered.window.HTMLButtonElement);
    await act(async () => {
      dismiss.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(onOpenChange.mock.calls.length, 0);

    await act(async () => {
      resolveSave?.();
    });
    assert.equal(onSaved.mock.calls.length, 1);
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker saves the requested preference and closes", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return {
      ok: true,
      json: async () => ({
        assistantTone: "formal",
        assistantVoice: null,
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const rendered = await renderStylePicker({
    initialStep: "tone",
    onSaved,
    onOpenChange,
  });

  try {
    assert.equal(findButton(rendered.container, "Continue"), null);
    assert.ok(findButton(rendered.container, "Cancel"));
    await clickButton(rendered, "Save");

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), {
      tone: "formal",
    });
    assert.equal(onSaved.mock.calls.length, 1);
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);
    assert.doesNotMatch(rendered.container.textContent ?? "", /22 voices/u);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker selects a voice when the row outside the label is clicked", async () => {
  const rendered = await renderStylePicker({
    initialStep: "voice",
    initialVoice: "classic",
  });

  try {
    assert.doesNotMatch(rendered.container.textContent ?? "", /\b\d+ voices?\b/u);
    const grandpaRow = findRadioInput(rendered.container, "Grandpa")?.closest("div");
    assert.ok(grandpaRow, "Missing grandpa row");
    await act(async () => {
      grandpaRow.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(findRadioInput(rendered.container, "Grandpa")?.checked, true);
    assert.equal(findRadioInput(rendered.container, "New York")?.checked, false);
    assert.equal(componentMocks.playerPlay.mock.calls.length, 1);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker selects a voice when its audio preview is clicked", async () => {
  const rendered = await renderStylePicker({
    initialStep: "voice",
    initialVoice: "classic",
  });

  try {
    const grandpaRow = findRadioInput(rendered.container, "Grandpa")?.closest("div");
    assert.ok(grandpaRow, "Missing grandpa row");
    const preview = grandpaRow.querySelector("[data-voice-preview]");
    assert.ok(preview, "Missing grandpa audio preview");

    await act(async () => {
      preview.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(findRadioInput(rendered.container, "Grandpa")?.checked, true);
    assert.equal(findRadioInput(rendered.container, "New York")?.checked, false);
    assert.equal(componentMocks.playerPlay.mock.calls.length, 0);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker keeps the voice selection frozen when a disabled preview is clicked", async () => {
  let resolveSave: (() => void) | null = null;
  const savePreference = vi.fn(
    () =>
      new Promise<{ tone: null; voice: "classic" }>((resolve) => {
        resolveSave = () => resolve({ tone: null, voice: "classic" });
      }),
  );
  const rendered = await renderStylePicker({
    initialStep: "voice",
    initialVoice: "classic",
    savePreference,
  });

  try {
    await clickButton(rendered, "Save");
    assert.equal(savePreference.mock.calls.length, 1);

    const grandpaInput = findRadioInput(rendered.container, "Grandpa");
    assert.equal(grandpaInput?.disabled, true);
    const grandpaRow = grandpaInput?.closest("div");
    assert.ok(grandpaRow, "Missing grandpa row");
    const preview = grandpaRow.querySelector("[data-voice-preview]");
    assert.ok(preview, "Missing grandpa audio preview");

    await act(async () => {
      preview.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(findRadioInput(rendered.container, "New York")?.checked, true);
    assert.equal(findRadioInput(rendered.container, "Grandpa")?.checked, false);
    assert.equal(componentMocks.playerPlay.mock.calls.length, 0);

    await act(async () => {
      resolveSave?.();
    });
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker renders the voice chooser in the mobile drawer", async () => {
  componentMocks.useIsMobile.mockReturnValue(true);

  const rendered = await renderStylePicker({
    initialStep: "voice",
    initialVoice: "classic",
  });

  try {
    assert.ok(rendered.container.querySelector("[data-drawer-open='true']"));
    assert.equal(rendered.container.querySelector("[data-dialog-open='true']"), null);
    const savedClassicVoice = findRadioInput(rendered.container, "New York");
    assert.equal(savedClassicVoice?.checked, true);
    const savedClassicVoiceRow = savedClassicVoice?.closest("div");
    assert.ok(savedClassicVoiceRow, "Missing saved classic voice row");
    assert.ok(
      savedClassicVoiceRow.querySelector(
        "[data-voice-preview='/audio/murph-voices/classic.mp3']",
      ),
    );
    assert.equal(
      savedClassicVoiceRow
        .querySelector("[data-voice-preview]")
        ?.getAttribute("data-show-duration"),
      "false",
    );
    assert.ok(findRadioInput(rendered.container, "Warm and friendly"));
    assert.doesNotMatch(rendered.container.textContent ?? "", /\b\d+ voices?\b/u);
    assert.ok(findButton(rendered.container, "Cancel"));
    assert.ok(findButton(rendered.container, "Save"));
  } finally {
    await rendered.cleanup();
  }
});

async function clickButton(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  label: string,
) {
  const button = findButton(rendered.container, label);
  assert.ok(button, `Missing button: ${label}`);

  await act(async () => {
    button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
}

function findButton(container: Element, label: string): HTMLButtonElement | null {
  const ButtonElement = container.ownerDocument.defaultView?.HTMLButtonElement;
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  return ButtonElement && button instanceof ButtonElement ? button : null;
}

function findRadioInput(container: Element, label: string): HTMLInputElement | null {
  const InputElement = container.ownerDocument.defaultView?.HTMLInputElement;
  const labelElement = Array.from(container.querySelectorAll("label")).find(
    (candidate) => candidate.textContent?.includes(label) === true,
  );
  if (!labelElement) {
    return null;
  }
  const input = labelElement.querySelector("input[type='radio']");
  if (InputElement && input instanceof InputElement) {
    return input;
  }
  const inputId = labelElement.getAttribute("for");
  if (!inputId) {
    return null;
  }
  const byId = container.ownerDocument.getElementById(inputId);
  return InputElement && byId instanceof InputElement ? byId : null;
}

async function renderStylePicker(
  props: Partial<Parameters<typeof import("@/src/components/murph/murph-assistant-style-picker").MurphAssistantStylePicker>[0]> = {},
) {
  const { MurphAssistantStylePicker } = await import("@/src/components/murph/murph-assistant-style-picker");
  return renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      onOpenChange: () => {},
      open: true,
      ...props,
    }),
    { requireButton: false },
  );
}
