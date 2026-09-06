"use client";

import { useEffect, useState } from "react";
import { EnvironmentVoiceCapture } from "@/app/(dashboard)/environment/environment-voice-capture";
import type { EnvironmentVoiceScript } from "@/app/(dashboard)/environment/environment-voice-script";
import type { EnvironmentVoiceRequest } from "@/src/lib/environment/voice-transport";
import { requestNativeEnvironment } from "@/src/lib/environment/native-voice-bridge";
import { Button } from "@/src/components/ui/button";

const requestVoice: EnvironmentVoiceRequest = (operation, body) => requestNativeEnvironment(operation, body);

export function CompanionEnvironmentVoice() {
  const [script, setScript] = useState<EnvironmentVoiceScript | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    requestNativeEnvironment("bootstrap").then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const body: { state: string; script?: EnvironmentVoiceScript } = await response.json();
      if (!active) return;
      if (body.state !== "ready" || !body.script?.topics?.length) {
        setNotice("Your report is being prepared. Try again in a moment.");
        return;
      }
      setScript(body.script);
    }).catch(() => {
      if (active) setNotice("Couldn't open the interview. Try again.");
    });
    return () => { active = false; };
  }, [attempt]);

  return <main className="min-h-dvh bg-background p-6 text-foreground">
    {script ? <EnvironmentVoiceCapture
      apiRequest={requestVoice}
      embedded
      script={script}
      showTrigger={false}
      onClosed={() => { void requestNativeEnvironment("close").catch(() => {}); }}
    /> : <div className="space-y-4 pt-8">
      <p role="status">{notice ?? "Opening your interview…"}</p>
      {notice ? <Button onClick={() => { setNotice(null); setAttempt((value) => value + 1); }}>Try again</Button> : null}
      <Button variant="ghost" onClick={() => { void requestNativeEnvironment("close").catch(() => {}); }}>Close</Button>
    </div>}
  </main>;
}
