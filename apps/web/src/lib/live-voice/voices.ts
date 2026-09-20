// New voices: https://developers.openai.com/api/docs/guides/live-conversations.
// Existing voices: https://developers.openai.com/api/docs/guides/realtime-conversations#voice-options.
// The existing female selections were also verified with GPT-Live session startup.
export const LIVE_VOICES = [
  { id: "gleam", name: "Gleam", accent: "North American" },
  { id: "marin", name: "Marin", accent: "Original GPT-Live voice" },
  { id: "willow", name: "Willow", accent: "Irish" },
  { id: "quartz", name: "Quartz", accent: "Australian" },
  { id: "delta", name: "Delta", accent: "Southern U.S." },
  { id: "coral", name: "Coral", accent: "English" },
  { id: "sage", name: "Sage", accent: "English" },
  { id: "shimmer", name: "Shimmer", accent: "English" },
  { id: "bossa", name: "Bossa", accent: "Brazilian Portuguese" },
] as const;

export type LiveVoice = typeof LIVE_VOICES[number]["id"];
export const DEFAULT_LIVE_VOICE: LiveVoice = "gleam";

export function isLiveVoice(value: unknown): value is LiveVoice {
  return LIVE_VOICES.some((voice) => voice.id === value);
}
