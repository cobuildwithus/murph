import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { CustomizeMurphSettings } from "@/src/components/settings/customize-murph-settings";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import { renderClientComponent } from "./render-client-component";

vi.mock("@/src/components/murph/murph-assistant-style-picker", () => ({
  MurphAssistantStylePicker(props: {
    initialStep?: string;
    onOpenChange?: (open: boolean) => void;
    onSaved?: (preferences: { tone: string | null; voice: string | null }) => void;
    open?: boolean;
    singleStep?: boolean;
  }) {
    return props.open
      ? React.createElement("div", {
          "data-assistant-style-step": props.initialStep ?? "",
          "data-single-step": props.singleStep ? "true" : "false",
        },
        `assistant style ${props.initialStep ?? ""}`,
        React.createElement("button", {
          "data-save-assistant-style": "true",
          onClick: () => {
            props.onSaved?.({ tone: null, voice: "upbeat" });
            props.onOpenChange?.(false);
          },
          type: "button",
        }, "Save"),
        React.createElement("button", {
          "data-close-assistant-style": "true",
          onClick: () => props.onOpenChange?.(false),
          type: "button",
        }, "Close"))
      : null;
  },
}));

vi.mock("@/src/components/murph/murph-contact-card-picker", () => ({
  MurphContactCardPicker(props: { open?: boolean }) {
    return props.open
      ? React.createElement("div", { "data-contact-card-picker": "true" }, "contact card picker")
      : null;
  },
}));

// Stub the editor but keep the real summary resolver so the row still shows the
// effective, default-resolved dials.
vi.mock("@/src/components/settings/murph-personality-settings-dialog", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/components/settings/murph-personality-settings-dialog")
  >("@/src/components/settings/murph-personality-settings-dialog");
  return {
    ...actual,
    MurphPersonalitySettingsDialog(props: {
      onOpenChange?: (open: boolean) => void;
      onSaved?: (snapshot: { detail: number | null; humor: number | null; push: number | null }) => void;
      open?: boolean;
    }) {
      return props.open
        ? React.createElement(
            "div",
            { "data-personality-dialog": "true" },
            "personality dialog",
            React.createElement("button", {
              "data-save-personality": "true",
              onClick: () => {
                props.onSaved?.({ detail: 5, humor: 7, push: 3 });
                props.onOpenChange?.(false);
              },
              type: "button",
            }, "Save changes"),
            React.createElement("button", {
              "data-close-personality": "true",
              onClick: () => props.onOpenChange?.(false),
              type: "button",
            }, "Close"))
        : null;
    },
  };
});

describe("CustomizeMurphSettings", () => {
  test("shows the saved tone and voice with their own actions", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, {
        assistant: { tone: "formal", voice: "grandpa" },
      }),
    );

    expect(markup).toContain("How Murph talks");
    expect(markup).toContain("Formal");
    expect(markup).toContain("Voice");
    expect(markup).toContain("Grandpa");
    expect(markup).toContain("Customize");
    expect(markup).toContain("Change");
  });

  test("falls back to the default tone and voice labels", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, { assistant: null }),
    );

    expect(markup).toContain("Default");
    expect(markup).toContain("Classic Murph");
  });

  test("summarizes the effective personality dials in its own row", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, {
        assistant: { tone: null, voice: null, personality: { humor: 9, push: null, detail: null } },
      }),
    );

    expect(markup).toContain("Personality");
    expect(markup).toContain("Humor 9");
    expect(markup).toContain("Push 3");
    expect(markup).toContain("Detail 5");
  });

  test("never surfaces the conversational-only Unhinged dial in the summary", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, {
        assistant: {
          tone: null,
          voice: null,
          // A hostile/legacy payload carrying an unhinged score must not leak it.
          personality: {
            humor: 4,
            push: null,
            detail: null,
            unhinged: 9,
          } as never,
        },
      }),
    );

    expect(markup).toContain("Humor 4 · Push 3 · Detail 5");
    expect(markup).not.toContain("Unhinged");
  });

  test("keeps the customization rows in their intended order", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        murphPhoneNumber: "+15550100001",
      }),
    );

    const labels = ["How Murph talks", "Personality", "Voice", "Contact card"];
    const positions = labels.map((label) => markup.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  test("resolves the default personality summary when no dials are stored", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, { assistant: null }),
    );

    expect(markup).toContain("Humor 3");
    expect(markup).toContain("Push 3");
    expect(markup).toContain("Detail 5");
  });

  test("opens the personality editor from its row", async () => {
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, { assistant: null }),
      { requireButton: false },
    );

    const personalityRow = findSettingsRow(rendered.container, "Personality");
    await React.act(async () => {
      personalityRow?.querySelector("button")?.click();
    });

    expect(rendered.container.querySelector("[data-personality-dialog]")).not.toBeNull();

    await rendered.cleanup();
  });

  test("updates the row and preserves tone and voice after a personality save", async () => {
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, {
        assistant: { tone: "formal", voice: "grandpa", personality: null },
        voiceTestContactOption: makeVoiceTestOption(),
      }),
      { requireButton: false },
    );

    const personalityRow = findSettingsRow(rendered.container, "Personality");
    await React.act(async () => {
      personalityRow?.querySelector("button")?.click();
    });

    const saveButton = rendered.container.querySelector("[data-save-personality]");
    expect(saveButton).toBeInstanceOf(rendered.window.HTMLButtonElement);
    await React.act(async () => {
      (saveButton as HTMLButtonElement | null)?.click();
    });

    // The authoritative snapshot updates the row.
    expect(rendered.container.textContent).toContain("Humor 7");
    expect(rendered.container.textContent).toContain("Detail 5");
    // Tone and voice are untouched by a personality save.
    expect(rendered.container.textContent).toContain("Formal");
    expect(rendered.container.textContent).toContain("Grandpa");
    // A personality save never triggers the voice chat handoff.
    expect(rendered.assign).not.toHaveBeenCalled();

    await rendered.cleanup();
  });

  test("preserves personality after a tone or voice save", async () => {
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, {
        assistant: {
          tone: "formal",
          voice: "grandpa",
          personality: { detail: 8, humor: 9, push: 1 },
        },
      }),
      { requireButton: false },
    );

    const voiceRow = findSettingsRow(rendered.container, "Voice");
    await React.act(async () => {
      voiceRow?.querySelector("button")?.click();
    });
    await React.act(async () => {
      rendered.container.querySelector<HTMLButtonElement>(
        "[data-save-assistant-style]",
      )?.click();
    });

    expect(rendered.container.textContent).toContain("Humor 9");
    expect(rendered.container.textContent).toContain("Push 1");
    expect(rendered.container.textContent).toContain("Detail 8");

    await rendered.cleanup();
  });

  test("shows contact card customization only with a Murph text line", () => {
    const withLine = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        murphPhoneNumber: "+15550100001",
      }),
    );
    const withoutLine = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        murphPhoneNumber: null,
      }),
    );

    expect(withLine).toContain("Contact card");
    expect(withoutLine).not.toContain("Contact card");
  });

  test("opens the voice picker as a single step when the voice deep link is present", async () => {
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        openVoiceLink: true,
      }),
      {
        location: {
          href: "https://app.example.test/settings?voice=true&tab=account",
        },
        requireButton: false,
      },
    );

    const picker = rendered.container.querySelector("[data-assistant-style-step]");
    expect(picker?.getAttribute("data-assistant-style-step")).toBe("voice");
    expect(picker?.getAttribute("data-single-step")).toBe("true");
    expect(rendered.replaceState).toHaveBeenCalledWith({}, "", "/settings?tab=account");

    await rendered.cleanup();
  });

  test("opens the voice picker when the voice deep link appears after mount", async () => {
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        openVoiceLink: false,
      }),
      {
        location: {
          href: "https://app.example.test/settings?voice=true",
        },
        requireButton: false,
      },
    );

    expect(rendered.container.querySelector("[data-assistant-style-step]")).toBeNull();

    await rendered.rerender(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        openVoiceLink: true,
      }),
    );

    expect(
      rendered.container.querySelector("[data-assistant-style-step]")?.getAttribute("data-assistant-style-step"),
    ).toBe("voice");
    expect(rendered.replaceState).toHaveBeenCalledWith({}, "", "/settings");

    await rendered.cleanup();
  });

  test("opens the voice and contact-card pickers from their settings rows", async () => {
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        murphPhoneNumber: "+15550100001",
      }),
      {
        requireButton: false,
      },
    );

    const voiceRow = findSettingsRow(rendered.container, "Voice");
    await React.act(async () => {
      voiceRow?.querySelector("button")?.click();
    });
    expect(
      rendered.container.querySelector("[data-assistant-style-step]")?.getAttribute(
        "data-assistant-style-step",
      ),
    ).toBe("voice");

    await React.act(async () => {
      rendered.container.querySelector<HTMLButtonElement>(
        "[data-close-assistant-style]",
      )?.click();
    });

    const contactRow = findSettingsRow(rendered.container, "Contact card");
    await React.act(async () => {
      contactRow?.querySelector("button")?.click();
    });
    expect(rendered.container.querySelector("[data-contact-card-picker]"))
      .not.toBeNull();

    await rendered.cleanup();
  });

  test("sends the member into the Murph chat after saving a new voice", async () => {
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        openVoiceLink: true,
        voiceTestContactOption: makeVoiceTestOption(),
      }),
      {
        location: {
          href: "https://app.example.test/settings?voice=true",
        },
        requireButton: false,
      },
    );

    const saveButton = rendered.container.querySelector("[data-save-assistant-style]");
    expect(saveButton).toBeInstanceOf(rendered.window.HTMLButtonElement);
    await React.act(async () => {
      (saveButton as HTMLButtonElement | null)?.click();
    });

    expect(rendered.assign).toHaveBeenCalledWith(
      "sms:+15550100001?body=voice%20test",
    );

    await rendered.cleanup();
  });

  test("does not redirect when the picker closes without a voice save", async () => {
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        openVoiceLink: true,
        voiceTestContactOption: makeVoiceTestOption(),
      }),
      {
        location: {
          href: "https://app.example.test/settings?voice=true",
        },
        requireButton: false,
      },
    );

    const closeButton = rendered.container.querySelector("[data-close-assistant-style]");
    expect(closeButton).toBeInstanceOf(rendered.window.HTMLButtonElement);
    await React.act(async () => {
      (closeButton as HTMLButtonElement | null)?.click();
    });

    expect(rendered.assign).not.toHaveBeenCalled();
    expect(rendered.container.querySelector("[data-assistant-style-step]")).toBeNull();

    await rendered.cleanup();
  });

  test("does not redirect after saving a tone", async () => {
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, {
        assistant: null,
        voiceTestContactOption: makeVoiceTestOption(),
      }),
      {
        requireButton: false,
      },
    );

    const toneButton = Array.from(rendered.container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Customize",
    );
    expect(toneButton).toBeInstanceOf(rendered.window.HTMLButtonElement);
    await React.act(async () => {
      (toneButton as HTMLButtonElement | undefined)?.click();
    });

    expect(
      rendered.container.querySelector("[data-assistant-style-step]")?.getAttribute("data-assistant-style-step"),
    ).toBe("tone");

    const saveButton = rendered.container.querySelector("[data-save-assistant-style]");
    await React.act(async () => {
      (saveButton as HTMLButtonElement | null)?.click();
    });

    expect(rendered.assign).not.toHaveBeenCalled();

    await rendered.cleanup();
  });
});

function makeVoiceTestOption(): MurphContactOption {
  return {
    href: "sms:+15550100001?body=voice%20test",
    kind: "text",
    label: "Messages",
  };
}

function findSettingsRow(container: Element, label: string): HTMLElement | null {
  const labelElement = Array.from(container.querySelectorAll("span")).find(
    (candidate) => candidate.textContent === label,
  );
  return labelElement?.parentElement?.parentElement ?? null;
}
