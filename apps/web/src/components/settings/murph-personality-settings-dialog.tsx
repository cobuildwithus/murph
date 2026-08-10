"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2Icon, SlidersHorizontalIcon } from "lucide-react";
import {
  assistantWebPersonalitySettingIds,
  isAssistantPersonalityScore,
  resolveAssistantEffectiveStyle,
  type AssistantPersonaId,
  type AssistantPersonalityPreferences,
  type AssistantWebPersonalitySettingId,
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
import { Slider } from "@/src/components/ui/slider";
import { useIsMobile } from "@/src/hooks/use-mobile";
import { cn } from "@/src/lib/utils";

// The Settings snapshot stores each dial as an explicit score or null (no web
// choice yet). Null resolves to the shared default for display; it is never
// persisted back as if the member had chosen it. Settings only ever sees the
// web-visible dials; conversational-only dials never reach this surface.
export type AssistantPersonalitySnapshot = Record<
  AssistantWebPersonalitySettingId,
  number | null
>;

type AssistantWebPersonalityScores = Record<AssistantWebPersonalitySettingId, number>;

// Only the dials the member actually moved are submitted, so a web save cannot
// overwrite a sibling dial changed conversationally in the canonical vault.
export type AssistantPersonalityDialUpdate = Partial<
  Record<AssistantWebPersonalitySettingId, number>
>;

interface PersonalityDialField {
  id: AssistantWebPersonalitySettingId;
  label: string;
  description: string;
  minLabel: string;
  maxLabel: string;
}

const PERSONALITY_DIAL_FIELDS: readonly PersonalityDialField[] = [
  {
    id: "humor",
    label: "Humor",
    description: "How often Murph reaches for a joke.",
    minLabel: "Straight-faced",
    maxLabel: "Maximum humor",
  },
  {
    id: "push",
    label: "Push",
    description: "How strongly Murph presses on goals you choose.",
    minLabel: "Hands-off",
    maxLabel: "Full coach",
  },
  {
    id: "detail",
    label: "Detail",
    description: "How much context Murph includes.",
    minLabel: "Brief",
    maxLabel: "Thorough",
  },
];

const PERSONALITY_SAVE_ERROR =
  "Could not confirm the save. Your draft is still here. Try again.";

export function MurphPersonalitySettingsDialog({
  onOpenChange,
  onSaved,
  open,
  persona = null,
  personality = null,
  savePersonality = saveAssistantPersonalityPreference,
}: {
  onOpenChange: (open: boolean) => void;
  onSaved?: (snapshot: AssistantPersonalitySnapshot) => void;
  open: boolean;
  persona?: AssistantPersonaId | null;
  personality?: AssistantPersonalitySnapshot | null;
  // The design showcase and tests inject a non-persisting save; everywhere else
  // the default posts a sparse personality delta to the settings endpoint.
  savePersonality?: typeof saveAssistantPersonalityPreference;
}) {
  const isMobile = useIsMobile();
  // The displayed scores shown when the editor opened seed the draft. Captured
  // once so a later prop change cannot replace a member's in-progress choices.
  const [initialScores] = useState<AssistantWebPersonalityScores>(() =>
    resolveAssistantPersonalitySnapshotScores(personality, persona),
  );
  const [scores, setScores] = useState<AssistantWebPersonalityScores>(initialScores);
  const [touchedDials, setTouchedDials] = useState<Set<AssistantWebPersonalitySettingId>>(
    () => new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dismissing the editor unmounts this component while a save may still be in
  // flight; a completion arriving after that must not fire callbacks the parent
  // would attribute to a newer editor instance.
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestedDials = collectTouchedDials(scores, touchedDials);
  const dirty = touchedDials.size > 0;

  const handleValueChange = (id: AssistantWebPersonalitySettingId, value: number) => {
    setScores((current) => ({ ...current, [id]: value }));
    setTouchedDials((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!dirty || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const snapshot = await savePersonality(requestedDials);
      if (!mountedRef.current) {
        return;
      }
      onSaved?.(snapshot);
      onOpenChange(false);
    } catch {
      if (mountedRef.current) {
        setError(PERSONALITY_SAVE_ERROR);
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  };

  // While a save is in flight, Escape/backdrop/swipe dismissal would unmount the
  // editor and orphan the request's result; keep it open until the save settles
  // so success stays attributable to this instance.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && saving) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const title = "Tune Murph's personality";
  const description =
    "Set how Murph sounds in your private conversations. Safety and accuracy never change.";
  const icon = (
    <div
      aria-hidden="true"
      className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
    >
      <SlidersHorizontalIcon className="size-5" strokeWidth={1.8} />
    </div>
  );
  const dials = (
    <div className="flex flex-col gap-7">
      {PERSONALITY_DIAL_FIELDS.map((field) => (
        <PersonalityDial
          key={field.id}
          field={field}
          value={scores[field.id]}
          disabled={saving}
          onChange={(value) => handleValueChange(field.id, value)}
        />
      ))}
    </div>
  );
  const status = error ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {error}
    </p>
  ) : null;
  const actions = (
    <div className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        size="lg"
        variant="ghost"
        onClick={() => handleOpenChange(false)}
        disabled={saving}
      >
        Cancel
      </Button>
      <Button
        type="button"
        size="lg"
        onClick={handleSave}
        disabled={saving || !dirty}
      >
        {saving ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
        Save changes
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="h-dvh data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-dvh data-[vaul-drawer-direction=bottom]:rounded-t-none">
          <DrawerHeader className="items-start gap-2 pb-3 text-left">
            {icon}
            <DrawerTitle
              className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground"
            >
              {title}
            </DrawerTitle>
            <DrawerDescription className="text-left text-sm leading-6 text-muted-foreground">
              {description}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-2 pt-1">
            {dials}
          </div>
          <DrawerFooter className="border-t border-border px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-3">
            {status}
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
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground ring-border sm:max-w-lg sm:p-6"
      >
        <DialogHeader className="gap-2 text-left">
          {icon}
          <DialogTitle
            className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground"
          >
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>

        {dials}
        {status}
        {actions}
      </DialogContent>
    </Dialog>
  );
}

function PersonalityDial({
  disabled,
  field,
  onChange,
  value,
}: {
  disabled: boolean;
  field: PersonalityDialField;
  onChange: (value: number) => void;
  value: number;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const endpointsId = useId();

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span
          id={labelId}
          className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground"
        >
          {field.label}
        </span>
        <span
          aria-hidden="true"
          className="font-serif text-lg leading-none tabular-nums text-foreground"
        >
          {value} / 10
        </span>
      </div>
      <p id={descriptionId} className="text-sm leading-5 text-muted-foreground">
        {field.description}
      </p>
      <div className="flex min-h-11 items-center">
        <Slider
          aria-labelledby={labelId}
          aria-describedby={`${descriptionId} ${endpointsId}`}
          min={0}
          max={10}
          step={1}
          value={value}
          disabled={disabled}
          onValueChange={(next) => {
            if (typeof next === "number") {
              onChange(next);
            }
          }}
          getAriaValueText={(_formatted, current) => `${current} of 10`}
          trackClassName="data-[orientation=horizontal]:h-3 ring-1 ring-inset ring-border"
          thumbClassName="size-6 border-2 border-primary bg-popover after:-inset-2.5"
        >
          <PersonalityDialTicks value={value} />
        </Slider>
      </div>
      <div
        id={endpointsId}
        className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.09em] text-muted-foreground"
      >
        <span>{field.minLabel}</span>
        <span className="text-right">{field.maxLabel}</span>
      </div>
    </div>
  );
}

// Eleven discrete stops drawn inside the pill track. Purely decorative: the
// Base UI thumb stays the single interactive, accessible control.
function PersonalityDialTicks({ value }: { value: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-between px-1.5"
    >
      {Array.from({ length: 11 }, (_, index) => (
        <span
          key={index}
          className={cn(
            "size-1.5 rounded-full",
            index <= value ? "bg-background/80" : "bg-foreground/20",
          )}
        />
      ))}
    </div>
  );
}

export function resolveAssistantPersonalitySnapshotScores(
  snapshot: AssistantPersonalitySnapshot | null | undefined,
  persona: AssistantPersonaId | null = null,
): AssistantWebPersonalityScores {
  const resolved = resolveAssistantEffectiveStyle({
    ...(persona ? { persona } : {}),
    personality: snapshotToPreferences(snapshot),
  }).personality;
  const scores = {} as AssistantWebPersonalityScores;
  for (const id of assistantWebPersonalitySettingIds) {
    scores[id] = resolved[id];
  }
  return scores;
}

function snapshotToPreferences(
  snapshot: AssistantPersonalitySnapshot | null | undefined,
): AssistantPersonalityPreferences {
  const preferences: AssistantPersonalityPreferences = {};
  if (!snapshot) {
    return preferences;
  }
  for (const id of assistantWebPersonalitySettingIds) {
    const value = snapshot[id];
    if (isAssistantPersonalityScore(value)) {
      preferences[id] = value;
    }
  }
  return preferences;
}

function collectTouchedDials(
  scores: AssistantWebPersonalityScores,
  touchedDials: ReadonlySet<AssistantWebPersonalitySettingId>,
): AssistantPersonalityDialUpdate {
  const changed: AssistantPersonalityDialUpdate = {};
  for (const id of assistantWebPersonalitySettingIds) {
    if (touchedDials.has(id)) {
      changed[id] = scores[id];
    }
  }
  return changed;
}

async function saveAssistantPersonalityPreference(
  changedDials: AssistantPersonalityDialUpdate,
): Promise<AssistantPersonalitySnapshot> {
  const response = await fetch("/api/settings/assistant-style", {
    body: JSON.stringify({ personality: changedDials }),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Assistant personality save failed.");
  }

  return parseAssistantPersonalitySaveResponse(await response.json());
}

function parseAssistantPersonalitySaveResponse(
  value: unknown,
): AssistantPersonalitySnapshot {
  if (!isRecord(value) || !isRecord(value.assistantPersonality)) {
    throw new Error("Assistant personality save returned an invalid response.");
  }

  const snapshot: AssistantPersonalitySnapshot = {
    detail: null,
    humor: null,
    push: null,
  };

  // Iterate only the web-visible dials so a server response that also carries
  // the conversational-only unhinged score can never enter client state.
  for (const id of assistantWebPersonalitySettingIds) {
    const score = value.assistantPersonality[id];
    if (score !== null && !isAssistantPersonalityScore(score)) {
      throw new Error("Assistant personality save returned an invalid response.");
    }
    snapshot[id] = score;
  }

  return snapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
