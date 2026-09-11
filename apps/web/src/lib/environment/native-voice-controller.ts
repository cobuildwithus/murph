import { useEffect } from "react";
import type { EnvironmentVoiceTopic } from "@/app/(dashboard)/environment/environment-voice-script";
import { ENVIRONMENT_VOICE_LANGUAGES, type EnvironmentVoiceLanguage } from "@/app/(dashboard)/environment/environment-voice-languages";
import { requestNativeEnvironment } from "./native-voice-bridge";

const languages: EnvironmentVoiceLanguage[] = [
  { code: "auto", label: "Automatic", nativeLabel: "Automatic" },
  ...ENVIRONMENT_VOICE_LANGUAGES,
];
type Controls = {
  start: (retry?: boolean) => Promise<void>;
  back: () => void;
  next: () => void;
  finish: () => void;
  language: (value: EnvironmentVoiceLanguage) => void;
};
type Input = {
  enabled: boolean;
  phase: string;
  topic: EnvironmentVoiceTopic;
  topicIndex: number;
  topicCount: number;
  captured: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  languageCode: string;
  audioNeedsAttention: boolean;
  notice: string | null;
  transcript: string;
  hasAcceptedAnswers: boolean;
  controls: Controls;
};

export function nativeVoiceSnapshot(input: Omit<Input, "enabled" | "controls">) {
  return {
    phase: input.phase, topicIndex: input.topicIndex, topicCount: input.topicCount,
    title: input.topic.title, category: input.topic.eyebrow, prompt: input.topic.prompt,
    fields: (input.topic.focus?.length ? input.topic.fields ?? [] : []).map((field) => {
      const id = `${field.aspectId}.${field.indicatorId}`;
      return { id, label: field.label, status: input.pending.has(id) ? "pending" : input.captured.has(id) ? "saved" : "unknown" };
    }),
    languageCode: input.languageCode,
    languages: languages.map(({ code, label }) => ({ code, label })),
    audioNeedsAttention: input.audioNeedsAttention,
    notice: input.notice, transcript: input.transcript.slice(-1200),
    hasAcceptedAnswers: input.hasAcceptedAnswers,
  };
}

export function dispatchNativeVoiceCommand(detail: unknown, phase: string, controls: Controls) {
  if (!detail || typeof detail !== "object" || !("action" in detail)) return;
  switch (detail.action) {
    case "start":
      if (phase === "idle" || phase === "error") void controls.start(phase === "error");
      break;
    case "back": if (phase === "listening") controls.back(); break;
    case "next": if (phase === "listening") controls.next(); break;
    case "finish": if (phase === "listening") controls.finish(); break;
    case "language": {
      if (phase !== "idle" && phase !== "listening" && phase !== "error") return;
      const language = languages.find((value) => "value" in detail && value.code === detail.value);
      if (language) controls.language(language);
    }
  }
}

export function useNativeVoiceController(input: Input) {
  const serialized = JSON.stringify(nativeVoiceSnapshot(input));
  useEffect(() => {
    if (!input.enabled) return;
    void requestNativeEnvironment("state", serialized).catch(() => {});
  }, [input.enabled, serialized]);
  useEffect(() => {
    if (!input.enabled) return;
    const listener = (event: Event) => {
      if ("detail" in event) dispatchNativeVoiceCommand(event.detail, input.phase, input.controls);
    };
    window.addEventListener("murph-environment-command", listener);
    return () => window.removeEventListener("murph-environment-command", listener);
  }, [input.enabled, input.phase, input.controls]);
}
