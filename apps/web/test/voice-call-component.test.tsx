import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";
import type { VoiceCallState } from "../src/components/voice/browser-voice-call";

const mocks = vi.hoisted(() => ({
  openAuthDialog: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/src/components/hosted-onboarding/auth-dialog-provider", () => ({ useAuth: () => ({ openAuthDialog: mocks.openAuthDialog }) }));
// Graphics are exercised by the real-browser orb and voice journeys.
vi.mock("../src/components/voice-orb/voice-orb", () => ({ VoiceOrb: () => createElement("span", { "data-orb": true }) }));
vi.mock("../src/components/voice/browser-voice-call", async (original) => ({
  ...await original<typeof import("../src/components/voice/browser-voice-call")>(),
  createBrowserVoiceCall: mocks.create,
}));
import { VoiceCall } from "../src/components/voice/voice-call";
import { INITIAL_VOICE_CALL_STATE } from "../src/components/voice/browser-voice-call";
import { VoiceCallPanel } from "../src/components/voice/voice-call-panel";

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

it("derives speech motion from audible media and keeps mute, playback recovery and end separate", async () => {
  const actions = { onStart: vi.fn(), onMute: vi.fn(), onEnd: vi.fn(), onPlay: vi.fn() };
  const state: VoiceCallState = { ...INITIAL_VOICE_CALL_STATE, phase: "connected", inputLevel: 0.6, outputLevel: 0.4 };
  const view = await renderClientComponent(createElement(VoiceCallPanel, { state, ...actions }));
  try {
    expect(view.button.dataset.speaker).toBe("user");
    expect(view.button.textContent).toBe("Mute microphone");
    expect(view.button.querySelector("[style]")?.getAttribute("style")).toContain("scale(0.776)");
    await act(async () => view.button.click());
    expect(actions.onMute).toHaveBeenCalledOnce();
    expect(actions.onEnd).not.toHaveBeenCalled();
    await view.rerender(createElement(VoiceCallPanel, { state: { ...state, muted: true }, ...actions }));
    expect(view.button.dataset.speaker).toBe("assistant");
    expect(view.button.textContent).toContain("Unmute microphone");
    expect(view.container.textContent).toContain("including while muted");
    await view.rerender(createElement(VoiceCallPanel, { state: { ...state, muted: true, audioBlocked: true }, ...actions }));
    expect(view.button.dataset.speaker).toBe("none");
    const buttons = Array.from(view.container.querySelectorAll("button"));
    await act(async () => buttons.find((button) => button.textContent?.includes("Play audio"))!.click());
    expect(actions.onPlay).toHaveBeenCalledOnce();
    await act(async () => buttons.find((button) => button.textContent?.includes("End call"))!.click());
    expect(actions.onEnd).toHaveBeenCalledOnce();
  } finally { await view.cleanup(); }
});

it("keeps cancellation available during startup and disables restart while closing", async () => {
  const actions = { onStart: vi.fn(), onMute: vi.fn(), onEnd: vi.fn(), onPlay: vi.fn() };
  const state: VoiceCallState = { ...INITIAL_VOICE_CALL_STATE, phase: "starting" };
  const view = await renderClientComponent(createElement(VoiceCallPanel, { state, ...actions }));
  try {
    expect(view.button.disabled).toBe(true);
    const cancel = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "Cancel")!;
    await act(async () => cancel.click());
    expect(actions.onEnd).toHaveBeenCalledOnce();
    await view.rerender(createElement(VoiceCallPanel, { state: { ...state, phase: "ending" }, ...actions }));
    expect(view.button.disabled).toBe(true);
    expect(view.container.querySelectorAll("button")).toHaveLength(1);
    expect(view.container.textContent).toContain("Your microphone is off.");
    expect(actions.onStart).not.toHaveBeenCalled();
  } finally { await view.cleanup(); }
});
