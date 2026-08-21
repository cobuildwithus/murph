import assert from "node:assert/strict";

import { act, createElement, type ReactElement, type ReactNode } from "react";
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
  DialogClose: ({
    children,
    render,
  }: {
    children: ReactNode;
    render?: ReactElement<{ disabled?: boolean }>;
  }) =>
    createElement(
      "button",
      {
        "aria-label": "Close",
        disabled: render?.props.disabled,
        type: "button",
      },
      children,
    ),
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
  addDeclinedAnswersForSkippedTopic,
  EnvironmentVoiceCapture,
  microphoneAccessNotice,
  summarizeEnvironmentInterviewCompletion,
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
    assert.match(bodyText, /Saved: Your bedroom temperature at night/);
    assert.match(bodyText, /Finish report/);
    assert.match(bodyText, /Next/);
    const transcriptLabel = [
      ...rendered.window.document.querySelectorAll("p"),
    ].find((candidate) => candidate.textContent === "Live transcript");
    assert.ok(transcriptLabel?.parentElement);
    assert.equal(
      transcriptLabel.parentElement.hasAttribute("aria-live"),
      false,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("blocks navigation while an answer is being accepted", async () => {
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture, {
      preview: {
        state: "saving",
        transcript: "The bedroom stays near nineteen degrees.",
      },
      script: SCRIPT,
    }),
  );

  try {
    assert.equal(findButton(rendered.window, "Finish report").disabled, true);
    assert.equal(findButton(rendered.window, "Next").disabled, true);
    assert.equal(findButton(rendered.window, "Close").disabled, true);
    assert.match(
      rendered.window.document.body.textContent ?? "",
      /Not saved: Your bedroom temperature at night/,
    );
  } finally {
    await rendered.cleanup();
  }
});

test("turns every unresolved field into a decline on skip", () => {
  const topic = {
    ...SCRIPT.topics[0],
    fields: [
      ...(SCRIPT.topics[0]?.fields ?? []),
      {
        aspectId: "sleep-environment",
        indicatorId: "darkness",
        label: "Bedroom darkness",
        valueType: { kind: "text" as const },
      },
    ],
  };
  const answers = addDeclinedAnswersForSkippedTopic(
    topic,
    [
      {
        aspectId: "sleep-environment",
        indicatorId: "night_temp_c",
        value: 19,
      },
    ],
    new Map(),
  );

  assert.deepEqual(answers, [
    {
      aspectId: "sleep-environment",
      indicatorId: "night_temp_c",
      value: 19,
    },
    {
      aspectId: "sleep-environment",
      indicatorId: "darkness",
      value: "declined",
    },
  ]);
});

test("does not count declined fields as clear progress", () => {
  assert.deepEqual(
    summarizeEnvironmentInterviewCompletion(
      { ...SCRIPT, initialCoveredDetails: 0, totalDetails: 2 },
      new Map([
        ["sleep-environment.night_temp_c", "declined"],
        ["workspace.work_mode", "declined"],
      ]),
    ),
    {
      coveredDetails: 0,
      remainingDetails: 0,
      savedDetails: 0,
      totalDetails: 2,
    },
  );
});

test("saves current and next-topic facts before navigation", async () => {
  const runtimeScript: EnvironmentVoiceScript = {
    ...SCRIPT,
    topics: [
      {
        ...SCRIPT.topics[0],
        fields: [
          ...(SCRIPT.topics[0]?.fields ?? []),
          {
            aspectId: "sleep-environment",
            indicatorId: "darkness",
            label: "Whether your bedroom is dark",
            valueType: { kind: "boolean" },
          },
        ],
        focus: [
          ...(SCRIPT.topics[0]?.focus ?? []),
          "Whether your bedroom is dark",
        ],
      },
      SCRIPT.topics[1],
      {
        eyebrow: "Light",
        fields: [
          {
            aspectId: "light",
            indicatorId: "daylight",
            label: "Daylight access",
            valueType: { kind: "boolean" },
          },
        ],
        id: "light:0",
        prompt: "Describe the item below.",
        title: "Your daylight",
      },
    ],
  };
  const onAccepted = vi.fn();
  const harness = await startRealtimeInterview(runtimeScript, onAccepted);

  try {
    const sessionUpdate = harness.dataChannel.sent
      .map((value): unknown => JSON.parse(value))
      .find(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "type" in value &&
          value.type === "session.update",
      );
    assert.ok(
      typeof sessionUpdate === "object" &&
        sessionUpdate !== null &&
        "session" in sessionUpdate,
    );
    const session = sessionUpdate.session;
    assert.ok(
      typeof session === "object" &&
        session !== null &&
        "tools" in session &&
        Array.isArray(session.tools),
    );
    const updateTool = session.tools.find(
      (tool) =>
        typeof tool === "object" &&
        tool !== null &&
        "name" in tool &&
        tool.name === "update_environment_interview",
    );
    assert.ok(updateTool);
    assert.ok("parameters" in updateTool);
    assert.ok(
      typeof updateTool.parameters === "object" &&
        updateTool.parameters !== null,
    );
    assert.equal("anyOf" in updateTool.parameters, false);
    assert.match(JSON.stringify(updateTool), /sleep:0/);
    assert.match(JSON.stringify(updateTool), /workspace:0/);
    assert.match(JSON.stringify(updateTool), /"next"/);
    assert.doesNotMatch(
      JSON.stringify(session.tools),
      /mark_environment_fields/,
    );
    assert.doesNotMatch(
      JSON.stringify(session.tools),
      /control_environment_interview/,
    );

    await act(async () => {
      harness.dataChannel.emit(
        "message",
        JSON.stringify({
          arguments: JSON.stringify({
            languageCode: "en",
            topics: [
              {
                answers: [
                  {
                    aspectId: "workspace",
                    indicatorId: "work_mode",
                    value: "home",
                  },
                ],
                topicId: "workspace:0",
              },
            ],
          }),
          call_id: "call_1",
          name: "update_environment_interview",
          type: "response.function_call_arguments.done",
        }),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      assert.equal(onAccepted.mock.calls.length, 1);
      assert.match(
        harness.rendered.window.document.body.textContent ?? "",
        /Your bedroom at night/,
      );
    });

    await act(async () => {
      harness.dataChannel.emit(
        "message",
        JSON.stringify({
          arguments: JSON.stringify({
            action: "next",
            languageCode: "en",
            topics: [
              {
                answers: [
                  {
                    aspectId: "sleep-environment",
                    indicatorId: "night_temp_c",
                    value: 19,
                  },
                  {
                    aspectId: "sleep-environment",
                    indicatorId: "darkness",
                    value: true,
                  },
                ],
                topicId: "sleep:0",
              },
              {
                answers: [
                  {
                    aspectId: "workspace",
                    indicatorId: "work_mode",
                    note: "The member works from home full time.",
                    value: "home",
                  },
                ],
                topicId: "workspace:0",
              },
            ],
          }),
          call_id: "call_2",
          name: "update_environment_interview",
          type: "response.function_call_arguments.done",
        }),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      assert.equal(onAccepted.mock.calls.length, 2);
      assert.match(
        harness.rendered.window.document.body.textContent ?? "",
        /Your work setup/,
      );
    });
    await clickButton(harness.rendered.window, "Finish report");
    assert.match(
      harness.rendered.window.document.body.textContent ?? "",
      /Your answers were accepted/,
    );
    assert.equal(
      harness.fetchMock.mock.calls.filter(
        ([input]) => input === "/api/environment/realtime/topics",
      ).length,
      2,
    );
    const topicRequests = harness.fetchMock.mock.calls.filter(
      ([input]) => input === "/api/environment/realtime/topics",
    );
    assert.ok(topicRequests[0]?.[1]?.body);
    assert.deepEqual(JSON.parse(String(topicRequests[0][1].body)).topics, [
      {
        answers: [
          {
            aspectId: "workspace",
            indicatorId: "work_mode",
            value: "home",
          },
        ],
        topicId: "workspace:0",
      },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test("does not claim that an empty interview changed the report", async () => {
  const harness = await startRealtimeInterview(SCRIPT, vi.fn());

  try {
    await clickButton(harness.rendered.window, "Finish report");
    const bodyText = harness.rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /No new details were saved/);
    assert.match(bodyText, /Your report has not changed/);
    assert.doesNotMatch(bodyText, /Your answers are safe/);
    assert.equal(
      harness.fetchMock.mock.calls.some(
        ([input]) => input === "/api/environment/realtime/topics",
      ),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test("does not claim that unanswered navigation changed the report", async () => {
  const harness = await startRealtimeInterview(SCRIPT, vi.fn());

  try {
    await clickButton(harness.rendered.window, "Next");
    assert.match(
      harness.rendered.window.document.body.textContent ?? "",
      /Your work setup/,
    );
    await clickButton(harness.rendered.window, "Next");
    const bodyText = harness.rendered.window.document.body.textContent ?? "";
    assert.match(bodyText, /No new details were saved/);
    assert.doesNotMatch(bodyText, /will update shortly/);
    assert.equal(
      harness.fetchMock.mock.calls.some(
        ([input]) => input === "/api/environment/realtime/topics",
      ),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test("treats an accepted decline as a saved interview update", async () => {
  const harness = await startRealtimeInterview(SCRIPT, vi.fn());

  try {
    await act(async () => {
      harness.dataChannel.emit(
        "message",
        JSON.stringify({
          arguments: JSON.stringify({ action: "skip" }),
          call_id: "call_skip",
          name: "update_environment_interview",
          type: "response.function_call_arguments.done",
        }),
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      assert.match(
        harness.rendered.window.document.body.textContent ?? "",
        /Your work setup/,
      );
    });
    await clickButton(harness.rendered.window, "Finish report");
    assert.match(
      harness.rendered.window.document.body.textContent ?? "",
      /Your answers were accepted/,
    );
    const topicRequest = harness.fetchMock.mock.calls.find(
      ([input]) => input === "/api/environment/realtime/topics",
    );
    assert.ok(topicRequest?.[1]?.body);
    assert.deepEqual(JSON.parse(String(topicRequest[1].body)).topics, [
      {
        answers: [
          {
            aspectId: "sleep-environment",
            indicatorId: "night_temp_c",
            value: "declined",
          },
        ],
        topicId: "sleep:0",
      },
    ]);
  } finally {
    await harness.cleanup();
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
    assert.match(rendered.window.document.body.textContent ?? "", /Try again/);
  } finally {
    if (originalPeerConnection === undefined) {
      Reflect.deleteProperty(globalThis, "RTCPeerConnection");
    } else {
      Reflect.set(globalThis, "RTCPeerConnection", originalPeerConnection);
    }
    await rendered.cleanup();
  }
});

async function startRealtimeInterview(
  script: EnvironmentVoiceScript,
  onAccepted: () => void,
) {
  const originalPeerConnection = Reflect.get(globalThis, "RTCPeerConnection");
  const originalFetch = Reflect.get(globalThis, "fetch");
  const dataChannel = new FakeDataChannel();
  const track = { enabled: true, stop: vi.fn() };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/environment/realtime") {
        return new Response("answer-sdp", { status: 200 });
      }
      assert.equal(url, "/api/environment/realtime/topics");
      assert.equal(init?.method, "POST");
      return new Response(null, { status: 202 });
    },
  );
  vi.stubGlobal(
    "RTCPeerConnection",
    class FakePeerConnection extends EventTarget {
      connectionState = "connected";

      addTrack() {}

      close() {}

      createDataChannel() {
        return dataChannel;
      }

      async createOffer() {
        return { sdp: "offer-sdp", type: "offer" as const };
      }

      async setLocalDescription() {}

      async setRemoteDescription() {}
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const rendered = await renderClientComponent(
    createElement(EnvironmentVoiceCapture, {
      onAccepted,
      script,
      triggerLabel: "Start report",
    }),
  );
  const originalMediaDevices = navigator.mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });

  await clickButton(rendered.window, "Start report");
  await clickButton(rendered.window, "Start recording");
  await vi.waitFor(() => {
    assert.equal(
      fetchMock.mock.calls.some(
        ([input]) => input === "/api/environment/realtime",
      ),
      true,
    );
  });
  await act(async () => {
    dataChannel.emit("open");
    await Promise.resolve();
  });

  return {
    cleanup: async () => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: originalMediaDevices,
      });
      if (originalPeerConnection === undefined) {
        Reflect.deleteProperty(globalThis, "RTCPeerConnection");
      } else {
        Reflect.set(globalThis, "RTCPeerConnection", originalPeerConnection);
      }
      if (originalFetch === undefined) {
        Reflect.deleteProperty(globalThis, "fetch");
      } else {
        Reflect.set(globalThis, "fetch", originalFetch);
      }
      await rendered.cleanup();
    },
    dataChannel,
    fetchMock,
    rendered,
  };
}

async function clickButton(window: Window, label: string) {
  const button = findButton(window, label);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

function findButton(window: Window, label: string): HTMLButtonElement {
  const button = [...window.document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  assert.ok(button, `Missing button: ${label}`);
  return button;
}

class FakeDataChannel {
  private readonly listeners = new Map<
    string,
    Array<(event: { currentTarget: FakeDataChannel; data: string }) => void>
  >();
  readonly readyState = "open";
  readonly sent: string[] = [];

  addEventListener(
    type: string,
    listener: (event: { currentTarget: FakeDataChannel; data: string }) => void,
  ) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {}

  emit(type: string, data = "") {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ currentTarget: this, data });
    }
  }

  send(value: string) {
    this.sent.push(value);
  }
}
