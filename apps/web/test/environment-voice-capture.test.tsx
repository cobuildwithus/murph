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
import type { EnvironmentVoiceScript } from "../app/(dashboard)/environment/environment-voice-script";
import { renderClientComponent } from "./render-client-component";

test("explains when the browser has blocked microphone permission", () => {
  assert.match(
    microphoneAccessNotice({ name: "NotAllowedError" }),
    /Microphone access is blocked for this site/,
  );
});

test("renders a user-specific missing-data script", async () => {
  const script: EnvironmentVoiceScript = {
    dialogTitle: "Fill the gaps in your report",
    flow: "fill-gaps",
    idleDescription: "One short topic, based on what Murph does not know yet.",
    idleTitle: "Only the missing details",
    topics: [
      {
        eyebrow: "Sleep",
        focus: ["Night temperature", "Darkness"],
        id: "sleep",
        prompt: "Cover only the details Murph is still missing.",
        title: "Your remaining sleep details",
      },
    ],
  };
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture, {
      script,
      triggerLabel: "Fill in what's missing",
    }),
  );

  try {
    await clickButton(rendered.window, "Fill in what's missing");
    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Fill the gaps in your report/);
    assert.match(bodyText, /Topic 1 of 1/);
    assert.match(bodyText, /Night temperature/);
    assert.match(bodyText, /Darkness/);
    assert.doesNotMatch(bodyText, /Recovery and devices/);
  } finally {
    await rendered.cleanup();
  }
});

test("explains microphone failure without handing private audio to another app", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture),
  );

  try {
    await clickButton(rendered.window, "Tell Murph by voice");
    await clickButton(rendered.window, "Start recording");

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /could not access the microphone|cannot record audio here/,
    );
    assert.equal(
      Array.from(rendered.window.document.querySelectorAll("a")).some(
        (anchor) => anchor.textContent?.includes("Open Murph"),
      ),
      false,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the dialog open when a recording is in progress", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture),
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

test("keeps a failed recording for retry and reuses its capture time", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture),
  );
  const uploadRequests: RequestInit[] = [];
  const trackStop = vi.fn();
  let uploadAttempt = 0;

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
      const dataEvent = new Event("dataavailable");
      Object.defineProperty(dataEvent, "data", {
        value: new Blob([
          Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]),
        ], { type: "audio/webm" }),
      });
      for (const listener of this.listeners.get("dataavailable") ?? []) {
        listener(dataEvent);
      }
      this.state = "inactive";
      for (const listener of this.listeners.get("stop") ?? []) {
        listener(new Event("stop"));
      }
    }
  }

  const originalFetch = globalThis.fetch;
  const originalMediaRecorder = Reflect.get(globalThis, "MediaRecorder");
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
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
    URL.createObjectURL = vi.fn(() => "blob:environment-recording");
    URL.revokeObjectURL = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      uploadRequests.push(init ?? {});
      uploadAttempt += 1;
      return uploadAttempt === 1
        ? Response.json(
            { error: { message: "Murph cannot receive this recording right now." } },
            { status: 503 },
          )
        : Response.json({ accepted: true }, { status: 202 });
    });
    globalThis.fetch = fetchMock;
    rendered.window.fetch = fetchMock;

    await clickButton(rendered.window, "Tell Murph by voice");
    await clickButton(rendered.window, "Start recording");
    await clickButton(rendered.window, "Finish recording");

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Play preview/,
    );
    await clickButton(rendered.window, "Send to Murph");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Murph cannot receive this recording right now/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Download/,
    );

    await clickButton(rendered.window, "Send to Murph");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Sent securely/,
    );
    assert.equal(uploadRequests.length, 2);
    const firstHeaders = new Headers(uploadRequests[0]?.headers);
    const secondHeaders = new Headers(uploadRequests[1]?.headers);
    assert.equal(
      firstHeaders.get("x-murph-environment-voice-captured-at"),
      secondHeaders.get("x-murph-environment-voice-captured-at"),
    );
    assert.equal(
      firstHeaders.get("x-murph-environment-voice-capture-id"),
      secondHeaders.get("x-murph-environment-voice-capture-id"),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMediaRecorder === undefined) {
      Reflect.deleteProperty(globalThis, "MediaRecorder");
    } else {
      Reflect.set(globalThis, "MediaRecorder", originalMediaRecorder);
    }
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
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
