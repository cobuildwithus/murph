import assert from "node:assert/strict";

import { act, createElement, type ReactNode } from "react";
import { beforeEach, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  authenticated: true,
  openAuthDialog: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({
  useAuth: () => ({
    authenticated: authMocks.authenticated,
    openAuthDialog: authMocks.openAuthDialog,
  }),
}));

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

beforeEach(() => {
  authMocks.authenticated = true;
  authMocks.openAuthDialog.mockReset();
});

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
        title: "Your sleep setup",
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

test("requires authentication before opening the voice walkthrough", async () => {
  authMocks.authenticated = false;
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture),
  );

  try {
    await clickButton(rendered.window, "Tell Murph by voice");

    assert.equal(authMocks.openAuthDialog.mock.calls.length, 1);
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /Start recording/,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the walkthrough open while iOS resolves microphone permission", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture),
  );
  let rejectPermission: ((reason?: unknown) => void) | undefined;
  const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices",
  );
  const windowMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
    rendered.window.navigator,
    "mediaDevices",
  );
  const originalMediaRecorder = Reflect.get(globalThis, "MediaRecorder");

  try {
    class PendingMediaRecorder {
      static isTypeSupported() {
        return true;
      }
    }
    const mediaDevices = {
      getUserMedia: vi.fn(
        () => new Promise<MediaStream>((_resolve, reject) => {
          rejectPermission = reject;
        }),
      ),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
    Object.defineProperty(rendered.window.navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
    Reflect.set(globalThis, "MediaRecorder", PendingMediaRecorder);
    Reflect.set(rendered.window, "MediaRecorder", PendingMediaRecorder);

    await clickButton(rendered.window, "Tell Murph by voice");
    await clickButton(rendered.window, "Start recording");

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
      /Start recording/,
    );

    await act(async () => {
      rejectPermission?.({ name: "NotAllowedError" });
      await Promise.resolve();
    });
  } finally {
    if (mediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
    if (windowMediaDevicesDescriptor) {
      Object.defineProperty(
        rendered.window.navigator,
        "mediaDevices",
        windowMediaDevicesDescriptor,
      );
    } else {
      Reflect.deleteProperty(rendered.window.navigator, "mediaDevices");
    }
    if (originalMediaRecorder === undefined) {
      Reflect.deleteProperty(globalThis, "MediaRecorder");
      Reflect.deleteProperty(rendered.window, "MediaRecorder");
    } else {
      Reflect.set(globalThis, "MediaRecorder", originalMediaRecorder);
      Reflect.set(rendered.window, "MediaRecorder", originalMediaRecorder);
    }
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

test("keeps the dialog open until an unsent recording is explicitly discarded", async () => {
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
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalPause = Object.getOwnPropertyDescriptor(
    rendered.window.HTMLMediaElement.prototype,
    "pause",
  );
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
    Object.defineProperty(rendered.window.HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    });

    await clickButton(rendered.window, "Tell Murph by voice");
    await clickButton(
      rendered.window,
      "Go to topic 3: Light through the day",
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Light through the day/,
    );
    await clickButton(rendered.window, "Start recording");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Finish recording/, bodyText);
    assert.match(bodyText, /Light through the day/, bodyText);
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

    await clickButton(rendered.window, "Finish recording");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Play preview/,
    );
    const previewAudio = rendered.window.document.querySelector("audio");
    assert.ok(previewAudio);
    Object.defineProperty(previewAudio, "pause", {
      configurable: true,
      value: vi.fn(),
    });
    assert.equal(
      dialog?.getAttribute("data-pointer-dismissal-disabled"),
      "true",
    );
    await clickButton(rendered.window, "Dismiss dialog");
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Play preview/,
    );

    await clickButton(rendered.window, "Discard recording");
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Play preview/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Discard this recording\?/,
    );

    await clickButton(rendered.window, "Keep recording");
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Play preview/,
    );
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /Discard this recording\?/,
    );

    await clickButton(rendered.window, "Discard recording");
    await clickButton(rendered.window, "Discard permanently");
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /Play preview/,
    );
  } finally {
    if (originalMediaRecorder === undefined) {
      Reflect.deleteProperty(globalThis, "MediaRecorder");
    } else {
      Reflect.set(globalThis, "MediaRecorder", originalMediaRecorder);
    }
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    if (originalPause) {
      Object.defineProperty(
        rendered.window.HTMLMediaElement.prototype,
        "pause",
        originalPause,
      );
    }
    await rendered.cleanup();
  }
});

test("releases the microphone when Safari moves the page into the background", async () => {
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
      const dataEvent = new Event("dataavailable");
      Object.defineProperty(dataEvent, "data", {
        value: new Blob([Uint8Array.from([1, 2, 3])], {
          type: "audio/webm",
        }),
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

  const originalMediaRecorder = Reflect.get(globalThis, "MediaRecorder");
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices",
  );
  const windowMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
    rendered.window.navigator,
    "mediaDevices",
  );
  const visibilityStateDescriptor = Object.getOwnPropertyDescriptor(
    rendered.window.document,
    "visibilityState",
  );
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
    URL.createObjectURL = vi.fn(() => "blob:backgrounded-recording");
    URL.revokeObjectURL = vi.fn();

    await clickButton(rendered.window, "Tell Murph by voice");
    await clickButton(rendered.window, "Start recording");
    await act(async () => {
      await Promise.resolve();
    });

    Object.defineProperty(rendered.window.document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await act(async () => {
      rendered.window.document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    assert.equal(trackStop.mock.calls.length, 1);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Play preview/,
    );
  } finally {
    if (mediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
    if (windowMediaDevicesDescriptor) {
      Object.defineProperty(
        rendered.window.navigator,
        "mediaDevices",
        windowMediaDevicesDescriptor,
      );
    } else {
      Reflect.deleteProperty(rendered.window.navigator, "mediaDevices");
    }
    if (visibilityStateDescriptor) {
      Object.defineProperty(
        rendered.window.document,
        "visibilityState",
        visibilityStateDescriptor,
      );
    } else {
      Reflect.deleteProperty(rendered.window.document, "visibilityState");
    }
    if (originalMediaRecorder === undefined) {
      Reflect.deleteProperty(globalThis, "MediaRecorder");
      Reflect.deleteProperty(rendered.window, "MediaRecorder");
    } else {
      Reflect.set(globalThis, "MediaRecorder", originalMediaRecorder);
      Reflect.set(rendered.window, "MediaRecorder", originalMediaRecorder);
    }
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    await rendered.cleanup();
  }
});

test("keeps a failed recording for retry and reuses its capture time", async () => {
  const onAccepted = vi.fn();
  const onUploadStarted = vi.fn();
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture, { onAccepted, onUploadStarted }),
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
    await vi.waitFor(() => {
      assert.match(
        rendered.window.document.body.textContent ?? "",
        /Murph cannot receive this recording right now/,
      );
    });

    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Download/,
    );

    await clickButton(rendered.window, "Send to Murph");
    await vi.waitFor(() => {
      assert.match(
        rendered.window.document.body.textContent ?? "",
        /Recording received/,
      );
    });
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /You can close this and keep browsing/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /The recording is deleted after processing/,
    );

    assert.equal(onAccepted.mock.calls.length, 1);
    assert.equal(onUploadStarted.mock.calls.length, 2);
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
    (candidate) =>
      candidate.textContent?.includes(label) ||
      candidate.getAttribute("aria-label")?.includes(label),
  );
  assert.ok(button, `Could not find button "${label}".`);
  await act(async () => {
    button.click();
  });
}
