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
  DialogClose: ({ children }: { children: ReactNode }) =>
    createElement("button", { "aria-label": "Close", type: "button" }, children),
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

const SCRIPT: EnvironmentVoiceScript = {
  dialogTitle: "Build your Environment report",
  flow: "walkthrough",
  idleDescription: "2 focused topics. Murph saves each topic before moving on.",
  idleTitle: "Ready when you are",
  topics: [
    {
      eyebrow: "Sleep",
      fields: [
        {
          aspectId: "sleep-environment",
          indicatorId: "night_temp_c",
          label: "Your bedroom temperature at night",
          valueType: { kind: "number" },
        },
      ],
      focus: ["Your bedroom temperature at night"],
      id: "sleep:0",
      prompt: "Describe the item below. If you do not know, say so.",
      title: "Your bedroom at night",
    },
    {
      eyebrow: "Workspace",
      fields: [
        {
          aspectId: "workspace",
          indicatorId: "work_mode",
          label: "Whether you work at home, an office, or both",
          valueType: { kind: "text" },
        },
      ],
      focus: ["Whether you work at home, an office, or both"],
      id: "workspace:0",
      prompt: "Describe the item below. If you do not know, say so.",
      title: "Your work setup",
    },
  ],
};

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

test("opens with concise instructions before showing the first topic", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture, {
      script: SCRIPT,
      triggerLabel: "Start report",
    }),
  );

  try {
    await clickButton(rendered.window, "Start report");
    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /One topic at a time/);
    assert.match(bodyText, /Start recording/);
    assert.match(bodyText, /Only confirmed details are added to your report/);
    assert.match(bodyText, /Speaking language/);
    assert.doesNotMatch(bodyText, /Your bedroom at night/);
  } finally {
    await rendered.cleanup();
  }
});

test("shows the active topic, durable check mark, and persistent transcript", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture, {
      preview: {
        capturedFieldKeys: ["sleep-environment.night_temp_c"],
        detectedLanguageCode: "pl",
        state: "listening",
        transcript: "The bedroom stays near nineteen degrees.",
      },
      script: SCRIPT,
    }),
  );

  try {
    const bodyText = rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /Your bedroom at night/);
    assert.match(bodyText, /The bedroom stays near nineteen degrees/);
    assert.match(bodyText, /Finish report/);
    assert.match(bodyText, /Next/);
    assert.equal(
      rendered.window.document.querySelectorAll('[aria-live="polite"]').length > 0,
      true,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("requires authentication before opening the interview", async () => {
  authMocks.authenticated = false;
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture, {
      script: SCRIPT,
      triggerLabel: "Start report",
    }),
  );

  try {
    await clickButton(rendered.window, "Start report");
    assert.equal(authMocks.openAuthDialog.mock.calls.length, 1);
    assert.doesNotMatch(
      rendered.window.document.body.textContent ?? "",
      /Start recording/,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("keeps the dialog open when live voice is unsupported", async () => {
  const originalPeerConnection = Reflect.get(globalThis, "RTCPeerConnection");
  Reflect.deleteProperty(globalThis, "RTCPeerConnection");
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture, {
      script: SCRIPT,
      triggerLabel: "Start report",
    }),
  );

  try {
    await clickButton(rendered.window, "Start report");
    await clickButton(rendered.window, "Start recording");
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /cannot start live voice here/,
    );
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Try again/,
    );
  } finally {
    if (originalPeerConnection === undefined) {
      Reflect.deleteProperty(globalThis, "RTCPeerConnection");
    } else {
      Reflect.set(globalThis, "RTCPeerConnection", originalPeerConnection);
    }
    await rendered.cleanup();
  }
});

async function clickButton(window: Window, label: string) {
  const button = [...window.document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  assert.ok(button, `Missing button: ${label}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}
