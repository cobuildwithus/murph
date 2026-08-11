import assert from "node:assert/strict";

import { act, createElement, type HTMLAttributes, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";

import type { AssistantPersonalitySnapshot } from "@/src/components/settings/murph-personality-settings-dialog";

import { renderClientComponent } from "./render-client-component";

const componentMocks = vi.hoisted(() => ({
  useIsMobile: vi.fn(() => false),
}));

// Base UI's Slider needs real layout APIs to drive interactively, which the
// linkedom test DOM lacks. This faithful stand-in reflects the value and aria
// contract the dialog wires up and exposes each dial's onValueChange so a test
// can simulate a move. The real Slider's single-thumb/aria output is asserted
// separately via vi.importActual below.
const sliderMock = vi.hoisted(() => ({
  changers: new Map<string, (value: number) => void>(),
}));

vi.mock("@/src/components/ui/slider", () => ({
  Slider: ({
    value,
    min,
    max,
    step,
    disabled,
    onValueChange,
    getAriaValueText,
    thumbClassName,
    "aria-describedby": ariaDescribedBy,
    "aria-labelledby": ariaLabelledBy,
    children,
  }: {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    onValueChange?: (value: number, details: { reason: string }) => void;
    getAriaValueText?: (formatted: string, value: number, index: number) => string;
    thumbClassName?: string;
    "aria-describedby"?: string;
    "aria-labelledby"?: string;
    children?: ReactNode;
  }) => {
    if (ariaLabelledBy && onValueChange) {
      sliderMock.changers.set(ariaLabelledBy, (next: number) =>
        onValueChange(next, { reason: "keyboard" }),
      );
    }
    const valueText =
      typeof getAriaValueText === "function" && typeof value === "number"
        ? getAriaValueText(String(value), value, 0)
        : undefined;
    return createElement(
      "div",
      { "data-slot": "slider" },
      createElement("input", {
        "aria-describedby": ariaDescribedBy,
        "aria-labelledby": ariaLabelledBy,
        "aria-valuenow": value,
        "aria-valuetext": valueText,
        "data-slot": "slider-thumb",
        "data-thumb-class-name": thumbClassName,
        disabled: disabled || undefined,
        max,
        min,
        readOnly: true,
        step,
        type: "range",
        value,
      }),
      children,
    );
  },
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
  DialogHeader: (props: HTMLAttributes<HTMLDivElement>) => createElement("div", props),
  DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) => createElement("h2", props),
}));

vi.mock("@/src/components/ui/drawer", () => ({
  Drawer: ({
    children,
    onOpenChange,
    open,
  }: {
    children?: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open
      ? createElement(
          "div",
          { "data-drawer-open": "true" },
          createElement(
            "button",
            {
              "data-drawer-dismiss": "true",
              onClick: () => onOpenChange?.(false),
              type: "button",
            },
            "Dismiss",
          ),
          children,
        )
      : null,
  DrawerContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { className, "data-drawer-content": "true" }, children),
  DrawerDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DrawerFooter: (props: HTMLAttributes<HTMLDivElement>) => createElement("div", props),
  DrawerHeader: (props: HTMLAttributes<HTMLDivElement>) => createElement("div", props),
  DrawerTitle: (props: HTMLAttributes<HTMLHeadingElement>) => createElement("h2", props),
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: componentMocks.useIsMobile,
}));

beforeEach(() => {
  componentMocks.useIsMobile.mockReturnValue(false);
  sliderMock.changers.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SAVE_ERROR = "Could not confirm the save. Your draft is still here. Try again.";

test("resolves null dials to the shared defaults and starts with save disabled", async () => {
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange: () => {},
      open: true,
      personality: null,
    }),
    { requireButton: false },
  );

  try {
    assert.match(rendered.container.textContent ?? "", /Tune Murph's personality/u);
    // Humor 3, Push 3, Detail 5 defaults.
    assert.equal(readDialValue(rendered.container, "Humor"), "3");
    assert.equal(readDialValue(rendered.container, "Push"), "3");
    assert.equal(readDialValue(rendered.container, "Detail"), "5");
    assert.equal(
      findDialInput(rendered.container, "Humor")?.getAttribute("aria-valuetext"),
      "3 of 10",
    );
    assert.equal(
      findDialInput(rendered.container, "Detail")?.getAttribute("aria-valuetext"),
      "5 of 10",
    );
    const humorDescriptionIds = findDialInput(rendered.container, "Humor")
      ?.getAttribute("aria-describedby")
      ?.split(" ");
    assert.equal(humorDescriptionIds?.length, 2);
    assert.equal(
      rendered.container.querySelector(`#${humorDescriptionIds?.[0]}`)?.textContent,
      "How often Murph reaches for a joke.",
    );
    assert.equal(
      rendered.container.querySelector(`#${humorDescriptionIds?.[1]}`)?.textContent,
      "Straight-facedMaximum humor",
    );
    assert.match(rendered.container.textContent ?? "", /3 \/ 10/u);
    assert.match(rendered.container.textContent ?? "", /5 \/ 10/u);
    for (const slider of rendered.container.querySelectorAll("[data-slot='slider']")) {
      assert.equal(
        slider.querySelectorAll("[aria-hidden='true'] > span").length,
        11,
      );
      assert.match(
        slider.querySelector("[data-slot='slider-thumb']")?.getAttribute(
          "data-thumb-class-name",
        ) ?? "",
        /\bsize-6\b.*\bafter:-inset-2\.5\b/u,
      );
    }
    // A clean editor cannot be saved.
    assert.equal(findButton(rendered.container, "Save changes")?.disabled, true);
  } finally {
    await rendered.cleanup();
  }
});

test("resolves partial dials, keeping the stored value and defaulting the rest", async () => {
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange: () => {},
      open: true,
      personality: { humor: 9, push: null, detail: null },
    }),
    { requireButton: false },
  );

  try {
    assert.equal(readDialValue(rendered.container, "Humor"), "9");
    assert.equal(readDialValue(rendered.container, "Push"), "3");
    assert.equal(readDialValue(rendered.container, "Detail"), "5");
  } finally {
    await rendered.cleanup();
  }
});

test("resolves untouched dials from the selected main personality", async () => {
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange: () => {},
      open: true,
      persona: "navy-seal",
      personality: { humor: null, push: null, detail: null },
    }),
    { requireButton: false },
  );

  try {
    assert.equal(readDialValue(rendered.container, "Humor"), "1");
    assert.equal(readDialValue(rendered.container, "Push"), "10");
    assert.equal(readDialValue(rendered.container, "Detail"), "2");
    assert.equal(findButton(rendered.container, "Save changes")?.disabled, true);
  } finally {
    await rendered.cleanup();
  }
});

test("the real Slider renders one accessible thumb with a value text", async () => {
  const actual = await vi.importActual<typeof import("@/src/components/ui/slider")>(
    "@/src/components/ui/slider",
  );
  const html = renderToStaticMarkup(
    createElement(actual.Slider, {
      "aria-describedby": "humor-description humor-endpoints",
      "aria-labelledby": "humor-label",
      getAriaValueText: (_formatted: string, value: number) => `${value} of 10`,
      max: 10,
      min: 0,
      step: 1,
      value: 5,
    } as never),
  );

  assert.equal((html.match(/data-slot="slider-thumb"/gu) ?? []).length, 1);
  assert.equal((html.match(/<input\b/gu) ?? []).length, 1);
  assert.match(html, /type="range"/u);
  assert.match(html, /aria-valuetext="5 of 10"/u);
  assert.match(html, /aria-valuenow="5"/u);
  assert.match(html, /aria-describedby="humor-description humor-endpoints"/u);
  assert.match(html, /aria-labelledby="humor-label"/u);
  assert.match(html, /min="0"/u);
  assert.match(html, /max="10"/u);
  assert.match(html, /step="1"/u);
});

test("submits only the single dial that changed", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({ assistantPersonality: { humor: 7, push: 3, detail: 5 } }),
    init,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange,
      onSaved,
      open: true,
      personality: null,
    }),
    { requireButton: false },
  );

  try {
    await driveDial(rendered, "Humor", 7);
    assert.equal(findButton(rendered.container, "Save changes")?.disabled, false);
    await clickButton(rendered, "Save changes");

    assert.equal(fetchMock.mock.calls.length, 1);
    const init = fetchMock.mock.calls[0]?.[1];
    assert.deepEqual(JSON.parse(String(init?.body)), { personality: { humor: 7 } });
    assert.deepEqual(onSaved.mock.calls[0]?.[0], { detail: 5, humor: 7, push: 3 });
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);
  } finally {
    await rendered.cleanup();
  }
});

test("submits every changed dial and never the untouched defaults", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({ assistantPersonality: { humor: 7, push: 3, detail: 8 } }),
    init,
  }));
  vi.stubGlobal("fetch", fetchMock);

  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange: () => {},
      open: true,
      personality: null,
    }),
    { requireButton: false },
  );

  try {
    await driveDial(rendered, "Humor", 7);
    await driveDial(rendered, "Detail", 8);
    await clickButton(rendered, "Save changes");

    assert.equal(fetchMock.mock.calls.length, 1);
    const init = fetchMock.mock.calls[0]?.[1];
    assert.deepEqual(JSON.parse(String(init?.body)), {
      personality: { detail: 8, humor: 7 },
    });
  } finally {
    await rendered.cleanup();
  }
});

test("returning a touched dial to its projected value still reasserts that intent", async () => {
  const savePersonality = vi.fn(async () => ({ detail: 5, humor: 3, push: 3 }));
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange: () => {},
      open: true,
      personality: null,
      savePersonality,
    }),
    { requireButton: false },
  );

  try {
    await driveDial(rendered, "Humor", 7);
    assert.equal(findButton(rendered.container, "Save changes")?.disabled, false);

    await driveDial(rendered, "Humor", 3);
    assert.equal(findButton(rendered.container, "Save changes")?.disabled, false);
    await clickButton(rendered, "Save changes");
    assert.deepEqual(savePersonality.mock.calls, [[{ humor: 3 }]]);
  } finally {
    await rendered.cleanup();
  }
});

test("freezes controls and blocks dismissal while a save is in flight", async () => {
  let resolveSave: ((snapshot: AssistantPersonalitySnapshot) => void) | null = null;
  const savePersonality = vi.fn(
    () =>
      new Promise<AssistantPersonalitySnapshot>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const onOpenChange = vi.fn();
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange,
      open: true,
      personality: null,
      savePersonality,
    }),
    { requireButton: false },
  );

  try {
    await driveDial(rendered, "Humor", 7);
    await clickButton(rendered, "Save changes");
    assert.equal(savePersonality.mock.calls.length, 1);

    // Every dial and both actions are frozen so what persists cannot diverge
    // from what is shown.
    assert.equal(findDialInput(rendered.container, "Humor")?.disabled, true);
    assert.equal(findDialInput(rendered.container, "Push")?.disabled, true);
    assert.equal(findDialInput(rendered.container, "Detail")?.disabled, true);
    assert.equal(findButton(rendered.container, "Cancel")?.disabled, true);
    assert.equal(findButton(rendered.container, "Save changes")?.disabled, true);

    // Escape/backdrop dismissal must not orphan the in-flight request.
    const dismiss = rendered.container.querySelector("[data-dialog-dismiss]");
    assert.ok(dismiss instanceof rendered.window.HTMLButtonElement);
    await act(async () => {
      dismiss.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(onOpenChange.mock.calls.length, 0);

    await act(async () => {
      resolveSave?.({ detail: 5, humor: 7, push: 3 });
    });
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);
  } finally {
    await rendered.cleanup();
  }
});

test("treats the saved snapshot as authoritative and closes on success", async () => {
  const savePersonality = vi.fn(async () => ({ detail: 5, humor: 7, push: 3 }));
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange,
      onSaved,
      open: true,
      personality: null,
      savePersonality,
    }),
    { requireButton: false },
  );

  try {
    await driveDial(rendered, "Humor", 7);
    await clickButton(rendered, "Save changes");

    assert.deepEqual(onSaved.mock.calls[0]?.[0], { detail: 5, humor: 7, push: 3 });
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);
    // A personality save never triggers the voice chat handoff.
    assert.equal(rendered.assign.mock.calls.length, 0);
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the editor open with the draft and an alert when the save fails", async () => {
  const savePersonality = vi.fn(async () => {
    throw new Error("save failed");
  });
  const onOpenChange = vi.fn();
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange,
      open: true,
      personality: null,
      savePersonality,
    }),
    { requireButton: false },
  );

  try {
    await driveDial(rendered, "Humor", 7);
    await clickButton(rendered, "Save changes");

    assert.equal(onOpenChange.mock.calls.length, 0);
    const alert = rendered.container.querySelector("[role='alert']");
    assert.ok(alert);
    assert.equal(alert.textContent, SAVE_ERROR);
    // The draft is retained and re-editable.
    assert.equal(readDialValue(rendered.container, "Humor"), "7");
    assert.equal(findButton(rendered.container, "Save changes")?.disabled, false);
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the draft open when the server returns a non-OK response", async () => {
  const fetchMock = vi.fn(async () => ({ ok: false }));
  vi.stubGlobal("fetch", fetchMock);

  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange,
      onSaved,
      open: true,
      personality: null,
    }),
    { requireButton: false },
  );

  try {
    await driveDial(rendered, "Humor", 7);
    await clickButton(rendered, "Save changes");

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(onSaved.mock.calls.length, 0);
    assert.equal(onOpenChange.mock.calls.length, 0);
    assert.equal(rendered.container.querySelector("[role='alert']")?.textContent, SAVE_ERROR);
    assert.equal(readDialValue(rendered.container, "Humor"), "7");
  } finally {
    await rendered.cleanup();
  }
});

test("rejects a malformed successful response without discarding the draft", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ assistantPersonality: { humor: 7, push: 3 } }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange,
      onSaved,
      open: true,
      personality: null,
    }),
    { requireButton: false },
  );

  try {
    await driveDial(rendered, "Humor", 7);
    await clickButton(rendered, "Save changes");

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(onSaved.mock.calls.length, 0);
    assert.equal(onOpenChange.mock.calls.length, 0);
    assert.equal(rendered.container.querySelector("[role='alert']")?.textContent, SAVE_ERROR);
    assert.equal(readDialValue(rendered.container, "Humor"), "7");
  } finally {
    await rendered.cleanup();
  }
});

test("renders the dials in the mobile drawer", async () => {
  componentMocks.useIsMobile.mockReturnValue(true);

  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange: () => {},
      open: true,
      personality: null,
    }),
    { requireButton: false },
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
    const description = drawerContent?.querySelector("p");
    assert.match(description?.className ?? "", /text-left/u);
    assert.match(rendered.container.textContent ?? "", /Tune Murph's personality/u);
    assert.ok(findDialInput(rendered.container, "Humor"));
    assert.ok(findDialInput(rendered.container, "Push"));
    assert.ok(findDialInput(rendered.container, "Detail"));
  } finally {
    await rendered.cleanup();
  }
});

test("blocks mobile drawer dismissal while a save is in flight", async () => {
  componentMocks.useIsMobile.mockReturnValue(true);

  let resolveSave: ((snapshot: AssistantPersonalitySnapshot) => void) | null = null;
  const savePersonality = vi.fn(
    () =>
      new Promise<AssistantPersonalitySnapshot>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const onOpenChange = vi.fn();
  const { MurphPersonalitySettingsDialog } = await import(
    "@/src/components/settings/murph-personality-settings-dialog"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonalitySettingsDialog, {
      onOpenChange,
      open: true,
      personality: null,
      savePersonality,
    }),
    { requireButton: false },
  );

  try {
    await driveDial(rendered, "Humor", 7);
    await clickButton(rendered, "Save changes");

    const dismiss = rendered.container.querySelector("[data-drawer-dismiss]");
    assert.ok(dismiss instanceof rendered.window.HTMLButtonElement);
    await act(async () => {
      dismiss.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(onOpenChange.mock.calls.length, 0);

    await act(async () => {
      resolveSave?.({ detail: 5, humor: 7, push: 3 });
    });
    assert.deepEqual(onOpenChange.mock.calls, [[false]]);
  } finally {
    await rendered.cleanup();
  }
});

function labelId(container: Element, label: string): string | undefined {
  const span = Array.from(container.querySelectorAll("span")).find(
    (candidate) => candidate.id !== "" && candidate.textContent === label,
  );
  return span?.id || undefined;
}

function findDialInput(container: Element, label: string): HTMLInputElement | null {
  const id = labelId(container, label);
  if (!id) {
    return null;
  }
  const InputElement = container.ownerDocument.defaultView?.HTMLInputElement;
  const input = container.querySelector(`input[aria-labelledby='${id}']`);
  return InputElement && input instanceof InputElement ? input : null;
}

function readDialValue(container: Element, label: string): string | null | undefined {
  return findDialInput(container, label)?.getAttribute("aria-valuenow");
}

async function driveDial(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  label: string,
  value: number,
) {
  const id = labelId(rendered.container, label);
  assert.ok(id, `Missing dial label: ${label}`);
  const changer = sliderMock.changers.get(id);
  assert.ok(changer, `Missing slider for: ${label}`);
  await act(async () => {
    changer(value);
  });
}

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
