// English voices documented at https://developers.openai.com/api/docs/guides/live-conversations.
export const LIVE_VOICES = [
  { id: "gleam", name: "Gleam", group: "female", accent: "North American" },
  { id: "willow", name: "Willow", group: "female", accent: "Irish" },
  { id: "quartz", name: "Quartz", group: "female", accent: "Australian" },
  { id: "delta", name: "Delta", group: "female", accent: "Southern U.S." },
  { id: "meridian", name: "Meridian", group: "male", accent: "North American" },
  { id: "vesper", name: "Vesper", group: "male", accent: "British" },
  { id: "ripple", name: "Ripple", group: "male", accent: "Australian" },
  { id: "stone", name: "Stone", group: "male", accent: "Irish" },
  { id: "beacon", name: "Beacon", group: "male", accent: "Filipino" },
  { id: "cinder", name: "Cinder", group: "male", accent: "Southern U.S." },
] as const;

export type LiveVoice = typeof LIVE_VOICES[number]["id"];
export const DEFAULT_LIVE_VOICE: LiveVoice = "gleam";

export function isLiveVoice(value: unknown): value is LiveVoice {
  return LIVE_VOICES.some((voice) => voice.id === value);
}
