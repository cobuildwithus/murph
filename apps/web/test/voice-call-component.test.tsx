import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";
import type { VoiceCallState } from "../src/components/voice/browser-voice-call";

const mocks = vi.hoisted(() => ({
  openAuthDialog: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({ useAuth: () => ({ openAuthDialog: mocks.openAuthDialog }) }));
vi.mock("../src/components/voice/browser-voice-call", async (original) => ({
  ...await original<typeof import("../src/components/voice/browser-voice-call")>(),
  createBrowserVoiceCall: mocks.create,
}));
import { VoiceCall } from "../src/components/voice/voice-call";
import { INITIAL_VOICE_CALL_STATE } from "../src/components/voice/browser-voice-call";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it("asks signed-out visitors to sign in before acquiring any media", async () => {
  const view = await renderClientComponent(createElement(VoiceCall, { signedIn: false }));
  try {
    expect(view.button.textContent).toContain("Sign in to talk");
    await act(async () => view.button.click());
    expect(mocks.openAuthDialog).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  } finally { await view.cleanup(); }
});

it("ends on page exit, restores an ended screen, and ignores an old call's late events", async () => {
  const calls: Array<{ change: (state: VoiceCallState) => void; close: ReturnType<typeof vi.fn> }> = [];
  mocks.create.mockImplementation((_audio, change: (state: VoiceCallState) => void) => {
    const close = vi.fn(async () => {});
    calls.push({ change, close });
    return { start: async () => change({ ...INITIAL_VOICE_CALL_STATE, phase: "connected" }), close, mute: vi.fn(), play: vi.fn() };
  });
  const view = await renderClientComponent(createElement(VoiceCall, { signedIn: true }));
  try {
    expect(mocks.create).not.toHaveBeenCalled();
    await act(async () => view.button.click());
    expect(view.container.textContent).toContain("Microphone on");
    await act(async () => view.window.dispatchEvent(new view.window.Event("pagehide")));
    expect(calls[0]!.close).toHaveBeenCalledOnce();
    expect(view.container.textContent).toContain("Microphone off");
    const start = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent?.includes("Start another call"))!;
    await act(async () => start.click());
    expect(calls).toHaveLength(2);
    await act(async () => calls[0]!.change({ ...INITIAL_VOICE_CALL_STATE, phase: "error", message: "obsolete-call" }));
    expect(view.container.textContent).toContain("Microphone on");
    expect(view.container.textContent).not.toContain("obsolete-call");
  } finally { await view.cleanup(); }
  expect(calls[1]!.close).toHaveBeenCalledOnce();
});
