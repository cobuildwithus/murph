import assert from "node:assert/strict";

import { act, createElement, type HTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const componentMocks = vi.hoisted(() => ({
  useIsMobile: vi.fn(() => false),
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => open ? createElement("div", { "data-dialog-open": "true" }, children) : null,
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
  VoiceMemoPlayer({ src }: { src: string }) {
    return createElement("div", { "data-voice-preview": src });
  },
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: componentMocks.useIsMobile,
}));

beforeEach(() => {
  componentMocks.useIsMobile.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("MurphAssistantStylePicker filters voice rows without clearing the selected hidden voice", async () => {
  const { MurphAssistantStylePicker } = await import(
    "@/src/components/murph/murph-assistant-style-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      initialStep: "voice",
      initialVoice: "drill-sergeant",
      onOpenChange: () => {},
      open: true,
    }),
    {
      requireButton: false,
    },
  );

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

  const { MurphAssistantStylePicker } = await import(
    "@/src/components/murph/murph-assistant-style-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      initialStep: "voice",
      initialVoice: "classic",
      onOpenChange: () => {},
      open: true,
    }),
    {
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered, "Female");
    await clickButton(rendered, "Continue");

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

  const { MurphAssistantStylePicker } = await import(
    "@/src/components/murph/murph-assistant-style-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      initialStep: "voice",
      onOpenChange: () => {},
      open: true,
    }),
    {
      requireButton: false,
    },
  );

  try {
    assert.equal(
      findRadioInput(rendered.container, "Classic Murph")?.checked,
      true,
    );

    await clickButton(rendered, "Continue");

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
  const { MurphAssistantStylePicker } = await import(
    "@/src/components/murph/murph-assistant-style-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      initialStep: "tone",
      onOpenChange: () => {},
      open: true,
    }),
    {
      requireButton: false,
    },
  );

  try {
    const text = rendered.container.textContent ?? "";
    assert.match(text, /you're up 3 lbs this week/u);
    assert.match(text, /You are up 3 pounds this week/u);
    // Casual is preselected, matching today's default persona.
    assert.equal(findRadioInput(rendered.container, "Casual")?.checked, true);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker selects a voice when the row outside the label is clicked", async () => {
  const { MurphAssistantStylePicker } = await import(
    "@/src/components/murph/murph-assistant-style-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      initialStep: "voice",
      initialVoice: "classic",
      onOpenChange: () => {},
      open: true,
    }),
    {
      requireButton: false,
    },
  );

  try {
    assert.match(rendered.container.textContent ?? "", /22 voices/u);

    const grandpaRow = findRadioInput(rendered.container, "Grandpa")?.closest("div");
    assert.ok(grandpaRow, "Missing grandpa row");
    await act(async () => {
      grandpaRow.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(findRadioInput(rendered.container, "Grandpa")?.checked, true);
    assert.equal(findRadioInput(rendered.container, "New York")?.checked, false);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker renders the voice chooser in the mobile drawer", async () => {
  componentMocks.useIsMobile.mockReturnValue(true);

  const { MurphAssistantStylePicker } = await import(
    "@/src/components/murph/murph-assistant-style-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      initialStep: "voice",
      initialVoice: "classic",
      onOpenChange: () => {},
      open: true,
    }),
    {
      requireButton: false,
    },
  );

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
    assert.ok(findRadioInput(rendered.container, "Warm and friendly"));
    assert.match(rendered.container.textContent ?? "", /22 voices/u);
    assert.ok(findButton(rendered.container, "Skip"));
    assert.ok(findButton(rendered.container, "Continue"));
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
