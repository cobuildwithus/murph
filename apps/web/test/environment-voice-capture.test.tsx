import assert from "node:assert/strict";

import { act, createElement, type ReactNode } from "react";
import { test, vi } from "vitest";

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DialogDescription: ({ children }: { children: ReactNode }) =>
    createElement("p", null, children),
  DialogHeader: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DialogTitle: ({ children }: { children: ReactNode }) =>
    createElement("h2", null, children),
}));

import { EnvironmentVoiceCapture } from "../app/(dashboard)/environment/environment-voice-capture";
import { renderClientComponent } from "./render-client-component";

test.each([
  {
    href: "sms:+15555550100?body=Home%20environment",
    kind: "text" as const,
  },
  {
    href: "https://t.me/withmurph_bot?text=Home%20environment",
    kind: "telegram" as const,
  },
])(
  "microphone recovery keeps the member's $kind channel",
  async ({ href, kind }) => {
    const rendered = await renderClientComponent(
      createElement(EnvironmentVoiceCapture, {
        contactAction: {
          href,
          kind,
          label: kind === "text" ? "Text Murph" : "Telegram",
        },
      }),
    );

    try {
      await clickButton(rendered.window, "Tell Murph by voice");
      await clickButton(rendered.window, "Start recording");

      assert.match(
        rendered.window.document.body.textContent ?? "",
        /could not access the microphone|cannot record audio here/,
      );
      const openMurph = Array.from(
        rendered.window.document.querySelectorAll("a"),
      ).find((anchor) => anchor.textContent?.includes("Open Murph"));
      assert.ok(openMurph);
      assert.equal(openMurph.getAttribute("href"), href);
      if (kind === "text") {
        assert.doesNotMatch(openMurph.getAttribute("href") ?? "", /t\.me/);
      }
    } finally {
      await rendered.cleanup();
    }
  },
);

async function clickButton(
  window: Window & typeof globalThis,
  label: string,
): Promise<void> {
  const button = Array.from(window.document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  assert.ok(button, `Could not find button "${label}".`);
  await act(async () => {
    button.click();
  });
}
