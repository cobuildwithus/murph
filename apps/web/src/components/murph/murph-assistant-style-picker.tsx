"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CheckIcon,
  Loader2Icon,
  MessageCircleIcon,
  Mic2Icon,
} from "lucide-react";
import {
  assistantVoiceOptions,
  defaultAssistantTonePreference,
  defaultAssistantVoiceOptionId,
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  type AssistantTonePreference,
  type AssistantVoiceGender,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";

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
import {
  VoiceMemoPlayer,
  type VoiceMemoPlayerHandle,
} from "@/src/components/ui/voice-memo-player";
import { useIsMobile } from "@/src/hooks/use-mobile";
import { cn } from "@/src/lib/utils";

type AssistantStyleStep = "tone" | "voice";

export interface MurphAssistantStylePreferences {
  tone: AssistantTonePreference | null;
  voice: AssistantVoiceOptionId | null;
}

export function MurphAssistantStylePicker({
  initialStep = "tone",
  initialTone = null,
  initialVoice = null,
  onComplete,
  onOpenChange,
  onSaved,
  onSkip,
  open,
  savePreference = saveAssistantStylePreference,
  singleStep = false,
}: {
  initialStep?: AssistantStyleStep;
  initialTone?: AssistantTonePreference | null;
  initialVoice?: AssistantVoiceOptionId | null;
  onComplete?: (preferences: MurphAssistantStylePreferences) => void;
  onOpenChange: (open: boolean) => void;
  onSaved?: (preferences: MurphAssistantStylePreferences) => void;
  onSkip?: (step: AssistantStyleStep) => void;
  open: boolean;
  // The design showcase injects a non-persisting save; everywhere else the
  // default posts to the settings endpoint.
  savePreference?: typeof saveAssistantStylePreference;
  // Settings rows open one step at a time; onboarding keeps the tone → voice chain.
  singleStep?: boolean;
}) {
  const isMobile = useIsMobile();
  const groupId = useId();
  const [step, setStep] = useState<AssistantStyleStep>(initialStep);
  const [selectedTone, setSelectedTone] = useState<AssistantTonePreference>(
    initialTone ?? defaultAssistantTonePreference,
  );
  const [selectedVoice, setSelectedVoice] = useState<AssistantVoiceOptionId>(
    initialVoice ?? defaultAssistantVoiceOptionId,
  );
  const [savedPreferences, setSavedPreferences] =
    useState<MurphAssistantStylePreferences>({
      tone: initialTone,
      voice: initialVoice,
    });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dismissing the dialog unmounts this component while a save may still be in
  // flight; a completion arriving after that must not fire callbacks that the
  // parent would attribute to a newer picker instance.
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleContinue = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await savePreference(
        step === "tone" ? { tone: selectedTone } : { voice: selectedVoice },
      );
      if (!mountedRef.current) {
        return;
      }
      setSavedPreferences(saved);
      onSaved?.(saved);
      advanceAfterStep(saved);
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    setError(null);
    onSkip?.(step);
    advanceAfterStep(savedPreferences);
  };

  // While a save is in flight, Escape/backdrop/swipe dismissal would unmount
  // the picker and orphan the request's result; keep the picker open until the
  // save settles so success stays attributable to this instance.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && saving) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const advanceAfterStep = (preferences: MurphAssistantStylePreferences) => {
    if (!singleStep && step === "tone") {
      setStep("voice");
      return;
    }
    onComplete?.(preferences);
    onOpenChange(false);
  };

  const title = step === "tone" ? "Pick Murph's tone" : "Pick Murph's voice";
  const description =
    step === "tone"
      ? "Which sounds more like you?"
      : "Tap to hear each one. This is how Murph sounds in voice memos.";
  const icon = (
    <div
      aria-hidden="true"
      className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
    >
      {step === "tone" ? (
        <MessageCircleIcon className="size-5" strokeWidth={1.8} />
      ) : (
        <Mic2Icon className="size-5" strokeWidth={1.8} />
      )}
    </div>
  );
  // Save captures the selection when clicked; freezing the choosers while the
  // request is in flight keeps what persists, what is shown, and what the
  // post-save chat handoff demonstrates identical.
  const chooser =
    step === "tone" ? (
      <ToneChooser
        value={selectedTone}
        onChange={setSelectedTone}
        disabled={saving}
      />
    ) : (
      <VoiceChooser
        groupId={`murph-voice-${groupId}`}
        value={selectedVoice}
        onChange={setSelectedVoice}
        disabled={saving}
      />
    );
  const status = error ? (
    <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  ) : null;
  const actions = (
    <div className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        size="lg"
        variant="ghost"
        onClick={handleSkip}
        disabled={saving}
      >
        {singleStep ? "Cancel" : "Skip"}
      </Button>
      <Button
        type="button"
        size="lg"
        onClick={handleContinue}
        disabled={saving}
      >
        {saving ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : null}
        {singleStep ? "Save" : "Continue"}
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="h-dvh data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-dvh data-[vaul-drawer-direction=bottom]:rounded-t-none">
          <DrawerHeader className="items-start gap-2 pb-3 text-left">
            {icon}
            <DrawerTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              {title}
            </DrawerTitle>
            <DrawerDescription className="text-sm leading-6 text-muted-foreground">
              {description}
            </DrawerDescription>
          </DrawerHeader>
          {/*
            The voice chooser owns its own scrolling grid; the tone step has no
            inner scroller, so the body itself must contain overflow on short
            or text-zoomed viewports.
          */}
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-3 px-4",
              step === "tone" && "overflow-y-auto",
            )}
          >
            {chooser}
            {status}
          </div>
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
        className={cn(
          "max-h-[calc(100dvh-2rem)] gap-5 rounded-lg border border-border bg-popover p-5 text-popover-foreground ring-border sm:p-6",
          // The voice grid is the dialog's only scroller; the short tone step
          // scrolls as a whole on very short viewports instead.
          step === "voice"
            ? "flex flex-col overflow-hidden sm:max-w-2xl lg:max-w-3xl"
            : "overflow-y-auto sm:max-w-xl",
        )}
      >
        <DialogHeader className="gap-2 text-left">
          {icon}
          <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>

        {chooser}
        {status}
        {actions}
      </DialogContent>
    </Dialog>
  );
}

function ToneChooser({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: AssistantTonePreference) => void;
  value: AssistantTonePreference;
}) {
  const name = useId();

  return (
    <div
      className="grid gap-2 sm:grid-cols-2"
      role="radiogroup"
      aria-label="Murph tone"
    >
      {TONE_OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer flex-col gap-3 rounded-xl border p-4 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              selected
                ? "border-primary bg-primary/10"
                : "border-border bg-background hover:border-primary/45",
            )}
          >
            <input
              checked={selected}
              className="sr-only"
              disabled={disabled}
              name={name}
              onChange={() => onChange(option.id)}
              type="radio"
              value={option.id}
            />
            <span className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
                {option.label}
              </span>
              <SelectedCheck selected={selected} />
            </span>
            <span className="text-[0.9375rem] leading-6 text-foreground">
              {option.sample}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function SelectedCheck({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-transparent",
      )}
      aria-hidden="true"
    >
      <CheckIcon className="size-3" strokeWidth={2.4} />
    </span>
  );
}

function VoiceChooser({
  disabled = false,
  groupId,
  onChange,
  value,
}: {
  disabled?: boolean;
  groupId: string;
  onChange: (value: AssistantVoiceOptionId) => void;
  value: AssistantVoiceOptionId;
}) {
  const name = useId();
  const [filter, setFilter] = useState<AssistantVoiceFilter>("all");
  const visibleOptions = assistantVoiceOptions.filter(
    (option) => filter === "all" || option.gender === filter,
  );
  const selectedOption =
    assistantVoiceOptions.find((option) => option.id === value) ?? null;
  const selectedOptionVisible = visibleOptions.some(
    (option) => option.id === value,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-3">
        <div
          className="grid flex-1 grid-cols-3 rounded-lg bg-muted p-1"
          role="group"
          aria-label="Filter Murph voices"
        >
          {VOICE_FILTER_OPTIONS.map((option) => {
            const selected = option.id === filter;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={cn(
                  "min-h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={selected}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p
          aria-live="polite"
          className="shrink-0 text-xs text-muted-foreground"
        >
          {visibleOptions.length === 1
            ? "1 voice"
            : `${visibleOptions.length} voices`}
        </p>
      </div>
      {selectedOption && !selectedOptionVisible ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-sm">
          <span className="min-w-0 text-foreground">
            Selected:{" "}
            <span className="font-medium">{selectedOption.label}</span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setFilter("all")}
            className="shrink-0"
          >
            Show all
          </Button>
        </div>
      ) : null}
      {/*
        The grid is the single scroll container: it fills the full-height
        drawer on mobile and is height-capped inside the desktop dialog.
      */}
      <div
        className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto pb-1 md:max-h-[min(56vh,34rem)] md:grid-cols-3 md:pr-1"
        role="radiogroup"
        aria-label="Murph voice"
      >
        {visibleOptions.map((option) => (
          <VoiceCard
            key={option.id}
            disabled={disabled}
            groupId={groupId}
            name={name}
            onSelect={() => onChange(option.id)}
            option={option}
            selected={option.id === value}
          />
        ))}
      </div>
    </div>
  );
}

function VoiceCard({
  disabled,
  groupId,
  name,
  onSelect,
  option,
  selected,
}: {
  disabled: boolean;
  groupId: string;
  name: string;
  onSelect: () => void;
  option: (typeof assistantVoiceOptions)[number];
  selected: boolean;
}) {
  const playerRef = useRef<VoiceMemoPlayerHandle | null>(null);

  return (
    <div
      // The whole card is a click target: selecting a voice also previews it,
      // so clicking anywhere on the card plays it, not just the play button.
      // The player below stops propagation to keep its own controls usable.
      onClick={() => {
        if (disabled) return;
        onSelect();
        playerRef.current?.play();
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-background hover:border-primary/45",
      )}
    >
      <input
        checked={selected}
        className="peer sr-only"
        disabled={disabled}
        id={`${name}-${option.id}`}
        name={name}
        onChange={onSelect}
        type="radio"
        value={option.id}
      />
      <label
        htmlFor={`${name}-${option.id}`}
        className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-2 rounded-md text-left peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block font-serif text-base/5 font-semibold tracking-normal text-foreground">
            {option.label}
          </span>
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
            {option.description}
          </span>
        </span>
        <SelectedCheck selected={selected} />
      </label>
      <div
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) {
            onSelect();
          }
        }}
        role="presentation"
      >
        <VoiceMemoPlayer
          ref={playerRef}
          src={option.previewPath}
          exclusiveGroupId={groupId}
          preload="none"
          unavailableLabel="Pending"
          containerClassName="rounded-lg bg-background px-2.5 py-1.5 ring-1 ring-border"
          accentClassName="bg-primary"
          fillClassName="bg-primary"
          trackClassName="bg-primary/20"
        />
      </div>
    </div>
  );
}

type AssistantVoiceFilter = "all" | AssistantVoiceGender;

const VOICE_FILTER_OPTIONS: ReadonlyArray<{
  id: AssistantVoiceFilter;
  label: string;
}> = [
  {
    id: "all",
    label: "All",
  },
  {
    id: "male",
    label: "Male",
  },
  {
    id: "female",
    label: "Female",
  },
];

async function saveAssistantStylePreference(
  preferences:
    { tone: AssistantTonePreference } | { voice: AssistantVoiceOptionId },
): Promise<MurphAssistantStylePreferences> {
  const response = await fetch("/api/settings/assistant-style", {
    body: JSON.stringify(preferences),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Assistant style save failed.");
  }

  return parseAssistantStyleSaveResponse(await response.json());
}

function parseAssistantStyleSaveResponse(
  value: unknown,
): MurphAssistantStylePreferences {
  if (!isRecord(value)) {
    return {
      tone: null,
      voice: null,
    };
  }

  return {
    tone: isAssistantTonePreference(value.assistantTone)
      ? value.assistantTone
      : null,
    voice: isAssistantVoiceOptionId(value.assistantVoice)
      ? value.assistantVoice
      : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

// Each option shows the same message written in that tone, so the member picks
// by reading what Murph would actually text rather than by reading a label.
const TONE_OPTIONS: ReadonlyArray<{
  id: AssistantTonePreference;
  label: string;
  sample: string;
}> = [
  {
    id: "formal",
    label: "Formal",
    sample: "Your sleep is down this week. Want to work on sleep first?",
  },
  {
    id: "casual",
    label: "Casual",
    sample: "sleep is way down this week. wanna fix sleep first?",
  },
];
