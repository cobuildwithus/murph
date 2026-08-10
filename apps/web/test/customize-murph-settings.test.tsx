import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

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

vi.mock("@/src/components/murph/murph-persona-picker", () => ({
  MurphPersonaPicker(props: {
    initialPersona?: string;
    initialTone?: string | null;
    initialVoice?: string | null;
    mode?: string;
    onOpenChange?: (open: boolean) => void;
    onSaved?: (preferences: {
      persona: string;
      tone: string;
      voice: string;
    }) => void;
    open?: boolean;
    savePreference?: (preferences: {
      persona: string;
      tone: string;
      voice: string;
    }) => Promise<{ persona: string; tone: string; voice: string }>;
  }) {
    if (!props.open) return null;
    return React.createElement(
      "div",
      {
        "data-persona-picker": props.initialPersona ?? "",
        "data-persona-picker-mode": props.mode ?? "",
      },
      React.createElement("button", {
        "data-save-persona": "true",
        onClick: async () => {
          const preferences = {
            persona: "scientist-with-classic",
            tone: props.initialTone ?? "formal",
            voice: props.initialVoice ?? "upbeat",
          };
          const saved = props.savePreference
            ? await props.savePreference(preferences)
            : preferences;
          props.onSaved?.(saved);
          props.onOpenChange?.(false);
        },
        type: "button",
      }, "Save personality"),
    );
  },
}));

vi.mock("@/src/components/ui/drawer", () => ({
  Drawer: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open
      ? React.createElement("div", { "data-drawer-open": "true" }, children)
      : null,
  DrawerContent: (props: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", { ...props, "data-drawer-content": "true" }),
  DrawerDescription: (props: React.HTMLAttributes<HTMLParagraphElement>) =>
    React.createElement("p", props),
  DrawerFooter: (props: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", props),
  DrawerHeader: (props: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", props),
  DrawerTitle: (props: React.HTMLAttributes<HTMLHeadingElement>) =>
    React.createElement("h2", props),
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

afterEach(() => {
  vi.unstubAllGlobals();
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

  test("summarizes the saved main and supporting personalities in their own row", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, {
        assistant: {
          persona: "scientist-with-classic",
          tone: null,
          voice: null,
        },
      }),
    );

    expect(markup).toContain("Personality");
    expect(markup).toContain("Scientist + Classic");
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

  test("shows Classic when no persona is stored", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomizeMurphSettings, { assistant: null }),
    );

    expect(markup).toContain("Classic");
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

    const picker = rendered.container.querySelector("[data-persona-picker]");
    expect(picker).not.toBeNull();
    expect(picker?.getAttribute("data-persona-picker-mode")).toBe("personality");

    await rendered.cleanup();
  });

  test("updates the row and preserves tone and voice after a personality save", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => ({ assistantPersona: "scientist-with-classic" }),
      init,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const rendered = await renderClientComponent(
      React.createElement(CustomizeMurphSettings, {
        assistant: { persona: "classic", tone: "formal", voice: "grandpa" },
        voiceTestContactOption: makeVoiceTestOption(),
      }),
      { requireButton: false },
    );

    const personalityRow = findSettingsRow(rendered.container, "Personality");
    await React.act(async () => {
      personalityRow?.querySelector("button")?.click();
    });

    const saveButton = rendered.container.querySelector("[data-save-persona]");
    expect(saveButton).toBeInstanceOf(rendered.window.HTMLButtonElement);
    await React.act(async () => {
      (saveButton as HTMLButtonElement | null)?.click();
    });

    expect(rendered.container.textContent).toContain("Scientist + Classic");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      persona: "scientist-with-classic",
    });
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
          persona: "scientist-with-classic",
          tone: "formal",
          voice: "grandpa",
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

    expect(rendered.container.textContent).toContain("Scientist + Classic");

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
    expect(rendered.container.querySelector("[data-drawer-open='true']"))
      .not.toBeNull();
    expect(rendered.container.textContent).toContain("Pick a new look");

    await rendered.cleanup();
  });

  test("keeps Settings contact-card handoff understandable and recoverable", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ claim: "settings.current-member.claim" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const element = React.createElement(CustomizeMurphSettings, {
      assistant: null,
      murphPhoneNumber: "+15550100001",
    });
    const rendered = await renderClientComponent(element, {
      location: {
        host: "app.example.com",
        href: "https://app.example.com/settings",
        origin: "https://app.example.com",
      },
      requireButton: false,
    });

    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    });
    await rendered.rerender(element);

    const contactRow = findSettingsRow(rendered.container, "Contact card");
    await React.act(async () => {
      contactRow?.querySelector("button")?.click();
    });

    expect(rendered.container.textContent).toContain("Pick a new look");
    expect(rendered.container.textContent).toContain(
      "Delete your current Murph contact first, then save this one fresh.",
    );
    expect(rendered.container.textContent).toContain(
      "You're in an in-app browser, which can't save contacts. This opens Safari instead.",
    );
    expect(rendered.container.textContent).toContain("Close");

    const gremlinInput = rendered.container.querySelector<HTMLInputElement>(
      'input[type="radio"][value="gremlin"]',
    );
    expect(gremlinInput).toBeInstanceOf(rendered.window.HTMLInputElement);
    await React.act(async () => {
      gremlinInput?.click();
    });

    const firstAttempt = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    expect(firstAttempt).not.toBeNull();
    await React.act(async () => {
      firstAttempt?.click();
      await flushPromises();
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      avatar: "gremlin",
    });
    expect(rendered.container.querySelector("[role='alert']")?.textContent)
      .toContain("Couldn't open Safari");
    expect(rendered.container.querySelector("[data-drawer-open='true']"))
      .not.toBeNull();

    const retry = findButton(
      rendered.container,
      "Open in Safari to add Murph",
    );
    expect(retry?.disabled).toBe(false);
    await React.act(async () => {
      retry?.click();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      avatar: "gremlin",
    });
    expect(rendered.assign).toHaveBeenCalledWith(
      "x-safari-https://app.example.com/api/murph-contact-card?handoff=settings.current-member.claim",
    );
    await acknowledgeSafariLaunch();
    expect(rendered.container.querySelector("[data-drawer-open='true']"))
      .toBeNull();

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

/** The picker completes only once this document goes away. */
async function acknowledgeSafariLaunch(): Promise<void> {
  await React.act(async () => {
    window.dispatchEvent(new Event("pagehide"));
    await flushPromises();
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function findButton(
  container: Element,
  label: string,
): HTMLButtonElement | null {
  const ButtonElement = container.ownerDocument.defaultView?.HTMLButtonElement;
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  return ButtonElement && button instanceof ButtonElement ? button : null;
}

function findSettingsRow(container: Element, label: string): HTMLElement | null {
  const labelElement = Array.from(container.querySelectorAll("span")).find(
    (candidate) => candidate.textContent === label,
  );
  return labelElement?.parentElement?.parentElement ?? null;
}
