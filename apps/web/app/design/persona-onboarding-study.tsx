"use client";

import { useState, useSyncExternalStore } from "react";

import {
  MurphPersonaPicker,
  type MurphPersonaPreferences,
} from "@/src/components/murph/murph-persona-picker";
import { Button } from "@/src/components/ui/button";

export function PersonaOnboardingStudy() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [proofClosed, setProofClosed] = useState(false);
  const skipProof = useSyncExternalStore(
    subscribeToStaticDesignProof,
    readSkipProof,
    readServerSkipProof,
  );
  const open = previewOpen || (!proofClosed && skipProof !== "success");

  const setOpen = (nextOpen: boolean) => {
    setPreviewOpen(nextOpen);
    if (!nextOpen) setProofClosed(true);
  };

  return (
    <div id="onboarding-persona-picker" className="scroll-mt-24">
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        The production onboarding step for choosing how Murph shows up. It
        starts with one main personality, adds an optional supporting
        personality, then offers every voice with tailored recommendations
        first and finishes with vertically stacked tone samples.
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
        skipPreference={
          skipProof === "pending"
            ? holdPreviewSkip
            : skipProof === "error"
              ? rejectPreviewSkip
              : preservePreviewSkip
        }
      />
    </div>
  );
}

export function PersonaSettingsStudy() {
  const [open, setOpen] = useState(false);

  return (
    <div id="settings-persona-picker" className="scroll-mt-24">
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        Settings reuses the production personality selector as a focused
        two-step flow. It changes only the main and optional supporting
        personality. Explicit tone and voice choices stay untouched; absent
        overrides follow the selected main personality’s defaults.
      </p>
      <div className="mt-5 flex flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-serif text-xl font-semibold tracking-normal text-foreground">
            Classic + Scientist
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Main personality · optional supporting personality
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Preview only · choices are not saved
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>Edit personality</Button>
      </div>
      {open ? (
        <MurphPersonaPicker
          initialPersona="classic-with-scientist"
          initialTone="formal"
          initialVoice="upbeat"
          mode="personality"
          onOpenChange={setOpen}
          open
          savePreference={preservePreviewPreferences}
        />
      ) : null}
    </div>
  );
}

function preservePreviewPreferences(
  preferences: MurphPersonaPreferences,
): Promise<MurphPersonaPreferences> {
  return Promise.resolve(preferences);
}

function preservePreviewSkip(): Promise<void> {
  return Promise.resolve();
}

function holdPreviewSkip(): Promise<void> {
  return new Promise(() => undefined);
}

function rejectPreviewSkip(): Promise<void> {
  return Promise.reject(new Error("Design proof skip failure"));
}

function subscribeToStaticDesignProof(): () => void {
  return () => undefined;
}

function readSkipProof(): "error" | "pending" | "success" {
  const proof = new URLSearchParams(window.location.search).get(
    "onboardingSkipProof",
  );
  return proof === "error" || proof === "pending" ? proof : "success";
}

function readServerSkipProof(): "success" {
  return "success";
}
