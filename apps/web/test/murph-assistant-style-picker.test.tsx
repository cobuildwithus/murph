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
    assert.match(
      rendered.container.querySelector("[data-dialog-content='true']")?.className ?? "",
      /sm:max-w-xl/u,
    );
    assert.match(
      rendered.container.querySelector("[role='radiogroup'][aria-label='Murph tone']")?.className ?? "",
      /sm:grid-cols-2/u,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker keeps the default tone to voice onboarding chain", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      assistantTone: "casual",
      assistantVoice: null,
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphAssistantStylePicker } = await import(
    "@/src/components/murph/murph-assistant-style-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      initialStep: "tone",
      onComplete,
      onOpenChange,
      open: true,
    }),
    {
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered, "Continue");

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Pick Murph's voice/u);
    assert.match(rendered.container.textContent ?? "", /22 voices/u);
    assert.equal(onComplete.mock.calls.length, 0);
    assert.equal(onOpenChange.mock.calls.length, 0);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker ignores dismissal while a save is in flight", async () => {
  let resolveSave: (() => void) | null = null;
  const fetchMock = vi.fn(
    () =>
      new Promise((resolve) => {
        resolveSave = () =>
          resolve({
            ok: true,
            json: async () => ({
              assistantTone: "casual",
              assistantVoice: null,
            }),
          });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphAssistantStylePicker } = await import(
    "@/src/components/murph/murph-assistant-style-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      initialStep: "tone",
      onComplete,
      onOpenChange,
      open: true,
      singleStep: true,
    }),
    {
      requireButton: false,
    },
  );

  try {
    await clickButton(rendered, "Save");
    assert.equal(fetchMock.mock.calls.length, 1);

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
    assert.equal(onComplete.mock.calls.length, 1);
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphAssistantStylePicker saves and closes without advancing in single-step mode", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      assistantTone: "casual",
      assistantVoice: null,
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphAssistantStylePicker } = await import(
    "@/src/components/murph/murph-assistant-style-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphAssistantStylePicker, {
      initialStep: "tone",
      onComplete,
      onOpenChange,
      open: true,
      singleStep: true,
    }),
    {
      requireButton: false,
    },
  );

  try {
    // Single-step mode relabels the actions as Cancel/Save.
    assert.equal(findButton(rendered.container, "Continue"), null);
    assert.ok(findButton(rendered.container, "Cancel"));
    await clickButton(rendered, "Save");

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(onComplete.mock.calls.length, 1);
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);
    assert.doesNotMatch(rendered.container.textContent ?? "", /22 voices/u);
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
    assert.match(
      rendered.container.textContent ?? "",
      /The original\. How Murph usually sounds\./u,
    );
    assert.match(
      rendered.container.querySelector("[data-dialog-content='true']")?.className ?? "",
      /sm:max-w-2xl/u,
    );
    assert.match(
      rendered.container.querySelector("[data-dialog-content='true']")?.className ?? "",
      /lg:max-w-3xl/u,
    );

    const voiceGrid = rendered.container.querySelector(
      "[role='radiogroup'][aria-label='Murph voice']",
    );
    assert.match(voiceGrid?.className ?? "", /grid-cols-2/u);
    assert.match(voiceGrid?.className ?? "", /md:grid-cols-3/u);
    assert.match(voiceGrid?.className ?? "", /overflow-y-auto/u);

    const grandpaRow = findRadioInput(rendered.container, "Grandpa")?.closest("div");
    assert.ok(grandpaRow, "Missing grandpa row");
    await act(async () => {
      grandpaRow.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });

    assert.equal(findRadioInput(rendered.container, "Grandpa")?.checked, true);
    assert.equal(findRadioInput(rendered.container, "Classic Murph")?.checked, false);
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
    const drawerContent = rendered.container.querySelector("[data-drawer-content='true']");
    assert.match(drawerContent?.className ?? "", /h-dvh/u);
    assert.match(
      drawerContent?.className ?? "",
      /data-\[vaul-drawer-direction=bottom\]:max-h-dvh/u,
    );
    assert.match(
      drawerContent?.className ?? "",
      /data-\[vaul-drawer-direction=bottom\]:mt-0/u,
    );
    assert.ok(findRadioInput(rendered.container, "Classic Murph"));
    assert.ok(findRadioInput(rendered.container, "Warm and friendly"));
    assert.ok(
      rendered.container.querySelector(
        "[data-voice-preview='/audio/murph-voices/classic.mp3']",
      ),
    );
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
