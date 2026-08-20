"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  HABITAT_DECLINED_VALUE,
  normalizeHabitatCityOrRegion,
} from "@murphai/contracts";
import Image from "next/image";
import { LoaderCircle, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { PageHeader } from "@/src/components/ui/page-header";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import { deriveCategoryNote, overallGrade } from "./category-notes";
import {
  CategoryCard,
  EnvironmentHero,
  NextChecksStrip,
  PrintEnvironmentLink,
  ShareEnvironmentButton,
  type NextCheckItem,
} from "./environment-components";
import {
  EnvironmentChatAction,
  EnvironmentVoiceCapture,
} from "./environment-voice-capture";
import {
  buildEnvironmentVoiceScript,
  buildEnvironmentVoiceScriptForGroup,
  buildEnvironmentVoiceScriptForIndicator,
  findEnvironmentVoiceTopicForIndicator,
  type EnvironmentVoiceScript,
} from "./environment-voice-script";
import { EnvironmentReportSkeleton } from "./environment-report-skeleton";
import {
  selectEnvironmentHabitatIndicatorNotes,
  selectEnvironmentHabitatValues,
} from "./habitat-values";
import {
  INDICATOR_SPRITES,
  type HabitatIndicatorNotes,
  type HabitatValues,
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "./home-model";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

const EMPTY_HABITAT_VALUES: HabitatValues = {};
const EMPTY_HABITAT_SCENE = resolveHabitatScene(EMPTY_HABITAT_VALUES);
const VOICE_REFRESH_INTERVAL_MS = 2_000;
const VOICE_REFRESH_DELAYED_INTERVAL_MS = 10_000;
const VOICE_RECHECK_INTERVAL_MS = 10_000;
const VOICE_REFRESH_WINDOW_MS = 2 * 60 * 1_000;

export type VoiceRefreshState =
  | { status: "idle" }
  | {
      baselineValues: string;
      status: "processing";
    }
  | { baselineValues: string; status: "completed" }
  | {
      factsAdded: number;
      factsChanged: boolean;
      remainingDetails: number;
      remainingTopics: number;
      status: "updated";
    }
  | { status: "delayed" };

type DisplayedVoiceRefreshState = Exclude<
  VoiceRefreshState,
  { status: "completed" }
>;

const EMPTY_CATEGORY_SUMMARIES: Readonly<Record<string, string>> = {
  sleep: "Temperature, darkness, noise and bedroom air.",
  air: "Ventilation, damp, smoke and drinking water.",
  light: "Morning daylight and evening lighting.",
  recovery: "The recovery tools and devices you already use.",
  workspace: "Sitting, screen setup, breaks and discomfort.",
};

export default function EnvironmentPageClient({
  contactOptions,
}: {
  contactOptions: readonly MurphContactOption[];
}) {
  const { client, error, refresh, status } = useBrowserVault();
  const [voiceRefreshState, setVoiceRefreshState] = useState<VoiceRefreshState>(
    { status: "idle" },
  );
  const checkedInitialVoiceProcessingRef = useRef(false);
  const initialVoiceProcessingCheckRef = useRef(0);
  const voiceRefreshBaselineRef = useRef<string | null>(null);
  const voiceRefreshStartedAtRef = useRef<number | null>(null);
  const voiceRecheckRequestedAtRef = useRef(0);
  const voiceVaultRefreshRequestedRef = useRef(false);
  const values = useMemo(
    () => (client ? selectEnvironmentHabitatValues(client) : {}),
    [client],
  );
  const indicatorNotes = useMemo(
    () => (client ? selectEnvironmentHabitatIndicatorNotes(client) : {}),
    [client],
  );
  const scene = useMemo(() => resolveHabitatScene(values), [values]);
  const notes = useMemo(
    () =>
      scene.categories.map((category) =>
        deriveCategoryNote(category, values, indicatorNotes)
      ),
    [indicatorNotes, scene, values],
  );
  const grade = useMemo(() => overallGrade(notes, values), [notes, values]);
  const coverage = useMemo(() => resolveEnvironmentCoverage(scene), [scene]);
  const voiceScript = useMemo(
    () => buildEnvironmentVoiceScript(values, indicatorNotes),
    [indicatorNotes, values],
  );
  const location = readableLocation(values);
  const conditions = useEnvironmentConditions(location);
  const hasEnvironmentData = hasKnownHabitatValue(values);
  const valuesSignature = JSON.stringify({ indicatorNotes, values });
  const displayedVoiceRefreshState = resolveDisplayedVoiceRefreshState({
    currentIndicatorNotes: indicatorNotes,
    currentValues: values,
    script: voiceScript,
    state: voiceRefreshState,
  });
  const voiceCaptureDisabled =
    displayedVoiceRefreshState.status === "processing" ||
    displayedVoiceRefreshState.status === "delayed";
  const onVoiceAccepted = useCallback(() => {
    voiceRefreshBaselineRef.current = valuesSignature;
    voiceRefreshStartedAtRef.current = Date.now();
    voiceRecheckRequestedAtRef.current = Date.now();
    voiceVaultRefreshRequestedRef.current = false;
    setVoiceRefreshState({
      baselineValues: valuesSignature,
      status: "processing",
    });
  }, [valuesSignature]);

  useEffect(() => {
    if (status === "loading" || checkedInitialVoiceProcessingRef.current) {
      return;
    }
    const checkId = initialVoiceProcessingCheckRef.current + 1;
    initialVoiceProcessingCheckRef.current = checkId;
    void readEnvironmentVoiceProcessingStatus().then((processing) => {
      if (initialVoiceProcessingCheckRef.current !== checkId) {
        return;
      }
      checkedInitialVoiceProcessingRef.current = true;
      if (processing === true) {
        voiceRecheckRequestedAtRef.current = Date.now();
        void requestEnvironmentVoiceProcessingRecheck().catch(() => undefined);
        voiceRefreshBaselineRef.current = valuesSignature;
        voiceRefreshStartedAtRef.current = Date.now();
        setVoiceRefreshState((current) =>
          current.status === "idle"
            ? {
                baselineValues: valuesSignature,
                status: "processing",
              }
            : current,
        );
      }
    });
    return () => {
      if (initialVoiceProcessingCheckRef.current === checkId) {
        initialVoiceProcessingCheckRef.current += 1;
      }
    };
  }, [status, valuesSignature]);

  useEffect(() => {
    if (
      voiceRefreshState.status !== "processing" &&
      voiceRefreshState.status !== "delayed"
    ) {
      return;
    }
    const baseline =
      voiceRefreshState.status === "processing"
        ? voiceRefreshState.baselineValues
        : voiceRefreshBaselineRef.current;
    if (baseline && valuesSignature !== baseline) {
      voiceVaultRefreshRequestedRef.current = false;
      setVoiceRefreshState({
        baselineValues: baseline,
        status: "completed",
      });
      return;
    }
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (cancelled) {
        return;
      }
      const processing = await readEnvironmentVoiceProcessingStatus();
      if (cancelled) {
        return;
      }
      if (
        voiceRefreshState.status === "processing" &&
        Date.now() - (voiceRefreshStartedAtRef.current ?? Date.now()) >=
          VOICE_REFRESH_WINDOW_MS
      ) {
        voiceRefreshBaselineRef.current = voiceRefreshState.baselineValues;
        setVoiceRefreshState({ status: "delayed" });
        return;
      }
      if (processing === false) {
        if (!voiceVaultRefreshRequestedRef.current) {
          voiceVaultRefreshRequestedRef.current = true;
          const refreshBaseline = baseline ?? valuesSignature;
          await refresh({
            background: true,
            requestRuntimeRefreshUntil: (nextClient) =>
              JSON.stringify({
                indicatorNotes:
                  selectEnvironmentHabitatIndicatorNotes(nextClient),
                values: selectEnvironmentHabitatValues(nextClient),
              }) !== refreshBaseline,
          }).catch(() => {
            voiceVaultRefreshRequestedRef.current = false;
          });
        }
        if (!cancelled) {
          timeoutId = setTimeout(
            () => void poll(),
            voiceRefreshState.status === "delayed"
              ? VOICE_REFRESH_DELAYED_INTERVAL_MS
              : VOICE_REFRESH_INTERVAL_MS,
          );
        }
        return;
      }
      if (cancelled) {
        return;
      }
      if (
        voiceVaultRefreshRequestedRef.current &&
        processing !== false
      ) {
        voiceVaultRefreshRequestedRef.current = false;
      }
      if (
        Date.now() - voiceRecheckRequestedAtRef.current >=
        VOICE_RECHECK_INTERVAL_MS
      ) {
        voiceRecheckRequestedAtRef.current = Date.now();
        await requestEnvironmentVoiceProcessingRecheck().catch(() => undefined);
      }
      timeoutId = setTimeout(
        () => void poll(),
        voiceRefreshState.status === "delayed"
          ? VOICE_REFRESH_DELAYED_INTERVAL_MS
          : VOICE_REFRESH_INTERVAL_MS,
      );
    };
    timeoutId = setTimeout(() => void poll(), VOICE_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [refresh, valuesSignature, voiceRefreshState]);

  if (status === "loading") {
    return (
      <EnvironmentShell>
        <EnvironmentReportSkeleton onRetry={() => refresh()} />
      </EnvironmentShell>
    );
  }

  if (status === "error") {
    return (
      <EnvironmentShell>
        <Alert variant="destructive">
          <AlertTitle>Could not load your environment</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {error ??
                  "Murph could not unlock your private Habitat records right now."}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
              >
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </EnvironmentShell>
    );
  }

  return (
    <EnvironmentShell
      actions={
        hasEnvironmentData ? (
          <>
            <ShareEnvironmentButton
              coverage={coverage.coverage}
              disabled={grade.letter === null}
              grade={grade}
              known={coverage.known}
              total={coverage.total}
            />
            <PrintEnvironmentLink />
          </>
        ) : undefined
      }
    >
      <EnvironmentVoiceRefreshNotice
        state={displayedVoiceRefreshState}
        onCheckAgain={() => {
          voiceRefreshBaselineRef.current = valuesSignature;
          voiceRefreshStartedAtRef.current = Date.now();
          voiceRecheckRequestedAtRef.current = Date.now();
          voiceVaultRefreshRequestedRef.current = false;
          setVoiceRefreshState({
            baselineValues: valuesSignature,
            status: "processing",
          });
          void requestEnvironmentVoiceProcessingRecheck().finally(() =>
            refresh({ background: true }).catch(() => undefined),
          );
        }}
      />
      {hasEnvironmentData ? (
        <EnvironmentReport
          values={values}
          scene={scene}
          notes={notes}
          indicatorNotes={indicatorNotes}
          grade={grade}
          coverage={coverage}
          contactOptions={contactOptions}
          conditions={conditions}
          onVoiceAccepted={onVoiceAccepted}
          voiceCaptureDisabled={voiceCaptureDisabled}
        />
      ) : (
        <EnvironmentEmptyState
          contactOptions={contactOptions}
          onVoiceAccepted={onVoiceAccepted}
          processing={voiceCaptureDisabled}
          script={voiceScript}
        />
      )}
    </EnvironmentShell>
  );
}

function resolveDisplayedVoiceRefreshState({
  currentIndicatorNotes,
  currentValues,
  script,
  state,
}: {
  currentIndicatorNotes: HabitatIndicatorNotes;
  currentValues: HabitatValues;
  script: EnvironmentVoiceScript;
  state: VoiceRefreshState;
}): DisplayedVoiceRefreshState {
  if (state.status !== "completed") {
    return state;
  }
  const remainingDetails =
    script.flow === "update"
      ? 0
      : script.topics.reduce(
          (sum, topic) => sum + (topic.fields?.length ?? 0),
          0,
        );
  return {
    factsAdded: countNewKnownFacts(state.baselineValues, currentValues),
    factsChanged:
      JSON.stringify({ indicatorNotes: currentIndicatorNotes, values: currentValues }) !==
      state.baselineValues,
    remainingDetails,
    remainingTopics: remainingDetails > 0 ? script.topics.length : 0,
    status: "updated",
  };
}

function countNewKnownFacts(
  baselineJson: string,
  currentValues: HabitatValues,
): number {
  let baseline: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(baselineJson);
    if (isRecord(parsed)) {
      baseline = isRecord(parsed.values) ? parsed.values : parsed;
    }
  } catch {
    return 0;
  }

  let added = 0;
  for (const [aspectId, aspect] of Object.entries(currentValues)) {
    const previousAspect = baseline[aspectId];
    for (const [indicatorId, value] of Object.entries(aspect)) {
      const previousValue = isRecord(previousAspect)
        ? previousAspect[indicatorId]
        : undefined;
      if (isKnownFact(value) && !isKnownFact(previousValue)) {
        added += 1;
      }
    }
  }
  return added;
}

function isKnownFact(value: unknown): boolean {
  return (
    value !== null && value !== undefined && value !== HABITAT_DECLINED_VALUE
  );
}

async function readEnvironmentVoiceProcessingStatus(): Promise<boolean | null> {
  try {
    const response = await fetch("/api/environment/realtime/topics", {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    if (
      payload &&
      typeof payload === "object" &&
      "processing" in payload &&
      typeof payload.processing === "boolean"
    ) {
      return payload.processing;
    }
  } catch {
    return null;
  }
  return null;
}

async function requestEnvironmentVoiceProcessingRecheck(): Promise<void> {
  const response = await fetch("/api/environment/realtime/topics", {
    method: "PATCH",
  });
  if (!response.ok) {
    throw new Error("Environment voice processing recheck failed.");
  }
}

export function EnvironmentShell({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-10">
      <div className="flex items-end justify-between gap-4">
        <PageHeader
          eyebrow="Habitat"
          title="Your environment"
          description="What Murph knows about your home, and what to check next."
        />
        {actions ? (
          <div className="flex shrink-0 items-center gap-5 pb-1">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function EnvironmentEmptyState({
  contactOptions,
  onVoiceAccepted,
  processing = false,
  script = buildEnvironmentVoiceScript(EMPTY_HABITAT_VALUES),
}: {
  contactOptions: readonly MurphContactOption[];
  onVoiceAccepted?: () => void;
  processing?: boolean;
  script?: EnvironmentVoiceScript;
}) {
  return (
    <section
      aria-labelledby="environment-empty-title"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="grid lg:grid-cols-[6fr_5fr]">
        <div className="flex flex-col px-6 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          <p className="flex items-center gap-2 text-base font-medium text-primary sm:text-sm">
            <ShieldCheck
              className="size-5 shrink-0 sm:size-4"
              aria-hidden="true"
            />
            Private to you
          </p>
          <h2
            id="environment-empty-title"
            className="mt-7 max-w-[19ch] text-balance font-serif text-4xl font-semibold leading-[1.04] tracking-[-0.03em] text-foreground"
          >
            See how your home supports your sleep, air and focus.
          </h2>
          <p className="mt-5 max-w-[58ch] text-pretty text-base leading-relaxed text-muted-foreground">
            Talk through one short topic at a time. Murph saves each clear
            answer before moving on.
          </p>

          <div className="mt-8 flex flex-col items-start gap-4">
            <EnvironmentVoiceCapture
              contactOptions={contactOptions}
              disabled={processing}
              onAccepted={onVoiceAccepted}
              script={script}
              triggerLabel={
                processing
                  ? "Saving report…"
                  : script.flow === "walkthrough"
                  ? "Start report"
                  : script.flow === "fill-gaps"
                  ? "Continue report"
                  : "Update by voice"
              }
            />
            <EnvironmentChatAction
              contactOptions={contactOptions}
              label="Prefer typing? Use chat"
              presentation="link"
            />
          </div>
        </div>

        <div className="border-t border-border bg-muted/20 px-6 py-7 sm:px-8 sm:py-9 lg:border-l lg:border-t-0 lg:px-8 lg:py-10">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Your report will cover
          </p>
          <div className="mt-4 divide-y divide-border">
            {EMPTY_HABITAT_SCENE.categories.map((category) => (
              <div
                key={category.id}
                className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
              >
                <Image
                  src={category.thumbnail.src}
                  alt=""
                  width={category.thumbnail.w}
                  height={category.thumbnail.h}
                  className="size-12 shrink-0 object-contain"
                />
                <div className="min-w-0 pt-0.5">
                  <h3 className="font-serif text-lg font-semibold tracking-[-0.02em] text-foreground">
                    {category.title}
                  </h3>
                  <p className="mt-0.5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-sm">
                    {EMPTY_CATEGORY_SUMMARIES[category.id]}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function EnvironmentReport({
  values,
  indicatorNotes,
  scene,
  notes,
  grade,
  coverage,
  contactOptions,
  conditions,
  onVoiceAccepted,
  voiceCaptureDisabled,
}: {
  values: HabitatValues;
  indicatorNotes: HabitatIndicatorNotes;
  scene: ReturnType<typeof resolveHabitatScene>;
  notes: ReturnType<typeof deriveCategoryNote>[];
  grade: ReturnType<typeof overallGrade>;
  coverage: ReturnType<typeof resolveEnvironmentCoverage>;
  contactOptions: readonly MurphContactOption[];
  conditions: { outdoorAir: string; weather: string };
  onVoiceAccepted: () => void;
  voiceCaptureDisabled: boolean;
}) {
  const contactAction = contactOptions[0] ?? null;
  const nextChecks = buildNextChecks(scene, notes);
  const noteByCategoryId = new Map(notes.map((note) => [note.id, note]));
  const voiceScript = buildEnvironmentVoiceScript(values, indicatorNotes);
  const [requestedTopicId, setRequestedTopicId] = useState<string | null>(null);
  const clearRequestedTopic = useCallback(() => setRequestedTopicId(null), []);
  const renderInlineVoiceCapture = useCallback(
    (indicatorId: string) => {
      const targetedScript =
        buildEnvironmentVoiceScriptForIndicator(indicatorId, indicatorNotes);
      return targetedScript ? (
        <EnvironmentVoiceCapture
          authGate={false}
          contactOptions={contactOptions}
          disabled={voiceCaptureDisabled}
          onAccepted={onVoiceAccepted}
          presentation="inline"
          script={targetedScript}
          triggerLabel="Fill in by voice"
        />
      ) : null;
    },
    [contactOptions, indicatorNotes, onVoiceAccepted, voiceCaptureDisabled],
  );
  const renderCategoryVoiceCapture = useCallback(
    (groupId: string) => {
      const categoryScript = buildEnvironmentVoiceScriptForGroup(
        groupId,
        values,
        indicatorNotes,
      );
      return categoryScript ? (
        <EnvironmentVoiceCapture
          authGate={false}
          contactOptions={contactOptions}
          disabled={voiceCaptureDisabled}
          onAccepted={onVoiceAccepted}
          script={categoryScript}
          triggerLabel="Fill in by voice"
          triggerSize="default"
          triggerVariant="outline"
        />
      ) : null;
    },
    [
      contactOptions,
      indicatorNotes,
      onVoiceAccepted,
      values,
      voiceCaptureDisabled,
    ],
  );
  const locationTopicId =
    values["home-location"]?.location === undefined
      ? findEnvironmentVoiceTopicForIndicator(voiceScript, "location")
      : null;
  const areaTopicId =
    values["home-location"]?.area_type === undefined
      ? findEnvironmentVoiceTopicForIndicator(voiceScript, "area_type")
      : null;
  const nightsTopicId =
    values["sleep-environment"]?.night_noise === undefined
      ? findEnvironmentVoiceTopicForIndicator(voiceScript, "night_noise")
      : null;

  return (
    <>
      <EnvironmentHero
        grade={grade}
        known={coverage.known}
        total={coverage.total}
        notes={notes}
        context={{
          location: contextValue(values["home-location"]?.location),
          areaType: contextValue(values["home-location"]?.area_type),
          weather: conditions.weather,
          nights: contextValue(values["sleep-environment"]?.night_noise),
          outdoorAir: conditions.outdoorAir,
        }}
        missingTopicByKey={{
          ...(areaTopicId ? { areaType: areaTopicId } : {}),
          ...(locationTopicId
            ? {
                location: locationTopicId,
                outdoorAir: locationTopicId,
                weather: locationTopicId,
              }
            : {}),
          ...(nightsTopicId ? { nights: nightsTopicId } : {}),
        }}
        onFillMissing={setRequestedTopicId}
      />

      <EnvironmentCaptureCard
        contactOptions={contactOptions}
        coverage={coverage.coverage}
        known={coverage.known}
        script={voiceScript}
        onVoiceAccepted={onVoiceAccepted}
        processing={voiceCaptureDisabled}
      />

      <NextChecksStrip
        items={nextChecks}
        chatHref={contactAction?.href ?? null}
        renderFillMissing={renderInlineVoiceCapture}
      />

      <div className="space-y-6">
        {scene.categories.map((category) => {
          const note = noteByCategoryId.get(category.id);
          return note ? (
            <CategoryCard
              key={category.id}
              category={category}
              note={note}
              chatHref={contactAction?.href ?? null}
              renderFillMissing={renderInlineVoiceCapture}
              voiceAction={renderCategoryVoiceCapture(category.id)}
            />
          ) : null;
        })}
      </div>
      <EnvironmentVoiceCapture
        contactOptions={contactOptions}
        disabled={voiceCaptureDisabled}
        onAccepted={onVoiceAccepted}
        onRequestedTopicHandled={clearRequestedTopic}
        requestedTopicId={requestedTopicId}
        script={voiceScript}
        showTrigger={false}
      />
    </>
  );
}

export function EnvironmentCaptureCard({
  contactOptions,
  coverage,
  known,
  script,
  onVoiceAccepted,
  processing = false,
}: {
  contactOptions: readonly MurphContactOption[];
  coverage: number;
  known: number;
  script: EnvironmentVoiceScript;
  onVoiceAccepted?: () => void;
  processing?: boolean;
}) {
  const updating = script.flow === "update";
  const missing = script.topics.reduce(
    (sum, topic) => sum + (topic.focus?.length ?? 0),
    0,
  );
  const topicCount = script.topics.length;

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-card px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <h2 className="text-balance font-serif text-lg font-semibold text-foreground">
          {updating
            ? "All current details covered"
            : known === 0
            ? "Build your environment report in one take"
            : coverage < 50
            ? "Complete the picture"
            : "Fill the remaining gaps"}
        </h2>
        <p className="mt-1 max-w-[68ch] text-pretty text-base text-muted-foreground sm:text-sm">
          {updating
            ? "Tell Murph if something changes at home or in your workspace."
            : known === 0
            ? "Talk through sleep, air, light, recovery and work. Murph saves each topic as you go."
            : `${missing} ${
                missing === 1 ? "detail" : "details"
              } missing · ${topicCount} short ${
                topicCount === 1 ? "topic" : "topics"
              }`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <EnvironmentVoiceCapture
          contactOptions={contactOptions}
          triggerSize="default"
          disabled={processing}
          onAccepted={onVoiceAccepted}
          script={script}
          triggerLabel={
            processing
              ? "Saving report…"
              : updating
              ? "Update by voice"
              : known === 0
              ? "Start report"
              : "Continue report"
          }
          triggerVariant={updating ? "outline" : "default"}
        />
        <EnvironmentChatAction
          contactOptions={contactOptions}
          label={updating ? "Update in chat" : "Chat instead"}
          presentation="button"
        />
      </div>
    </section>
  );
}

export function EnvironmentVoiceRefreshNotice({
  onCheckAgain,
  state,
}: {
  onCheckAgain: () => void;
  state: DisplayedVoiceRefreshState;
}) {
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "processing") {
    return (
      <Alert aria-live="polite">
        <AlertTitle className="flex items-center gap-2">
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin text-primary motion-reduce:animate-none"
          />
          Murph is saving your answers
        </AlertTitle>
        <AlertDescription>
          This report will refresh when the current topic is saved.
        </AlertDescription>
      </Alert>
    );
  }
  if (state.status === "updated") {
    return (
      <Alert aria-live="polite">
        <AlertTitle>
          {state.factsChanged
            ? "Your environment report is updated"
            : "The report was not updated"}
        </AlertTitle>
        <AlertDescription>
          {state.factsChanged
            ? environmentUpdateSummary(state)
            : "Murph could not add any clear details. You can try this topic again or use chat."}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert aria-live="polite">
      <AlertTitle className="flex items-center gap-2">
        <LoaderCircle
          aria-hidden="true"
          className="size-4 animate-spin text-primary motion-reduce:animate-none"
        />
        Murph is taking longer than usual
      </AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Your saved topics are safe. Check again to refresh this report.
          </span>
          <Button size="sm" variant="outline" onClick={onCheckAgain}>
            Check again
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function environmentUpdateSummary(
  state: Extract<DisplayedVoiceRefreshState, { status: "updated" }>,
): string {
  const added =
    state.factsAdded === 1
      ? "Added 1 detail."
      : state.factsAdded > 1
      ? `Added ${state.factsAdded} details.`
      : "Murph saved your changes.";
  if (state.remainingDetails === 0) {
    return `${added} Your current report has no remaining gaps.`;
  }
  return `${added} ${state.remainingDetails} ${
    state.remainingDetails === 1 ? "detail is" : "details are"
  } still missing across ${state.remainingTopics} ${
    state.remainingTopics === 1 ? "topic" : "topics"
  }.`;
}

function buildNextChecks(
  scene: ReturnType<typeof resolveHabitatScene>,
  notes: ReturnType<typeof deriveCategoryNote>[],
): NextCheckItem[] {
  const spriteFor = (categoryId: string, indicatorId: string) =>
    scene.categories
      .find((category) => category.id === categoryId)
      ?.objects.find(
        (object) =>
          object.indicatorId === indicatorId && object.sprite && !object.decor,
      )?.sprite ?? INDICATOR_SPRITES[indicatorId];

  const unmet = notes
    .flatMap((note) =>
      note.rows
        .filter((row) => row.met === false)
        .map((row) => ({
          priority: PRIORITY_ORDER[row.priority],
          item: {
            fact: {
              indicatorId: row.indicatorId,
              label: row.label,
              kind: "unmet",
              value: row.value,
              target: row.target,
              detail: row.detail,
              note: row.note,
            },
            sprite: spriteFor(note.id, row.indicatorId),
            categoryTitle: note.title,
          } satisfies NextCheckItem,
        })),
    )
    .sort((a, b) => a.priority - b.priority)
    .map(({ item }) => item);

  const unknown = notes.flatMap((note) =>
    note.unknownFacts.map(
      (fact): NextCheckItem => ({
        fact: {
          indicatorId: fact.indicatorId,
          label: fact.label,
          kind: "unknown",
          value: null,
          target: null,
          detail: null,
          note: null,
        },
        sprite: spriteFor(note.id, fact.indicatorId),
        categoryTitle: note.title,
      }),
    ),
  );

  return [...unmet.slice(0, 6), ...unknown.slice(0, 4)];
}

function contextValue(value: unknown): string {
  if (value === HABITAT_DECLINED_VALUE) {
    return "Not provided";
  }
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return "Missing";
  }
  return String(value).replaceAll("_", " ");
}

interface EnvironmentConditionsResponse {
  airQuality: {
    aqi: number;
    pm25: number;
  } | null;
  weather: {
    description: string;
    temperatureC: number;
  } | null;
}

function readableLocation(values: HabitatValues): string | null {
  const value = values["home-location"]?.location;
  return value === HABITAT_DECLINED_VALUE
    ? null
    : normalizeHabitatCityOrRegion(value);
}

function hasKnownHabitatValue(values: HabitatValues): boolean {
  return Object.values(values).some((aspect) =>
    Object.values(aspect).some(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== HABITAT_DECLINED_VALUE,
    ),
  );
}

function useEnvironmentConditions(location: string | null): {
  outdoorAir: string;
  weather: string;
} {
  const [result, setResult] = useState<{
    conditions: EnvironmentConditionsResponse | null;
    failed: boolean;
    location: string;
  } | null>(null);

  useEffect(() => {
    if (!location) {
      return;
    }

    const controller = new AbortController();
    void fetch("/api/environment/conditions", {
      body: JSON.stringify({ location }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Live environment conditions are unavailable.");
        }
        const value: unknown = await response.json();
        if (!isEnvironmentConditionsResponse(value)) {
          throw new Error("Live environment conditions were malformed.");
        }
        setResult({ conditions: value, failed: false, location });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setResult({ conditions: null, failed: true, location });
      });

    return () => controller.abort();
  }, [location]);

  if (!location) {
    return { outdoorAir: "Missing", weather: "Missing" };
  }
  if (!result || result.location !== location) {
    return { outdoorAir: "Checking…", weather: "Checking…" };
  }
  if (result.failed || !result.conditions) {
    return { outdoorAir: "Couldn’t check", weather: "Couldn’t check" };
  }
  const { conditions } = result;

  return {
    outdoorAir: conditions.airQuality
      ? `${airQualityLabel(conditions.airQuality.aqi)} · PM2.5 ${Math.round(
          conditions.airQuality.pm25,
        )} µg/m³`
      : "Couldn’t check",
    weather: conditions.weather
      ? `${Math.round(conditions.weather.temperatureC)}°C · ${sentenceCase(
          conditions.weather.description,
        )}`
      : "Couldn’t check",
  };
}

function isEnvironmentConditionsResponse(
  value: unknown,
): value is EnvironmentConditionsResponse {
  if (!isRecord(value)) {
    return false;
  }
  const weather = value.weather;
  const airQuality = value.airQuality;
  return (
    (weather === null ||
      (isRecord(weather) &&
        typeof weather.description === "string" &&
        typeof weather.temperatureC === "number" &&
        Number.isFinite(weather.temperatureC))) &&
    (airQuality === null ||
      (isRecord(airQuality) &&
        typeof airQuality.aqi === "number" &&
        Number.isFinite(airQuality.aqi) &&
        typeof airQuality.pm25 === "number" &&
        Number.isFinite(airQuality.pm25)))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function airQualityLabel(aqi: number): string {
  return (
    {
      1: "Good",
      2: "Fair",
      3: "Moderate",
      4: "Poor",
      5: "Very poor",
    }[aqi] ?? "Unknown"
  );
}

function sentenceCase(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0
    ? `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`
    : "Unavailable";
}
