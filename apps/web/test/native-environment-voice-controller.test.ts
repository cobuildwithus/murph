import { buildEnvironmentVoiceScript } from "@/app/(dashboard)/environment/environment-voice-script";
import { listEnvironmentInterviewFields, HABITAT_DECLINED_VALUE } from "@murphai/contracts";
import { expect, test, vi } from "vitest";
import { nativeVoiceSnapshot, dispatchNativeVoiceCommand } from "@/src/lib/environment/native-voice-controller";
const controls = () => ({ start: vi.fn(async () => {}), back: vi.fn(), next: vi.fn(), finish: vi.fn(), language: vi.fn() });
test("native Finish uses canonical completion and cannot interrupt a save", () => {
  const handlers = controls();
  dispatchNativeVoiceCommand({ action: "finish" }, "saving", handlers);
  expect(handlers.finish).not.toHaveBeenCalled();
  dispatchNativeVoiceCommand({ action: "finish" }, "listening", handlers);
  expect(handlers.finish).toHaveBeenCalledOnce();
});
test("native start, retry and language choices stay within supported operations", () => {
  const handlers = controls();
  dispatchNativeVoiceCommand({ action: "start" }, "idle", handlers);
  dispatchNativeVoiceCommand({ action: "start" }, "connecting", handlers);
  dispatchNativeVoiceCommand({ action: "start" }, "error", handlers);
  expect(handlers.start.mock.calls).toEqual([[false], [true]]);
  dispatchNativeVoiceCommand({ action: "language", value: "en" }, "idle", handlers);
  dispatchNativeVoiceCommand({ action: "language", value: "invented" }, "idle", handlers);
  expect(handlers.language).toHaveBeenCalledOnce();
  dispatchNativeVoiceCommand({ action: "next" }, "finishing", handlers);
  expect(handlers.next).not.toHaveBeenCalled();
});
test("native questions reflect confirmed writes and bound the live transcript", () => {
  const snapshot = nativeVoiceSnapshot({
    phase: "listening", topicIndex: 0, topicCount: 2, languageCode: "auto", notice: null,
    transcript: "x".repeat(2000), hasAcceptedAnswers: false, audioNeedsAttention: true,
    captured: new Set(["sleep.darkness"]), pending: new Set(["sleep.noise"]),
    topic: { id: "sleep:0", eyebrow: "Sleep", title: "Bedroom", focus: ["Darkness", "Noise"], fields: [
      { aspectId: "sleep", indicatorId: "darkness", label: "Darkness", valueType: { kind: "text", maxLength: 400 } },
      { aspectId: "sleep", indicatorId: "noise", label: "Noise", valueType: { kind: "text", maxLength: 400 } },
    ] },
  });
  expect(snapshot.fields.map((field) => field.status)).toEqual(["saved", "pending"]);
  expect(snapshot.transcript).toHaveLength(1200);
  expect(snapshot.audioNeedsAttention).toBe(true);
  expect(snapshot.languages[0]?.code).toBe("auto");
});

test("completed audits retain the canonical update prompt without a full catalog checklist", () => {
  const values: Record<string, Record<string, string>> = {};
  for (const { aspectId, indicator } of listEnvironmentInterviewFields("update")) {
    (values[aspectId] ??= {})[indicator.id] = HABITAT_DECLINED_VALUE;
  }
  const script = buildEnvironmentVoiceScript(values);
  expect(script.flow).toBe("update");
  expect(script.topics[0].fields!.length).toBeGreaterThan(12);
  const snapshot = nativeVoiceSnapshot({
    phase: "idle", topicIndex: 0, topicCount: 1, languageCode: "auto", notice: null,
    transcript: "", hasAcceptedAnswers: false, audioNeedsAttention: true, captured: new Set(), pending: new Set(), topic: script.topics[0],
  });
  expect(snapshot.prompt).toBe(script.topics[0].prompt);
  expect(snapshot.fields).toEqual([]);
});
