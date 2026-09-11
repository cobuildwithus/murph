"use client";

import { useEffect, useState } from "react";
import { EnvironmentVoiceCapture } from "@/app/(dashboard)/environment/environment-voice-capture";
import type { EnvironmentVoiceScript } from "@/app/(dashboard)/environment/environment-voice-script";
import type { EnvironmentVoiceRequest } from "@/src/lib/environment/voice-transport";
import { requestNativeEnvironment } from "@/src/lib/environment/native-voice-bridge";

const requestVoice: EnvironmentVoiceRequest = (operation, body) => requestNativeEnvironment(operation, body);

// This page runs only the shared interview engine. iOS owns all presentation.
export function CompanionEnvironmentVoice() {
  const [script, setScript] = useState<EnvironmentVoiceScript | null>(null);
  useEffect(() => {
    let active = true;
    requestNativeEnvironment("bootstrap").then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const body: { state: string; script?: EnvironmentVoiceScript } = await response.json();
      if (!active) return;
      if (body.state !== "ready" || !body.script?.topics?.length) throw new Error("preparing");
      setScript(body.script);
    }).catch(() => {
      if (active) void requestNativeEnvironment("state", JSON.stringify({ phase: "unavailable" })).catch(() => {});
    });
    return () => { active = false; };
  }, []);
  return script ? <EnvironmentVoiceCapture
    apiRequest={requestVoice}
    native
    script={script}
    onClosed={() => { void requestNativeEnvironment("close").catch(() => {}); }}
  /> : null;
}
