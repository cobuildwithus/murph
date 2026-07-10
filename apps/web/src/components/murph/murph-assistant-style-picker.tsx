"use client";

import { useId, useState } from "react";
import { CheckIcon, Loader2Icon, MessageCircleIcon, Mic2Icon } from "lucide-react";
import {
  assistantVoiceOptions,
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
import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";
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
}: {
  initialStep?: AssistantStyleStep;
  initialTone?: AssistantTonePreference | null;
  initialVoice?: AssistantVoiceOptionId | null;
  onComplete?: (preferences: MurphAssistantStylePreferences) => void;
  onOpenChange: (open: boolean) => void;
  onSaved?: (preferences: MurphAssistantStylePreferences) => void;
  onSkip?: (step: AssistantStyleStep) => void;
  open: boolean;
}) {
  const isMobile = useIsMobile();
  const groupId = useId();
  const [step, setStep] = useState<AssistantStyleStep>(initialStep);
  const [selectedTone, setSelectedTone] = useState<AssistantTonePreference>(
    initialTone ?? "casual",
  );
  const [selectedVoice, setSelectedVoice] = useState<AssistantVoiceOptionId>(
    initialVoice ?? "classic",
  );
  const [savedPreferences, setSavedPreferences] =
    useState<MurphAssistantStylePreferences>({
      tone: initialTone,
      voice: initialVoice,
    });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAssistantStylePreference(
        step === "tone" ? { tone: selectedTone } : { voice: selectedVoice },
      );
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

  const advanceAfterStep = (preferences: MurphAssistantStylePreferences) => {
    if (step === "tone") {
      setStep("voice");
      return;
    }
    onComplete?.(preferences);
    onOpenChange(false);
  };

  const title = step === "tone" ? "Pick Murph's tone" : "Pick Murph's voice";
  const description = step === "tone"
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
  const chooser = step === "tone" ? (
    <ToneChooser value={selectedTone} onChange={setSelectedTone} />
  ) : (
    <VoiceChooser
      groupId={`murph-voice-${groupId}`}
      value={selectedVoice}
      onChange={setSelectedVoice}
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
        Skip
      </Button>
      <Button
        type="button"
        size="lg"
        onClick={handleContinue}
        disabled={saving}
      >
        {saving ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
        Continue
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[92dvh] max-h-[92dvh]">
          <DrawerHeader className="items-start gap-2 text-left">
            {icon}
            <DrawerTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              {title}
            </DrawerTitle>
            <DrawerDescription className="text-sm leading-6 text-muted-foreground">
              {description}
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1">
            <div className="grid gap-5">
              {chooser}
              {status}
            </div>
          </div>
          <DrawerFooter className="border-t border-border px-4 pb-6 pt-3">
            {actions}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-lg gap-5 rounded-lg border border-border bg-popover p-5 text-popover-foreground ring-border sm:p-6"
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
  onChange,
  value,
}: {
  onChange: (value: AssistantTonePreference) => void;
  value: AssistantTonePreference;
}) {
  const name = useId();

  return (
    <div className="grid gap-2" role="radiogroup" aria-label="Murph tone">
      {TONE_OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              selected
                ? "border-primary bg-primary/10"
                : "border-border bg-background hover:border-primary/45",
            )}
          >
            <input
              checked={selected}
              className="sr-only"
              name={name}
              onChange={() => onChange(option.id)}
              type="radio"
              value={option.id}
            />
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-transparent",
              )}
              aria-hidden="true"
            >
              <CheckIcon className="size-3.5" strokeWidth={2.4} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{option.label}</span>
              <ToneSampleBubble text={option.sample} />
            </span>
          </label>
        );
      })}
    </div>
  );
}

// The homepage phone mock has its own bubble, but it hardcodes the marketing
// palette and a tail SVG sized for that mock. This dialog needs design-system
// tokens, so the sample bubble stays local and deliberately tail-free.
function ToneSampleBubble({ text }: { text: string }) {
  return (
    <span className="block w-fit rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-[0.9375rem] leading-6 text-foreground">
      {text}
    </span>
  );
}

function VoiceChooser({
  groupId,
  onChange,
  value,
}: {
  groupId: string;
  onChange: (value: AssistantVoiceOptionId) => void;
  value: AssistantVoiceOptionId;
}) {
  const name = useId();
  const [filter, setFilter] = useState<AssistantVoiceFilter>("all");
  const visibleOptions = assistantVoiceOptions.filter(
    (option) => filter === "all" || option.gender === filter,
  );
  const selectedOption = assistantVoiceOptions.find((option) => option.id === value) ?? null;
  const selectedOptionVisible = visibleOptions.some((option) => option.id === value);

  return (
    <div className="grid gap-3">
      <div className="sticky top-0 z-10 grid gap-2 bg-popover pb-1 md:static md:bg-transparent md:pb-0">
        <div
          className="grid grid-cols-3 rounded-lg bg-muted p-1"
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
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {visibleOptions.length === 1 ? "1 voice" : `${visibleOptions.length} voices`}
        </p>
      </div>
      {selectedOption && !selectedOptionVisible ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-sm">
          <span className="min-w-0 text-foreground">
            Selected: <span className="font-medium">{selectedOption.label}</span>
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
        The mobile drawer body is already the scroll container, so constraining
        this list only on desktop avoids nesting two scrollers around 22 rows.
      */}
      <div
        className="grid gap-2 md:max-h-[min(52vh,34rem)] md:overflow-y-auto md:pr-1"
        role="radiogroup"
        aria-label="Murph voice"
      >
        {visibleOptions.map((option) => {
          const selected = option.id === value;
          return (
            <div
              key={option.id}
              // The row is a click target so the whole card selects the voice;
              // the player below stops propagation to keep its controls usable.
              onClick={() => onChange(option.id)}
              className={cn(
                "grid cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:border-primary/45",
              )}
            >
              <input
                checked={selected}
                className="peer sr-only"
                id={`${name}-${option.id}`}
                name={name}
                onChange={() => onChange(option.id)}
                type="radio"
                value={option.id}
              />
              <label
                htmlFor={`${name}-${option.id}`}
                className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-md text-left peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block font-serif text-lg font-semibold tracking-normal text-foreground">
                    {option.label}
                  </span>
                  <span className="block text-sm leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-transparent",
                  )}
                  aria-hidden="true"
                >
                  <CheckIcon className="size-3.5" strokeWidth={2.4} />
                </span>
              </label>
              <div
                onClick={(event) => event.stopPropagation()}
                role="presentation"
              >
                <VoiceMemoPlayer
                  src={option.previewPath}
                  bars={24}
                  exclusiveGroupId={groupId}
                  preload="none"
                  unavailableLabel="Pending"
                  containerClassName="rounded-lg bg-background px-3 py-2 ring-1 ring-border"
                  accentClassName="bg-primary"
                  fillClassName="bg-primary"
                  trackClassName="bg-primary/20"
                />
              </div>
            </div>
          );
        })}
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
  preferences: { tone: AssistantTonePreference } | { voice: AssistantVoiceOptionId },
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

function parseAssistantStyleSaveResponse(value: unknown): MurphAssistantStylePreferences {
  if (!isRecord(value)) {
    return {
      tone: null,
      voice: null,
    };
  }

  return {
    tone: isAssistantTonePreference(value.assistantTone) ? value.assistantTone : null,
    voice: isAssistantVoiceOptionId(value.assistantVoice) ? value.assistantVoice : null,
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
    sample:
      "You are up 3 pounds this week, but your sleep is down. Want to work on sleep first?",
  },
  {
    id: "casual",
    label: "Casual",
    sample: "you're up 3 lbs this week but sleep is way down. wanna fix sleep first?",
  },
];
