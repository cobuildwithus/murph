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
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";
import Image from "next/image";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";

import { MurphContactDialog } from "@/src/components/murph/murph-contact-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { PageHeader } from "@/src/components/ui/page-header";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { browserVaultReplicaRefsMatch } from "@/src/lib/browser-vault/ref";
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
import { EnvironmentVoiceCapture } from "./environment-voice-capture";
import {
  buildEnvironmentVoiceScript,
  type EnvironmentVoiceScript,
} from "./environment-voice-script";
import { selectEnvironmentHabitatValues } from "./habitat-values";
import {
  INDICATOR_SPRITES,
  type HabitatValues,
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "./home-model";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

const EMPTY_HABITAT_VALUES: HabitatValues = {};
const EMPTY_HABITAT_SCENE = resolveHabitatScene(EMPTY_HABITAT_VALUES);
const VOICE_REFRESH_INTERVAL_MS = 2_000;
const VOICE_REFRESH_DELAYED_INTERVAL_MS = 10_000;
const VOICE_REFRESH_REPORT_DELAY_MS = 60_000;
const VOICE_REFRESH_WINDOW_MS = 2 * 60 * 1_000;

export type VoiceRefreshState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "refreshing" }
  | { status: "updated"; factsChanged: boolean }
  | { status: "delayed" };

interface EnvironmentVoiceRefreshBaseline {
  baselineValues: string;
}

type EnvironmentVoiceRefreshProgress =
  | { status: "idle" }
  | (EnvironmentVoiceRefreshBaseline & {
      status: "processing";
    })
  | (EnvironmentVoiceRefreshBaseline & {
      status: "refreshing";
    })
  | (EnvironmentVoiceRefreshBaseline & {
      phase: "processing";
      status: "delayed";
    })
  | (EnvironmentVoiceRefreshBaseline & {
      phase: "refreshing";
      status: "delayed";
    })
  | { status: "updated"; factsChanged: boolean };

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
  const {
    client,
    error,
    ref,
    refresh,
    runtimeRefreshPending,
    status,
  } = useBrowserVault();
  const [voiceRefreshState, setVoiceRefreshState] =
    useState<EnvironmentVoiceRefreshProgress>({ status: "idle" });
  const checkedInitialVoiceProcessingRef = useRef(false);
  const initialVoiceProcessingCheckRef = useRef(0);
  const voiceRefreshStartedAtRef = useRef<number | null>(null);
  const voiceUploadBaselineValuesRef = useRef<string | null>(null);
  const voiceRefreshCompletedReplicaRef =
    useRef<HostedBrowserVaultReplicaRef | null>(null);
  const values = useMemo(
    () => (client ? selectEnvironmentHabitatValues(client) : {}),
    [client],
  );
  const scene = useMemo(() => resolveHabitatScene(values), [values]);
  const notes = useMemo(
    () =>
      scene.categories.map((category) => deriveCategoryNote(category, values)),
    [scene, values],
  );
  const grade = useMemo(() => overallGrade(notes), [notes]);
  const coverage = useMemo(() => resolveEnvironmentCoverage(scene), [scene]);
  const voiceScript = useMemo(
    () => buildEnvironmentVoiceScript(values),
    [values],
  );
  const location = readableLocation(values);
  const conditions = useEnvironmentConditions(location);
  const hasEnvironmentData = hasKnownHabitatValue(values);
  const valuesSignature = JSON.stringify(values);
  const displayedVoiceRefreshState = resolveDisplayedVoiceRefreshState(
    voiceRefreshState,
  );
  const voiceCaptureDisabled =
    voiceRefreshState.status === "processing"
    || voiceRefreshState.status === "refreshing"
    || voiceRefreshState.status === "delayed";
  const onVoiceUploadStarted = useCallback(() => {
    voiceUploadBaselineValuesRef.current = valuesSignature;
  }, [valuesSignature]);
  const onVoiceAccepted = useCallback(() => {
    voiceRefreshStartedAtRef.current = Date.now();
    setVoiceRefreshState({
      baselineValues: voiceUploadBaselineValuesRef.current ?? valuesSignature,
      status: "processing",
    });
    voiceUploadBaselineValuesRef.current = null;
  }, [valuesSignature]);

  useEffect(() => {
    if (
      status === "loading"
      || checkedInitialVoiceProcessingRef.current
    ) {
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
  }, [ref, status, valuesSignature]);

  useEffect(() => {
    if (
      (
        voiceRefreshState.status !== "processing"
        && voiceRefreshState.status !== "delayed"
      )
      || (
        voiceRefreshState.status === "delayed"
        && voiceRefreshState.phase !== "processing"
      )
    ) {
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
      if (processing === false) {
        setVoiceRefreshState((current) =>
          (
            current.status === "processing"
            || (
              current.status === "delayed"
              && current.phase === "processing"
            )
            )
            ? {
                baselineValues: current.baselineValues,
                status: "refreshing",
              }
            : current,
        );
        return;
      }
      if (
        voiceRefreshState.status === "processing"
        && Date.now() - (
          voiceRefreshStartedAtRef.current ?? Date.now()
        ) >= VOICE_REFRESH_WINDOW_MS
      ) {
        setVoiceRefreshState((current) =>
          current.status === "processing"
            ? {
                baselineValues: current.baselineValues,
                phase: "processing",
                status: "delayed",
              }
            : current,
        );
        return;
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
  }, [voiceRefreshState]);

  useEffect(() => {
    if (voiceRefreshState.status !== "refreshing") {
      return;
    }
    voiceRefreshCompletedReplicaRef.current = null;
    const delayedTimeoutId = setTimeout(() => {
      setVoiceRefreshState((current) =>
        current.status === "refreshing"
          ? {
              baselineValues: current.baselineValues,
              phase: "refreshing",
              status: "delayed",
            }
          : current,
      );
    }, VOICE_REFRESH_REPORT_DELAY_MS);
    void refresh({
      background: true,
      requestRuntimeRefreshUntilAfterRequest: (_client, nextRef) => {
        voiceRefreshCompletedReplicaRef.current = nextRef;
        return true;
      },
    }).catch(() => undefined);
    return () => clearTimeout(delayedTimeoutId);
  }, [refresh, voiceRefreshState]);

  useEffect(() => {
    if (
      (
        voiceRefreshState.status !== "refreshing"
        && voiceRefreshState.status !== "delayed"
      )
      || (
        voiceRefreshState.status === "delayed"
        && voiceRefreshState.phase !== "refreshing"
      )
    ) {
      return;
    }
    if (browserVaultReplicaRefsMatch(
      voiceRefreshCompletedReplicaRef.current,
      ref,
    )) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setVoiceRefreshState({
            factsChanged: valuesSignature !== voiceRefreshState.baselineValues,
            status: "updated",
          });
        }
      });
      return () => {
        cancelled = true;
      };
    }
  }, [ref, valuesSignature, voiceRefreshState]);

  if (status === "loading") {
    return (
      <EnvironmentShell>
        <section
          className="rounded-xl border border-border bg-card p-8"
          aria-live="polite"
        >
          <p className="text-sm text-muted-foreground">
            Unlocking what Murph knows about your home…
          </p>
        </section>
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
            <ShareEnvironmentButton disabled={grade.letter === null} />
            <PrintEnvironmentLink />
          </>
        ) : undefined
      }
    >
      <EnvironmentVoiceRefreshNotice
        state={displayedVoiceRefreshState}
        onCheckAgain={() => {
          if (voiceRefreshState.status !== "delayed") {
            return;
          }
          if (voiceRefreshState.phase === "processing") {
            voiceRefreshStartedAtRef.current = Date.now();
            setVoiceRefreshState({
              baselineValues: voiceRefreshState.baselineValues,
              status: "processing",
            });
            void requestEnvironmentVoiceProcessingRecheck().catch(() => undefined);
            return;
          }
          if (!runtimeRefreshPending) {
            voiceRefreshCompletedReplicaRef.current = null;
            setVoiceRefreshState({
              baselineValues: voiceRefreshState.baselineValues,
              status: "refreshing",
            });
            return;
          }
          void refresh({
            background: true,
            retryRuntimeRefreshAfterRequest: true,
          }).catch(() => undefined);
        }}
      />
      {hasEnvironmentData ? (
        <EnvironmentReport
          values={values}
          scene={scene}
          notes={notes}
          grade={grade}
          coverage={coverage}
          contactOptions={contactOptions}
          conditions={conditions}
          onVoiceAccepted={onVoiceAccepted}
          onVoiceUploadStarted={onVoiceUploadStarted}
          voiceCaptureDisabled={voiceCaptureDisabled}
        />
      ) : (
        <EnvironmentEmptyState
          contactOptions={contactOptions}
          onVoiceAccepted={onVoiceAccepted}
          onVoiceUploadStarted={onVoiceUploadStarted}
          processing={voiceCaptureDisabled}
          script={voiceScript}
        />
      )}
    </EnvironmentShell>
  );
}

function resolveDisplayedVoiceRefreshState(
  state: EnvironmentVoiceRefreshProgress,
): VoiceRefreshState {
  if (state.status === "processing" || state.status === "refreshing") {
    return { status: state.status };
  }
  return state.status === "delayed"
    ? { status: "delayed" }
    : state;
}

async function readEnvironmentVoiceProcessingStatus(): Promise<boolean | null> {
  try {
    const response = await fetch("/api/environment/voice", {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    if (
      payload
      && typeof payload === "object"
      && "processing" in payload
      && typeof payload.processing === "boolean"
    ) {
      return payload.processing;
    }
  } catch {
    return null;
  }
  return null;
}

async function requestEnvironmentVoiceProcessingRecheck(): Promise<void> {
  const response = await fetch("/api/environment/voice", {
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
  onVoiceUploadStarted,
  processing = false,
  script = buildEnvironmentVoiceScript(EMPTY_HABITAT_VALUES),
}: {
  contactOptions: readonly MurphContactOption[];
  onVoiceAccepted?: () => void;
  onVoiceUploadStarted?: () => void;
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
            Record a two-minute home tour. Murph will turn the clear details
            into your first personal report.
          </p>

          <div className="mt-8 flex flex-col items-start gap-4">
            <EnvironmentVoiceCapture
              disabled={processing}
              onAccepted={onVoiceAccepted}
              onUploadStarted={onVoiceUploadStarted}
              script={script}
              triggerLabel={
                processing
                  ? "Processing recording…"
                  : script.flow === "walkthrough"
                  ? "Start the 2-minute walkthrough"
                  : script.flow === "fill-gaps"
                    ? "Continue the walkthrough"
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
  scene,
  notes,
  grade,
  coverage,
  contactOptions,
  conditions,
  onVoiceAccepted,
  onVoiceUploadStarted,
  voiceCaptureDisabled,
}: {
  values: HabitatValues;
  scene: ReturnType<typeof resolveHabitatScene>;
  notes: ReturnType<typeof deriveCategoryNote>[];
  grade: ReturnType<typeof overallGrade>;
  coverage: ReturnType<typeof resolveEnvironmentCoverage>;
  contactOptions: readonly MurphContactOption[];
  conditions: { outdoorAir: string; weather: string };
  onVoiceAccepted: () => void;
  onVoiceUploadStarted: () => void;
  voiceCaptureDisabled: boolean;
}) {
  const contactAction = contactOptions[0] ?? null;
  const nextChecks = buildNextChecks(scene, notes);
  const noteByCategoryId = new Map(notes.map((note) => [note.id, note]));
  const voiceScript = buildEnvironmentVoiceScript(values);

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
      />

      <EnvironmentCaptureCard
        contactOptions={contactOptions}
        coverage={coverage.coverage}
        known={coverage.known}
        script={voiceScript}
        onVoiceAccepted={onVoiceAccepted}
        onVoiceUploadStarted={onVoiceUploadStarted}
        processing={voiceCaptureDisabled}
      />

      {contactAction ? (
        <NextChecksStrip items={nextChecks} chatHref={contactAction.href} />
      ) : null}

      <div className="space-y-6">
        {scene.categories.map((category) => {
          const note = noteByCategoryId.get(category.id);
          return note ? (
            <CategoryCard
              key={category.id}
              category={category}
              note={note}
              chatHref={contactAction?.href ?? null}
            />
          ) : null;
        })}
      </div>
    </>
  );
}

export function EnvironmentCaptureCard({
  contactOptions,
  coverage,
  known,
  script,
  onVoiceAccepted,
  onVoiceUploadStarted,
  processing = false,
}: {
  contactOptions: readonly MurphContactOption[];
  coverage: number;
  known: number;
  script: EnvironmentVoiceScript;
  onVoiceAccepted?: () => void;
  onVoiceUploadStarted?: () => void;
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
            ? "Keep your environment current"
            : known === 0
              ? "Build your environment report in one take"
              : coverage < 50
                ? "Complete the picture"
                : "Fill the remaining gaps"}
        </h2>
        <p className="mt-1 max-w-[68ch] text-pretty text-base text-muted-foreground sm:text-sm">
          {updating
            ? "Record anything that changed. You do not need to repeat what Murph already knows."
            : known === 0
              ? "Walk through sleep, air, light, recovery and work. Murph saves only the clear details."
              : `This ${
                  topicCount === 1
                    ? "short recording covers the one remaining topic"
                    : `short recording covers ${topicCount} topics`
                } and focuses on the ${missing} useful ${
                  missing === 1 ? "detail" : "details"
                } Murph still needs.`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <EnvironmentVoiceCapture
          triggerSize="default"
          disabled={processing}
          onAccepted={onVoiceAccepted}
          onUploadStarted={onVoiceUploadStarted}
          script={script}
          triggerLabel={
            processing
              ? "Processing recording…"
              : updating
              ? "Update by voice"
              : known === 0
                ? "Start walkthrough"
                : "Fill in what's missing"
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

function EnvironmentChatAction({
  contactOptions,
  label,
  presentation,
}: {
  contactOptions: readonly MurphContactOption[];
  label: string;
  presentation: "button" | "link";
}) {
  if (contactOptions.length === 0) {
    return null;
  }

  const content = (
    <>
      {label}
      <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
    </>
  );
  const contactAction = contactOptions[0];

  if (contactOptions.length === 1 && contactAction) {
    if (presentation === "link") {
      return (
        <a
          href={contactAction.href}
          target={contactAction.target}
          rel={contactAction.rel}
          className="inline-flex min-h-11 items-center gap-1.5 text-base font-medium text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground sm:min-h-0 sm:text-sm"
        >
          {content}
        </a>
      );
    }
    return (
      <Button
        size="default"
        variant="ghost"
        render={
          <a
            href={contactAction.href}
            target={contactAction.target}
            rel={contactAction.rel}
          />
        }
        nativeButton={false}
      >
        {content}
      </Button>
    );
  }

  return (
    <MurphContactDialog
      options={contactOptions}
      trigger={(open) =>
        presentation === "link" ? (
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1.5 text-base font-medium text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground sm:min-h-0 sm:text-sm"
            onClick={open}
          >
            {content}
          </button>
        ) : (
          <Button size="default" variant="ghost" onClick={open}>
            {content}
          </Button>
        )
      }
    />
  );
}

export function EnvironmentVoiceRefreshNotice({
  onCheckAgain,
  state,
}: {
  onCheckAgain: () => void;
  state: VoiceRefreshState;
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
          Murph is processing your recording
        </AlertTitle>
        <AlertDescription>
          This report will refresh automatically when the clear facts are ready.
        </AlertDescription>
      </Alert>
    );
  }
  if (state.status === "refreshing") {
    return (
      <Alert aria-live="polite">
        <AlertTitle className="flex items-center gap-2">
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin text-primary motion-reduce:animate-none"
          />
          Updating your environment report
        </AlertTitle>
        <AlertDescription>
          Murph finished processing your recording. This page is waiting for
          the newer private report.
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
            ? "The new details are now visible below."
            : "Murph could not add any details from this recording. You can try again or tell Murph in chat."}
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
          <span>You do not need to record it again. Check again to continue.</span>
          <Button size="sm" variant="outline" onClick={onCheckAgain}>
            Check again
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
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
    return "Not known";
  }
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return "Not known";
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
    return { outdoorAir: "Add your city", weather: "Add your city" };
  }
  if (!result || result.location !== location) {
    return { outdoorAir: "Checking…", weather: "Checking…" };
  }
  if (result.failed || !result.conditions) {
    return { outdoorAir: "Unavailable", weather: "Unavailable" };
  }
  const { conditions } = result;

  return {
    outdoorAir: conditions.airQuality
      ? `${airQualityLabel(conditions.airQuality.aqi)} · PM2.5 ${Math.round(
          conditions.airQuality.pm25,
        )} µg/m³`
      : "Unavailable",
    weather: conditions.weather
      ? `${Math.round(conditions.weather.temperatureC)}°C · ${sentenceCase(
          conditions.weather.description,
        )}`
      : "Unavailable",
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
