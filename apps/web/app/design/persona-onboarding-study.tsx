"use client";

import { useState } from "react";

import {
  MurphPersonaPicker,
  type MurphPersonaPreferences,
} from "@/src/components/murph/murph-persona-picker";
import { Button } from "@/src/components/ui/button";

export function PersonaOnboardingStudy() {
  const [open, setOpen] = useState(false);

  return (
    <div id="onboarding-persona-picker" className="scroll-mt-24">
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        The production onboarding step for choosing how Murph shows up. It
        starts with one main personality, adds an optional supporting
        personality, then offers every voice with tailored recommendations
        first.
      </p>

      <div className="mt-5 flex flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-serif text-xl font-semibold tracking-normal text-foreground">
            Who do you want in your corner?
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            6 personalities · optional supporting influence · 22 voices · 2
            tones
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Preview only · choices are not saved
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>Preview onboarding</Button>
      </div>

      <MurphPersonaPicker
        onOpenChange={setOpen}
        open={open}
        savePreference={preservePreviewPreferences}
      />
    </div>
  );
}

function preservePreviewPreferences(
  preferences: MurphPersonaPreferences,
): Promise<MurphPersonaPreferences> {
  return Promise.resolve(preferences);
}
