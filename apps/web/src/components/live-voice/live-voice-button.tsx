"use client";

import { useState } from "react";
import { DEFAULT_LIVE_VOICE, type LiveVoice } from "@/src/lib/live-voice/voices";
import { LiveVoiceControl, type LiveVoiceControlProps } from "./live-voice-control";
import { LiveVoicePicker } from "./live-voice-picker";
import { useLiveVoice } from "./use-live-voice";

export type LiveVoiceButtonProps = Pick<LiveVoiceControlProps, "size" | "palette" | "className"> & {
  /** Same-origin server route returning an SDP answer; never a provider API key. */
  endpoint: string;
  defaultVoice?: LiveVoice;
  showVoicePicker?: boolean;
};

/** Drop-in connected control. The supplied endpoint owns admission and usage. */
export function LiveVoiceButton({ endpoint, showVoicePicker = false, defaultVoice = DEFAULT_LIVE_VOICE, ...appearance }: LiveVoiceButtonProps) {
  const [voice, setVoice] = useState<LiveVoice>(defaultVoice);
  const { snapshot, toggle, end, canChangeVoice } = useLiveVoice({ endpoint, voice });
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <LiveVoiceControl {...appearance} {...snapshot} onToggle={toggle} onEnd={end} />
      {showVoicePicker ? <LiveVoicePicker voice={voice} onChange={setVoice} disabled={!canChangeVoice} /> : null}
    </div>
  );
}
