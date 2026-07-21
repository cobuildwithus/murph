"use client";

import {
  assistantPersonaOptions,
  resolveAssistantPersonaOption,
  resolveAssistantPersonaRecommendedVoiceOptions,
  type AssistantPersonaId,
  type AssistantVoiceOption,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";
import { CheckIcon, Loader2Icon, Mic2Icon, UsersIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/src/components/ui/drawer";
import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";
import { useIsMobile } from "@/src/hooks/use-mobile";
import { cn } from "@/src/lib/utils";

export interface MurphPersonaPreferences {
  persona: AssistantPersonaId;
  tone: AssistantTonePreference;
  voice: AssistantVoiceOptionId;
}

export function MurphPersonaPicker({
  initialPersona = "classic",
  initialTone,
  initialVoice,
  onComplete,
  onOpenChange,
  onSaved,
  onSkip,
  open,
  savePreference = saveAssistantPersonaPreference,
}: {
  initialPersona?: AssistantPersonaId;
  initialTone?: AssistantTonePreference | null;
  initialVoice?: AssistantVoiceOptionId | null;
  onComplete?: (preferences: MurphPersonaPreferences | null) => void;
  onOpenChange: (open: boolean) => void;
  onSaved?: (preferences: MurphPersonaPreferences) => void;
  onSkip?: () => void;
  open: boolean;
  savePreference?: typeof saveAssistantPersonaPreference;
}) {
  const isMobile = useIsMobile();
  const personaGroupId = useId();
  const toneGroupId = useId();
  const voiceGroupId = useId();
  const initialOption = resolveAssistantPersonaOption(initialPersona);
  const [persona, setPersona] = useState<AssistantPersonaId>(initialOption.id);
  const [tone, setTone] = useState<AssistantTonePreference>(
    initialTone ?? initialOption.defaultTone,
  );
  const [voice, setVoice] = useState<AssistantVoiceOptionId>(
    initialVoice ?? initialOption.defaultVoiceId,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selected = resolveAssistantPersonaOption(persona);
  const voices = resolveAssistantPersonaRecommendedVoiceOptions(selected.id).map(
    (option) => ({
      ...option,
      previewPath: `/audio/murph-personas/${selected.id}/${option.id}.mp3`,
    }),
  );

  const selectPersona = (nextPersona: AssistantPersonaId) => {
    const next = resolveAssistantPersonaOption(nextPersona);
    setPersona(next.id);
    setTone(next.defaultTone);
    setVoice(next.defaultVoiceId);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await savePreference({ persona, tone, voice });
      if (!mountedRef.current) return;
      onSaved?.(saved);
      onComplete?.(saved);
      onOpenChange(false);
    } catch {
      if (mountedRef.current) {
        setError("Could not save your Murph. Your choices are still here. Try again.");
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleSkip = () => {
    setError(null);
    onSkip?.();
    onComplete?.(null);
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && saving) return;
    onOpenChange(nextOpen);
  };

  const content = (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-2 md:px-0">
      <fieldset>
        <legend className="sr-only">Murph persona</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {assistantPersonaOptions.map((option) => {
            const checked = option.id === persona;
            const inputId = `${personaGroupId}-${option.id}`;
            return (
              <label key={option.id} htmlFor={inputId} className="cursor-pointer">
                <input
                  checked={checked}
                  className="peer sr-only"
                  disabled={saving}
                  id={inputId}
                  name={personaGroupId}
                  onChange={() => selectPersona(option.id)}
                  type="radio"
                  value={option.id}
                />
                <span
                  className={cn(
                    "flex min-h-28 flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
                    checked
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:border-primary/45",
                  )}
                >
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="font-serif text-base/5 font-semibold text-foreground">
                      {option.label}
                    </span>
                    <SelectedCheck selected={checked} />
                  </span>
                  <span className="text-sm leading-5 text-muted-foreground">
                    {option.sample}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <p className="font-serif text-lg font-semibold text-foreground">
          {selected.label}
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {selected.description}
        </p>
        <p className="mt-3 rounded-lg bg-background p-3 text-sm leading-6 text-foreground ring-1 ring-border">
          “{selected.previewText}”
        </p>
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">Text style</legend>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["formal", "Standard", "Normal capitalization."],
            ["casual", "Lowercase", "Relaxed, lowercase messages."],
          ] as const).map(([id, label, description]) => {
            const inputId = `${toneGroupId}-${id}`;
            return (
              <label key={id} htmlFor={inputId} className="cursor-pointer">
                <input
                  checked={tone === id}
                  className="peer sr-only"
                  disabled={saving}
                  id={inputId}
                  name={toneGroupId}
                  onChange={() => setTone(id)}
                  type="radio"
                  value={id}
                />
                <span
                  className={cn(
                    "block rounded-lg border p-3 text-left peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
                    tone === id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background",
                  )}
                >
                  <span className="block text-sm font-medium text-foreground">
                    {label}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Mic2Icon className="size-4" aria-hidden="true" /> Voice
        </legend>
        <p className="text-sm leading-5 text-muted-foreground">
          Preview voices that fit {selected.label}.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {voices.map((option) => (
            <PersonaVoiceCard
              key={option.id}
              disabled={saving}
              groupId={voiceGroupId}
              option={option}
              selected={voice === option.id}
              onSelect={() => setVoice(option.id)}
            />
          ))}
        </div>
      </fieldset>

    </div>
  );

  const actions = (
    <div className="flex flex-col gap-2">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          variant="ghost"
          disabled={saving}
          onClick={handleSkip}
        >
          Skip
        </Button>
        <Button
          type="button"
          size="lg"
          aria-busy={saving}
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? (
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
          ) : null}
          {saving ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );

  const icon = (
    <div
      aria-hidden="true"
      className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
    >
      <UsersIcon className="size-5" strokeWidth={1.8} />
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="h-dvh data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-dvh data-[vaul-drawer-direction=bottom]:rounded-t-none">
          <DrawerHeader className="items-start gap-2 pb-3 text-left">
            {icon}
            <DrawerTitle className="font-serif text-2xl/7 font-semibold">
              Who do you want in your corner?
            </DrawerTitle>
            <DrawerDescription className="text-sm leading-6">
              Choose how Murph should show up. You can fine-tune the writing
              style, voice, and personality later.
            </DrawerDescription>
          </DrawerHeader>
          {content}
          <DrawerFooter className="border-t border-border px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-3">
            {actions}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-5 overflow-hidden p-6 sm:max-w-4xl"
      >
        <DialogHeader className="gap-2 text-left">
          {icon}
          <DialogTitle className="font-serif text-2xl/7 font-semibold">
            Who do you want in your corner?
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            Choose how Murph should show up. You can fine-tune the writing
            style, voice, and personality later.
          </DialogDescription>
        </DialogHeader>
        {content}
        {actions}
      </DialogContent>
    </Dialog>
  );
}

function PersonaVoiceCard({
  disabled,
  groupId,
  onSelect,
  option,
  selected,
}: {
  disabled: boolean;
  groupId: string;
  onSelect: () => void;
  option: AssistantVoiceOption & { previewPath: string };
  selected: boolean;
}) {
  const inputId = useId();

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-background hover:border-primary/45",
      )}
    >
      <input
        checked={selected}
        className="peer sr-only"
        disabled={disabled}
        id={inputId}
        name={groupId}
        onChange={onSelect}
        type="radio"
        value={option.id}
      />
      <label
        htmlFor={inputId}
        className="flex cursor-pointer items-start justify-between gap-2 rounded-md peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
      >
        <span>
          <span className="block font-serif text-base/5 font-semibold text-foreground">
            {option.label}
          </span>
          <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">
            {option.description}
          </span>
        </span>
        <SelectedCheck selected={selected} />
      </label>
      <div>
        <VoiceMemoPlayer
          src={option.previewPath}
          fallbackSrc={`/audio/murph-voices/${option.id}.mp3`}
          bars={12}
          exclusiveGroupId={groupId}
          preload="metadata"
          unavailableLabel="Preview unavailable"
          containerClassName="rounded-lg bg-background px-2.5 py-1.5 ring-1 ring-border"
          accentClassName="bg-primary"
          fillClassName="bg-primary"
          trackClassName="bg-primary/20"
        />
      </div>
    </div>
  );
}

function SelectedCheck({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-transparent",
      )}
    >
      <CheckIcon className="size-3" strokeWidth={2.4} />
    </span>
  );
}

async function saveAssistantPersonaPreference(
  preferences: MurphPersonaPreferences,
): Promise<MurphPersonaPreferences> {
  const response = await fetch("/api/settings/assistant-style", {
    body: JSON.stringify(preferences),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("Assistant persona save failed.");
  const body: unknown = await response.json();
  if (
    !isRecord(body)
    || body.assistantPersona !== preferences.persona
    || body.assistantTone !== preferences.tone
    || body.assistantVoice !== preferences.voice
  ) {
    throw new Error("Assistant persona save response was invalid.");
  }
  return preferences;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
