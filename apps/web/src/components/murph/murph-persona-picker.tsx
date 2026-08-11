"use client";

import {
  assistantBasePersonaOptions,
  assistantVoiceOptions,
  resolveAssistantBasePersonaOption,
  resolveAssistantPersonaCombinationId,
  resolveAssistantPersonaParts,
  resolveAssistantPersonaRecommendedVoiceOptions,
  type AssistantBasePersonaId,
  type AssistantBasePersonaOption,
  type AssistantPersonaId,
  type AssistantVoiceOption,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { MurphPersonaGlyph } from "@/src/components/murph/murph-persona-glyph";
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

export interface MurphPersonaPreferences {
  persona: AssistantPersonaId;
  tone: AssistantTonePreference;
  voice: AssistantVoiceOptionId;
}

type PersonaPickerStep = "main" | "supporting" | "voices" | "tone";
type PersonaPickerOperation = "save" | "skip";
export type MurphPersonaPickerMode = "onboarding" | "personality";

export function MurphPersonaPicker({
  initialPersona = "classic",
  initialTone,
  initialVoice,
  mode = "onboarding",
  onComplete,
  onOpenChange,
  onSaved,
  onSkip,
  open,
  savePreference = saveAssistantPersonaPreference,
  skipPreference,
}: {
  initialPersona?: AssistantPersonaId;
  initialTone?: AssistantTonePreference | null;
  initialVoice?: AssistantVoiceOptionId | null;
  mode?: MurphPersonaPickerMode;
  onComplete?: (preferences: MurphPersonaPreferences | null) => void;
  onOpenChange: (open: boolean) => void;
  onSaved?: (preferences: MurphPersonaPreferences) => void;
  onSkip?: () => void;
  open: boolean;
  savePreference?: typeof saveAssistantPersonaPreference;
  skipPreference?: () => Promise<void>;
}) {
  const isMobile = useIsMobile();
  const mainPersonaGroupId = useId();
  const supportingPersonaGroupId = useId();
  const toneGroupId = useId();
  const voicePreviewGroupId = useId();
  const initialPersonaParts = resolveAssistantPersonaParts(initialPersona);
  const initialOption = resolveAssistantBasePersonaOption(initialPersonaParts.mainId);
  const [step, setStep] = useState<PersonaPickerStep>("main");
  const [persona, setPersona] = useState<AssistantBasePersonaId>(
    initialPersonaParts.mainId,
  );
  const [supportingPersona, setSupportingPersona] =
    useState<AssistantBasePersonaId | null>(initialPersonaParts.supportingId);
  const [tone, setTone] = useState<AssistantTonePreference>(
    initialTone ?? initialOption.defaultTone,
  );
  const [voice, setVoice] = useState<AssistantVoiceOptionId>(
    initialVoice ?? initialOption.defaultVoiceId,
  );
  const [pendingOperation, setPendingOperation] =
    useState<PersonaPickerOperation | null>(null);
  const [failedOperation, setFailedOperation] =
    useState<PersonaPickerOperation | null>(null);
  const mountedRef = useRef(false);
  const stepTitleRef = useRef<HTMLDivElement | null>(null);
  const previousStepRef = useRef<PersonaPickerStep>(step);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      previousStepRef.current = step;
      return;
    }
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    stepTitleRef.current?.focus({ preventScroll: true });
  }, [open, step]);

  const selectedPersona = resolveAssistantBasePersonaOption(persona);
  const selectedSupportingPersona = supportingPersona
    ? resolveAssistantBasePersonaOption(supportingPersona)
    : null;
  const supportingPersonaOptions = assistantBasePersonaOptions.filter(
    (option) => option.id !== persona,
  );
  const recommendedVoiceOptions =
    resolveAssistantPersonaRecommendedVoiceOptions(persona).map((option) => ({
      ...option,
      previewPath: `/audio/murph-personas/${persona}/${option.id}.mp3`,
    }));
  const recommendedVoiceIds = new Set(
    recommendedVoiceOptions.map((option) => option.id),
  );
  const otherVoiceOptions = assistantVoiceOptions
    .filter((option) => !recommendedVoiceIds.has(option.id))
    .map((option) => ({ ...option, previewPath: option.previewPath }));
  const saving = pendingOperation !== null;

  const selectPersona = (nextPersona: AssistantBasePersonaId) => {
    const next = resolveAssistantBasePersonaOption(nextPersona);
    setPersona(nextPersona);
    if (supportingPersona === next.id) setSupportingPersona(null);
    if (mode === "onboarding") {
      setTone(next.defaultTone);
      setVoice(next.defaultVoiceId);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setPendingOperation("save");
    setFailedOperation(null);
    try {
      const saved = await savePreference({
        persona: resolveAssistantPersonaCombinationId(persona, supportingPersona),
        tone,
        voice,
      });
      if (!mountedRef.current) return;
      onSaved?.(saved);
      onComplete?.(saved);
      setStep("main");
      onOpenChange(false);
    } catch {
      if (mountedRef.current) {
        setFailedOperation("save");
      }
    } finally {
      if (mountedRef.current) setPendingOperation(null);
    }
  };

  const handleSkip = async () => {
    if (saving) return;
    setPendingOperation("skip");
    setFailedOperation(null);
    try {
      await skipPreference?.();
      if (!mountedRef.current) return;
      onSkip?.();
      onComplete?.(null);
      setStep("main");
      onOpenChange(false);
    } catch {
      if (mountedRef.current) {
        setFailedOperation("skip");
      }
    } finally {
      if (mountedRef.current) setPendingOperation(null);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && saving) return;
    if (!nextOpen && skipPreference) {
      void handleSkip();
      return;
    }
    if (!nextOpen) setStep("main");
    onOpenChange(nextOpen);
  };

  const mainPersonaContent = (
    <div
      className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-2 md:px-0 md:pr-1"
      data-persona-picker-step="main"
    >
      <fieldset>
        <legend className="sr-only">Main Murph personality</legend>
        <div className="grid content-start gap-3 pb-1 sm:grid-cols-2">
          {assistantBasePersonaOptions.map((option) => (
            <PersonaMatchCard
              key={option.id}
              disabled={saving}
              groupId={mainPersonaGroupId}
              option={option}
              selected={persona === option.id}
              onSelect={() => selectPersona(option.id)}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );

  const supportingPersonaContent = (
    <div
      className="grid min-h-0 min-w-0 flex-1 gap-5 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-2 md:grid-cols-[minmax(15rem,0.9fr)_minmax(19rem,1.1fr)] md:px-0 md:pr-1"
      data-persona-picker-step="supporting"
    >
      <section
        aria-label="Your Murph personality blend"
        className="flex self-start flex-col rounded-xl bg-muted/45 p-5"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Your Murph
        </p>
        <div className="mt-5 flex items-end gap-2.5" aria-hidden="true">
          <span className="flex size-20 items-center justify-center rounded-xl bg-background text-primary ring-1 ring-border">
            <MurphPersonaGlyph className="size-10" personaId={persona} />
          </span>
          {selectedSupportingPersona ? (
            <>
              <span className="pb-3 font-serif text-xl text-muted-foreground">
                +
              </span>
              <span className="flex size-14 items-center justify-center rounded-lg bg-background text-primary/75 ring-1 ring-border">
                <MurphPersonaGlyph
                  className="size-7"
                  personaId={selectedSupportingPersona.id}
                />
              </span>
            </>
          ) : null}
        </div>
        <div className="mt-5">
          <p className="font-serif text-2xl/7 font-semibold text-foreground">
            {selectedPersona.label} leads
          </p>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {selectedSupportingPersona
              ? `Supported by ${selectedSupportingPersona.label}.`
              : "No supporting personality added."}
          </p>
        </div>
        <div className="pt-7">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-border">
            <span
              className={cn(
                "bg-primary",
                selectedSupportingPersona ? "w-3/4" : "w-full",
              )}
            />
            {selectedSupportingPersona ? (
              <span className="w-1/4 bg-primary/30" />
            ) : null}
          </div>
          <div className="mt-2 flex justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            <span>Main</span>
            {selectedSupportingPersona ? <span>Supporting</span> : null}
          </div>
        </div>
      </section>

      <fieldset className="min-w-0">
        <legend className="sr-only">Supporting Murph personality</legend>
        <div className="flex flex-col gap-2 pb-1">
          <SupportingPersonaChoice
            disabled={saving}
            groupId={supportingPersonaGroupId}
            mainPersonaLabel={selectedPersona.label}
            onSelect={() => setSupportingPersona(null)}
            selected={supportingPersona === null}
          />
          {supportingPersonaOptions.map((option) => (
            <SupportingPersonaChoice
              key={option.id}
              disabled={saving}
              groupId={supportingPersonaGroupId}
              onSelect={() => setSupportingPersona(option.id)}
              option={option}
              selected={supportingPersona === option.id}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );

  const voicesContent = (
    <div
      className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-2 md:px-0 md:pr-1"
      data-persona-picker-step="voices"
    >
      <fieldset>
        <legend className="sr-only">Murph voice</legend>
        <div className="flex flex-col gap-6 pb-1">
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Recommended for {selectedPersona.label}
            </h3>
            <div className="grid content-start gap-2 sm:grid-cols-2">
              {recommendedVoiceOptions.map((option) => (
                <PersonaVoiceChoice
                  key={option.id}
                  disabled={saving}
                  groupId={voicePreviewGroupId}
                  option={option}
                  selected={voice === option.id}
                  onSelect={() => setVoice(option.id)}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Other voices
            </h3>
            <div className="grid content-start gap-2 sm:grid-cols-2">
              {otherVoiceOptions.map((option) => (
                <PersonaVoiceChoice
                  key={option.id}
                  disabled={saving}
                  groupId={voicePreviewGroupId}
                  option={option}
                  selected={voice === option.id}
                  onSelect={() => setVoice(option.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </fieldset>
    </div>
  );

  const toneContent = (
    <div
      className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-2 md:px-0"
      data-persona-picker-step="tone"
    >
      <fieldset disabled={saving}>
        <legend className="sr-only">Murph tone</legend>
        <div className="flex flex-col gap-3">
          <ToneChoiceCard
            disabled={saving}
            groupId={toneGroupId}
            label="Formal"
            onSelect={() => setTone("formal")}
            sample="Your sleep is down this week. Want to work on sleep first?"
            selected={tone === "formal"}
            value="formal"
          />
          <ToneChoiceCard
            disabled={saving}
            groupId={toneGroupId}
            label="Casual"
            onSelect={() => setTone("casual")}
            sample="sleep is way down this week. wanna fix sleep first?"
            selected={tone === "casual"}
            value="casual"
          />
        </div>
      </fieldset>
    </div>
  );

  const activeContent =
    step === "main"
      ? mainPersonaContent
      : step === "supporting"
        ? supportingPersonaContent
        : step === "voices"
          ? voicesContent
          : toneContent;

  const actions = (
    <div aria-busy={saving} className="flex flex-col gap-2">
      {pendingOperation === "skip" && step !== "main" ? (
        <p
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
          Finishing…
        </p>
      ) : null}
      {failedOperation ? (
        <div
          className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <div className="flex items-center justify-between gap-3">
            <span>
              {failedOperation === "skip"
                ? "Could not skip setup. Your choices are still here."
                : "Could not save your Murph. Your choices are still here. Try again."}
            </span>
            {failedOperation === "skip" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void handleSkip()}
              >
                Retry skip
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          variant="ghost"
          aria-busy={step === "main" && pendingOperation === "skip"}
          disabled={saving}
          onClick={() => {
            if (step === "main") {
              if (mode === "personality") {
                handleOpenChange(false);
                return;
              }
              void handleSkip();
              return;
            }
            setFailedOperation(null);
            setStep(
              step === "tone"
                ? "voices"
                : step === "voices"
                  ? "supporting"
                  : "main",
            );
          }}
        >
          {step === "main" && pendingOperation === "skip" ? (
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
          ) : null}
          {step === "main" && pendingOperation === "skip"
            ? "Skipping…"
            : step === "main"
              ? mode === "personality" ? "Cancel" : "Skip"
              : "Back"}
        </Button>
        <Button
          type="button"
          size="lg"
          aria-busy={pendingOperation === "save"}
          disabled={saving}
          onClick={() => {
            if (step === "main") {
              setStep("supporting");
              return;
            }
            if (step === "supporting") {
              if (mode === "personality") {
                void handleSave();
                return;
              }
              setStep("voices");
              return;
            }
            if (step === "voices") {
              setStep("tone");
              return;
            }
            void handleSave();
          }}
        >
          {pendingOperation === "save" ? (
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
          ) : null}
          {pendingOperation === "save"
            ? "Saving…"
            : mode === "personality" && step === "supporting"
              ? "Save personality"
              : "Continue"}
        </Button>
      </div>
    </div>
  );

  const stepNumber =
    step === "main" ? 1 : step === "supporting" ? 2 : step === "voices" ? 3 : 4;
  const title =
    step === "main"
      ? "Choose Murph’s main personality"
      : step === "supporting"
        ? "Add a supporting personality"
        : step === "voices"
          ? "Choose a voice"
          : "Pick Murph’s tone";
  const description =
    step === "main"
      ? "This is how Murph will show up most of the time. You can change it anytime."
      : step === "supporting"
        ? `Optional. Murph will lead with ${selectedPersona.label} and borrow a little from one other personality.`
        : step === "tone"
          ? "Which sounds more like you?"
          : null;
  const accessibleDescription =
    description
    ?? `Choose a voice for ${selectedPersona.label}.`;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="h-dvh data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-dvh data-[vaul-drawer-direction=bottom]:rounded-t-none">
          <DrawerHeader className="items-start gap-2 pb-3 text-left">
            <StepProgress
              step={stepNumber}
              total={mode === "personality" ? 2 : 4}
            />
            <div
              ref={stepTitleRef}
              aria-label={title}
              className="outline-none"
              data-persona-picker-step-title
              tabIndex={-1}
            >
              <DrawerTitle
                className="font-serif text-[2rem] leading-9 font-semibold tracking-[-0.02em]"
              >
                {title}
              </DrawerTitle>
            </div>
            <DrawerDescription
              className={cn("text-left text-sm leading-6", !description && "sr-only")}
            >
              {accessibleDescription}
            </DrawerDescription>
          </DrawerHeader>
          {activeContent}
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
        style={{
          height:
            step === "main" || step === "supporting" || step === "voices"
              ? "min(44rem, calc(100dvh - 2rem))"
              : undefined,
          maxWidth: "calc(100vw - 2rem)",
          width: step === "tone" ? "21rem" : "52rem",
        }}
        className="flex min-w-0 max-h-[calc(100dvh-2rem)] flex-col gap-5 overflow-hidden p-6"
      >
        <DialogHeader className="min-w-0 gap-2 text-left">
          <StepProgress
            step={stepNumber}
            total={mode === "personality" ? 2 : 4}
          />
          <div
            ref={stepTitleRef}
            aria-label={title}
            className="min-w-0 outline-none"
            data-persona-picker-step-title
            tabIndex={-1}
          >
            <DialogTitle
              className="break-words font-serif text-[2.5rem] leading-[2.75rem] font-semibold tracking-[-0.025em] text-balance"
            >
              {title}
            </DialogTitle>
          </div>
          <DialogDescription
            className={cn("text-left text-sm leading-6", !description && "sr-only")}
          >
            {accessibleDescription}
          </DialogDescription>
        </DialogHeader>
        {activeContent}
        {actions}
      </DialogContent>
    </Dialog>
  );
}

function PersonaMatchCard({
  disabled,
  groupId,
  onSelect,
  option,
  selected,
}: {
  disabled: boolean;
  groupId: string;
  onSelect: () => void;
  option: AssistantBasePersonaOption;
  selected: boolean;
}) {
  const inputId = useId();

  return (
    <div
      style={{ position: "relative" }}
      className={cn(
        "relative flex min-h-28 items-center gap-4 rounded-xl border p-4 transition-[border-color,background-color] has-[:focus-visible]:border-2 has-[:focus-visible]:border-primary",
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
        aria-describedby={`${inputId}-description`}
        aria-labelledby={`${inputId}-label`}
        name={groupId}
        onChange={onSelect}
        type="radio"
        value={option.id}
      />
      <label
        htmlFor={inputId}
        onClick={disabled ? undefined : onSelect}
        className="absolute inset-0 cursor-pointer rounded-xl"
      >
        <span className="sr-only">Select {option.label}</span>
      </label>
      <div className="pointer-events-none relative flex size-16 items-center justify-center rounded-xl bg-muted/70 text-primary">
        <MurphPersonaGlyph className="size-8" personaId={option.id} />
      </div>
      <div className="pointer-events-none relative min-w-0 flex-1">
        <span
          id={`${inputId}-label`}
          className="block pr-7 font-serif text-xl/6 font-semibold text-foreground"
        >
          {option.label}
        </span>
        <span
          id={`${inputId}-description`}
          className="mt-1 line-clamp-2 text-pretty text-sm leading-5 text-muted-foreground"
        >
          {option.description}
        </span>
      </div>
      <div
        className="pointer-events-none z-10"
        style={{ position: "absolute", right: "1rem", top: "1rem" }}
      >
        <SelectedCheck selected={selected} />
      </div>
    </div>
  );
}

function SupportingPersonaChoice({
  disabled,
  groupId,
  mainPersonaLabel,
  onSelect,
  option,
  selected,
}: {
  disabled: boolean;
  groupId: string;
  mainPersonaLabel?: string;
  onSelect: () => void;
  option?: AssistantBasePersonaOption;
  selected: boolean;
}) {
  const inputId = useId();
  const label = option?.label ?? "No supporting personality";
  const description =
    option?.supportDescription
    ?? `Keep ${mainPersonaLabel ?? "the main personality"} focused.`;

  return (
    <div
      className={cn(
        "relative grid min-h-16 grid-cols-[2.5rem_minmax(0,1fr)_1.25rem] items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-[border-color,background-color] has-[:focus-visible]:border-2 has-[:focus-visible]:border-primary",
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
        aria-describedby={`${inputId}-description`}
        aria-labelledby={`${inputId}-label`}
        name={groupId}
        onChange={onSelect}
        type="radio"
        value={option?.id ?? "none"}
      />
      <label
        htmlFor={inputId}
        onClick={disabled ? undefined : onSelect}
        className="absolute inset-0 cursor-pointer rounded-xl"
      >
        <span className="sr-only">Select {label}</span>
      </label>
      <span className="pointer-events-none relative flex size-10 items-center justify-center rounded-lg bg-muted/70 text-primary">
        {option ? (
          <MurphPersonaGlyph className="size-5" personaId={option.id} />
        ) : (
          <span className="h-px w-4 bg-muted-foreground/70" />
        )}
      </span>
      <span className="pointer-events-none relative min-w-0">
        <span
          id={`${inputId}-label`}
          className="block truncate font-serif text-base/5 font-semibold text-foreground"
        >
          {label}
        </span>
        <span
          id={`${inputId}-description`}
          className="mt-0.5 block truncate text-xs leading-5 text-muted-foreground"
        >
          {description}
        </span>
      </span>
      <span className="pointer-events-none relative">
        <SelectedCheck selected={selected} />
      </span>
    </div>
  );
}

function ToneChoiceCard({
  disabled,
  groupId,
  label,
  onSelect,
  sample,
  selected,
  value,
}: {
  disabled: boolean;
  groupId: string;
  label: string;
  onSelect: () => void;
  sample: string;
  selected: boolean;
  value: AssistantTonePreference;
}) {
  const inputId = useId();

  return (
    <div
      className={cn(
        "relative flex min-h-28 items-start rounded-xl border p-5 transition-[border-color,background-color] has-[:focus-visible]:border-2 has-[:focus-visible]:border-primary",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-background hover:border-primary/45",
      )}
      style={{ position: "relative" }}
    >
      <input
        checked={selected}
        className="peer sr-only"
        disabled={disabled}
        id={inputId}
        aria-describedby={`${inputId}-sample`}
        aria-labelledby={`${inputId}-label`}
        name={groupId}
        onChange={onSelect}
        type="radio"
        value={value}
      />
      <label
        htmlFor={inputId}
        onClick={disabled ? undefined : onSelect}
        className="absolute inset-0 cursor-pointer rounded-xl"
      >
        <span className="sr-only">Select {label}</span>
      </label>
      <div className="pointer-events-none relative min-w-0 pr-7">
        <span
          id={`${inputId}-label`}
          className="block font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground"
        >
          {label}
        </span>
        <span
          id={`${inputId}-sample`}
          className="mt-3 block text-[0.9375rem] leading-6 text-foreground"
        >
          {sample}
        </span>
      </div>
      <div
        className="pointer-events-none z-10"
        style={{ position: "absolute", right: "1rem", top: "1rem" }}
      >
        <SelectedCheck selected={selected} />
      </div>
    </div>
  );
}

function PersonaVoiceChoice({
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
  const playerRef = useRef<VoiceMemoPlayerHandle | null>(null);

  return (
    <div
      className={cn(
        "relative flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:border-2 has-[:focus-visible]:border-primary",
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
        aria-describedby={`${inputId}-description`}
        aria-labelledby={`${inputId}-label`}
        name={groupId}
        onChange={onSelect}
        onClick={() => {
          onSelect();
          playerRef.current?.play();
        }}
        type="radio"
        value={option.id}
      />
      <label
        htmlFor={inputId}
        className="absolute inset-0 cursor-pointer rounded-xl"
      >
        <span className="sr-only">Select {option.label}</span>
      </label>
      <div className="pointer-events-none relative flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1">
          <span
            id={`${inputId}-label`}
            className="block font-serif text-base/5 font-semibold text-foreground"
          >
            {option.label}
          </span>
          <span
            id={`${inputId}-description`}
            className="mt-1 block truncate text-sm leading-5 text-muted-foreground"
          >
            {option.description}
          </span>
        </span>
        <SelectedCheck selected={selected} />
      </div>
      <div className="relative" onClick={onSelect} role="presentation">
        <VoiceMemoPlayer
          ref={playerRef}
          accessibleLabel={`${option.label} voice preview`}
          src={option.previewPath}
          fallbackSrc={`/audio/murph-voices/${option.id}.mp3`}
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

function StepProgress({
  step,
  total,
}: {
  step: 1 | 2 | 3 | 4;
  total: 2 | 4;
}) {
  return (
    <div
      className="flex w-full items-center gap-3"
      aria-label={`Step ${step} of ${total}`}
    >
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Step {step} of {total}
      </span>
      <span
        className={cn(
          "grid flex-1 gap-1.5",
          total === 2 ? "grid-cols-2" : "grid-cols-4",
        )}
        aria-hidden="true"
      >
        {Array.from({ length: total }, (_, index) => index + 1).map((segment) => (
          <span
            key={segment}
            className={cn(
              "h-px",
              segment <= step ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </span>
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
