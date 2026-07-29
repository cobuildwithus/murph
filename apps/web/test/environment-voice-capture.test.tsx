import assert from "node:assert/strict";

import { act, createElement, type ReactNode } from "react";
import { test, vi } from "vitest";

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({
    children,
    disablePointerDismissal,
    onOpenChange,
    open,
  }: {
    children: ReactNode;
    disablePointerDismissal?: boolean;
    onOpenChange?: (open: boolean) => void;
    open: boolean;
  }) =>
    open
      ? createElement(
          "div",
          {
            "data-pointer-dismissal-disabled": String(
              disablePointerDismissal ?? false,
            ),
          },
          createElement(
            "button",
            {
              onClick: () => onOpenChange?.(false),
              type: "button",
            },
            "Dismiss dialog",
          ),
          children,
        )
      : null,
  DialogContent: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DialogDescription: ({ children }: { children: ReactNode }) =>
    createElement("p", null, children),
  DialogHeader: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DialogTitle: ({ children }: { children: ReactNode }) =>
    createElement("h2", null, children),
}));

import {
  EnvironmentVoiceCapture,
  microphoneAccessNotice,
} from "../app/(dashboard)/environment/environment-voice-capture";
import { renderClientComponent } from "./render-client-component";

test("explains when the browser has blocked microphone permission", () => {
  assert.match(
    microphoneAccessNotice({ name: "NotAllowedError" }),
    /Microphone access is blocked for this site/,
  );
});

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

test("keeps the dialog open when a recording is in progress", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture, {
      contactAction: null,
    }),
  );
  const trackStop = vi.fn();

  class FakeMediaRecorder {
    static isTypeSupported() {
      return true;
    }

    mimeType = "audio/webm";
    state: RecordingState = "inactive";
    private readonly listeners = new Map<string, EventListener[]>();

    addEventListener(type: string, listener: EventListener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      for (const listener of this.listeners.get("stop") ?? []) {
        listener(new Event("stop"));
      }
    }
  }

  const originalMediaRecorder = Reflect.get(globalThis, "MediaRecorder");
  try {
    const mediaDevices = {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: trackStop }],
      }),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
    Object.defineProperty(rendered.window.navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
    Reflect.set(globalThis, "MediaRecorder", FakeMediaRecorder);
    Reflect.set(rendered.window, "MediaRecorder", FakeMediaRecorder);

    await clickButton(rendered.window, "Tell Murph by voice");
    await clickButton(rendered.window, "Start recording");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Finish recording/, bodyText);
    const dialog = rendered.window.document.querySelector(
      "[data-pointer-dismissal-disabled]",
    );
    assert.equal(
      dialog?.getAttribute("data-pointer-dismissal-disabled"),
      "true",
    );
    await clickButton(rendered.window, "Dismiss dialog");

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Recording/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Finish recording/,
    );
  } finally {
    if (originalMediaRecorder === undefined) {
      Reflect.deleteProperty(globalThis, "MediaRecorder");
    } else {
      Reflect.set(globalThis, "MediaRecorder", originalMediaRecorder);
    }
    await rendered.cleanup();
  }
});

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
