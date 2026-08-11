"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Dumbbell,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import type { BrowserVaultQueryClient } from "@murphai/query/browser-replica-client";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { AuthButton } from "@/src/components/ui/auth-button";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  useBrowserVault,
  useBrowserVaultSelector,
} from "@/src/lib/browser-vault/context";
import { formatIsoDate, formatNumber } from "@/src/lib/browser-vault/display";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import {
  createTrainingHandoffBaseline,
  isTrainingHandoffComplete,
  selectBrowserVaultTraining,
  type BrowserTrainingView,
  type TrainingHandoffBaseline,
  type TrainingExerciseProgress,
  type TrainingExerciseView,
  type TrainingSessionView,
  type TrainingSetView,
} from "@/src/lib/training/browser-training";
import { cn } from "@/src/lib/utils";

const MESSAGE_EXAMPLES = [
  "Start my push workout",
  "Bench 135 lb × 10",
  "Same weight, 8 reps",
  "Actually set two was 9",
] as const;

export type TrainingRefreshState =
  | "idle"
  | "checking"
  | "not_visible";

export type TrainingRefreshKind = "initial" | "handoff";

type TrainingRefreshBaseline =
  | {
      client: BrowserVaultQueryClient;
      kind: "initial";
    }
  | {
      handoff: TrainingHandoffBaseline;
      kind: "handoff";
    };

function isTrainingRefreshComplete(
  baseline: TrainingRefreshBaseline,
  client: BrowserVaultQueryClient,
): boolean {
  return baseline.kind === "initial"
    ? client !== baseline.client
    : isTrainingHandoffComplete(baseline.handoff, client);
}

function useTrainingNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let midnightTimeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleMidnightRefresh = (current: Date) => {
      const nextMidnight = new Date(current);
      nextMidnight.setHours(24, 0, 0, 0);
      midnightTimeout = setTimeout(() => {
        const refreshedNow = new Date();
        setNow(refreshedNow);
        scheduleMidnightRefresh(refreshedNow);
      }, Math.max(1_000, nextMidnight.getTime() - current.getTime() + 50));
    };
    const refreshNow = () => {
      const refreshedNow = new Date();
      setNow(refreshedNow);
      if (midnightTimeout) {
        clearTimeout(midnightTimeout);
      }
      scheduleMidnightRefresh(refreshedNow);
    };
    const refreshVisibleNow = () => {
      if (document.visibilityState !== "hidden") {
        refreshNow();
      }
    };

    scheduleMidnightRefresh(new Date());
    window.addEventListener("focus", refreshNow);
    document.addEventListener("visibilitychange", refreshVisibleNow);
    return () => {
      window.removeEventListener("focus", refreshNow);
      document.removeEventListener("visibilitychange", refreshVisibleNow);
      if (midnightTimeout) {
        clearTimeout(midnightTimeout);
      }
    };
  }, []);

  return now;
}

export default function TrainingPageClient({
  authenticated,
  continueContactOptions,
  startContactOptions,
}: {
  authenticated: boolean;
  continueContactOptions: readonly MurphContactOption[];
  startContactOptions: readonly MurphContactOption[];
}) {
  const {
    client,
    error,
    refresh,
    refreshPending,
    runtimeRefreshPending,
    status,
  } = useBrowserVault();
  const trainingNow = useTrainingNow();
  const selectTraining = useCallback(
    (client: Parameters<typeof selectBrowserVaultTraining>[0]) =>
      selectBrowserVaultTraining(client, { now: trainingNow }),
    [trainingNow],
  );
  const training = useBrowserVaultSelector(selectTraining);
  const refreshAfterContactRef = useRef<TrainingHandoffBaseline | null>(null);
  // null waits for the first admitted client; undefined is terminal. Both the
  // admission check and a later Messages handoff reuse this one page-local
  // baseline and the Browser Vault provider's existing bounded refresh owner.
  const [refreshBaseline, setRefreshBaseline]
    = useState<TrainingRefreshBaseline | null | undefined>(null);
  if (refreshBaseline === null && status === "ready" && client) {
    setRefreshBaseline({ client, kind: "initial" });
  }
  const requestBaselineRefresh = useCallback(
    (baseline: TrainingRefreshBaseline) => {
      void refresh({
        background: true,
        requestRuntimeRefreshUntil: (client) =>
          isTrainingRefreshComplete(baseline, client),
      });
    },
    [refresh],
  );
  useEffect(() => {
    if (refreshBaseline?.kind === "initial") {
      requestBaselineRefresh(refreshBaseline);
    }
  }, [refreshBaseline, requestBaselineRefresh]);
  const replacementVisible = refreshBaseline !== null
    && refreshBaseline !== undefined
    && client !== null
    && isTrainingRefreshComplete(refreshBaseline, client);
  if (replacementVisible) {
    const completedBaseline = refreshBaseline;
    setRefreshBaseline((current) =>
      current === completedBaseline ? undefined : current
    );
  }
  const refreshState: TrainingRefreshState =
    refreshBaseline === null
      || refreshBaseline === undefined
      || replacementVisible
      || status === "error"
      ? "idle"
      : runtimeRefreshPending
        ? "checking"
        : "not_visible";
  const markContactHandoff = useCallback(() => {
    refreshAfterContactRef.current = client
      ? createTrainingHandoffBaseline(client)
      : null;
  }, [client]);

  useEffect(() => {
    const refreshAfterContact = () => {
      const refreshRequest = refreshAfterContactRef.current;
      if (!refreshRequest || document.visibilityState === "hidden") {
        return;
      }
      refreshAfterContactRef.current = null;
      const baseline: TrainingRefreshBaseline = {
        handoff: refreshRequest,
        kind: "handoff",
      };
      setRefreshBaseline(baseline);
      requestBaselineRefresh(baseline);
    };

    window.addEventListener("focus", refreshAfterContact);
    document.addEventListener("visibilitychange", refreshAfterContact);
    return () => {
      window.removeEventListener("focus", refreshAfterContact);
      document.removeEventListener("visibilitychange", refreshAfterContact);
    };
  }, [requestBaselineRefresh]);

  return (
    <TrainingPageView
      authenticated={authenticated}
      continueContactOptions={continueContactOptions}
      error={error}
      onCancelRefresh={() => setRefreshBaseline(undefined)}
      onCheckRefresh={() => {
        if (refreshBaseline) {
          requestBaselineRefresh(refreshBaseline);
        }
      }}
      onContactAction={markContactHandoff}
      onRefresh={() => void refresh()}
      refreshKind={refreshBaseline?.kind}
      refreshState={refreshState}
      refreshPending={refreshPending}
      startContactOptions={startContactOptions}
      status={status}
      training={training}
    />
  );
}

export function TrainingPageView({
  authenticated,
  continueContactOptions,
  error,
  onCancelRefresh,
  onCheckRefresh,
  onContactAction,
  onRefresh,
  refreshKind = "handoff",
  refreshState = "idle",
  refreshPending,
  startContactOptions,
  status,
  training,
}: {
  authenticated: boolean;
  continueContactOptions: readonly MurphContactOption[];
  error: string | null;
  onCancelRefresh?: () => void;
  onCheckRefresh?: () => void;
  onContactAction?: () => void;
  onRefresh: () => void;
  refreshKind?: TrainingRefreshKind;
  refreshState?: TrainingRefreshState;
  refreshPending: boolean;
  startContactOptions: readonly MurphContactOption[];
  status: ReturnType<typeof useBrowserVault>["status"];
  training: BrowserTrainingView | null;
}) {
  const activeSession = training?.activeSession ?? null;
  const hasTraining = Boolean(
    training
      && (training.activeSession || training.recentSessions.length > 0),
  );
  const primaryContactOption = activeSession
    ? continueContactOptions[0] ?? null
    : hasTraining
      ? startContactOptions[0] ?? null
      : null;
  const primaryActionLabel = activeSession
    ? "Continue workout"
    : hasTraining
      ? "Start workout"
      : null;
  const preparing = status === "loading";
  const awaitingRefresh = !preparing
    && status !== "error"
    && !hasTraining
    && refreshPending
    && refreshState === "idle";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          eyebrow="Your private log"
          title="Training"
          description="Log sets by messaging Murph. Review recent workouts and see what is improving here."
        />
        {primaryActionLabel && refreshState === "idle" ? (
          <ContactAction
            authenticated={authenticated}
            className="w-full sm:w-auto"
            label={primaryActionLabel}
            onContactAction={onContactAction}
            option={primaryContactOption}
          />
        ) : null}
      </div>

      {preparing ? <TrainingSkeleton /> : null}

      {status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Could not refresh your training log</AlertTitle>
          <AlertDescription>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {error ?? "Your saved workouts are not available right now."}
              </span>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={onRefresh}
              >
                <RefreshCw aria-hidden="true" />
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {refreshState !== "idle" ? (
        <TrainingRefreshNotice
          kind={refreshKind}
          onCancel={onCancelRefresh}
          onCheck={onCheckRefresh}
          state={refreshState}
        />
      ) : null}

      {awaitingRefresh ? (
        <Alert>
          <AlertTitle>Preparing your training view</AlertTitle>
          <AlertDescription>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Murph is still checking for saved workouts. If this takes more
                than a moment, check again.
              </span>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={onRefresh}
              >
                <RefreshCw aria-hidden="true" />
                Check again
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {!preparing && hasTraining && training ? (
        <TrainingDashboard training={training} />
      ) : null}

      {!preparing
        && !awaitingRefresh
        && status !== "error"
        && !hasTraining
        && refreshState === "idle" ? (
        <EmptyTraining
          authenticated={authenticated}
          contactOption={startContactOptions[0] ?? null}
          onContactAction={onContactAction}
        />
      ) : null}

      {status === "error" && !hasTraining ? <MessageGuide /> : null}
    </div>
  );
}

function TrainingRefreshNotice({
  kind,
  onCancel,
  onCheck,
  state,
}: {
  kind: TrainingRefreshKind;
  onCancel?: () => void;
  onCheck?: () => void;
  state: Exclude<TrainingRefreshState, "idle">;
}) {
  const initial = kind === "initial";
  const title = state === "checking"
    ? initial
      ? "Checking for recent updates"
      : "Checking for your saved update"
    : initial
      ? "Recent updates not visible yet"
      : "Update not visible yet";
  const description = state === "checking"
    ? initial
      ? "Murph is checking for the latest saved workouts. Anything already available stays visible."
      : "Your current training stays visible while Murph checks for the update from Messages."
    : initial
      ? "The latest saved workouts have not reached this view yet. You can use what is visible or check again."
      : "The saved update has not reached this view yet. Your current training is still available.";

  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{description}</span>
          {state === "not_visible" ? (
            <div className="flex flex-wrap gap-2">
              {onCancel ? (
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={onCancel}
                >
                  {initial ? "Use current view" : "I didn't send an update"}
                </Button>
              ) : null}
              {onCheck ? (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={onCheck}
                >
                  <RefreshCw aria-hidden="true" />
                  Check again
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function TrainingDashboard({ training }: { training: BrowserTrainingView }) {
  return (
    <div className="flex flex-col gap-8">
      {training.activeSession ? (
        <ActiveWorkout session={training.activeSession} />
      ) : null}
      <Summary training={training} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
        <RecentWorkouts sessions={training.recentSessions} />
        <ExerciseProgress entries={training.exerciseProgress} />
      </div>
      <MessageGuide />
    </div>
  );
}

function ActiveWorkout({ session }: { session: TrainingSessionView }) {
  const hasSets = session.setCount > 0;
  const progress = hasSets
    ? Math.round((session.completedSetCount / session.setCount) * 100)
    : 0;

  return (
    <section
      aria-labelledby="active-workout-heading"
      className={cn(
        "overflow-hidden rounded-2xl bg-linear-to-br text-white shadow-sm",
        "from-[#2d3436] via-[#3a2e24] to-[#2a1f16]",
      )}
    >
      <div className="grid gap-7 px-5 py-6 md:px-8 md:py-8 lg:grid-cols-[1fr_13rem] lg:items-end">
        <div>
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-[#a6b88a]"
            />
            In progress
          </p>
          <h2
            className="mt-4 font-serif text-3xl font-semibold"
            id="active-workout-heading"
          >
            {session.title}
          </h2>
          <p className="mt-2 text-sm text-white/60">
            {session.exerciseCount}{" "}
            {pluralize(session.exerciseCount, "exercise")}
            {hasSets
              ? ` · ${session.completedSetCount} of ${session.setCount} sets logged`
              : ""}
          </p>
          {session.exercises.length > 0 ? (
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {session.exercises.map((exercise) => (
                <ActiveExercise exercise={exercise} key={exercise.id} />
              ))}
            </div>
          ) : (
            <p className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm leading-relaxed text-white/65">
              Tell Murph your first exercise and it will appear here.
            </p>
          )}
        </div>
        <div>
          <div className="flex items-end justify-between gap-3">
            <span className="font-serif text-5xl font-semibold tabular-nums">
              {hasSets ? `${progress}%` : "Ready"}
            </span>
            <span className="pb-1 text-xs text-white/50">
              {hasSets ? "complete" : "to log"}
            </span>
          </div>
          {hasSets ? (
            <div
              aria-label={`${progress}% of workout sets logged`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progress}
              className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-[#a6b88a]"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
          <p className="mt-4 text-xs leading-relaxed text-white/55">
            Keep messaging Murph as you go. One message updates this same private
            workout record.
          </p>
        </div>
      </div>
    </section>
  );
}

function ActiveExercise({ exercise }: { exercise: TrainingExerciseView }) {
  const completed = exercise.sets.filter((set) => set.completed).length;
  const done =
    exercise.sets.length > 0 && completed === exercise.sets.length;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full border",
          done
            ? "border-[#a6b88a]/40 bg-[#a6b88a]/15"
            : "border-white/15",
        )}
      >
        {done ? (
          <Check aria-hidden="true" className="size-3.5 text-[#d7e1c7]" />
        ) : (
          exercise.order
        )}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white/90">
          {exercise.name}
        </p>
        {exercise.note ? (
          <p className="truncate text-xs text-white/60">{exercise.note}</p>
        ) : null}
        <p className="text-xs text-white/60">
          {completed}/{exercise.sets.length} sets
        </p>
      </div>
    </div>
  );
}

function Summary({ training }: { training: BrowserTrainingView }) {
  const stats = [
    ["Workouts", training.summary.workoutCount],
    ["Training days", training.summary.trainingDayCount],
    ["Sets logged", training.summary.setCount],
    ["Exercises", training.summary.exerciseCount],
  ] as const;

  return (
    <section aria-labelledby="training-summary-heading">
      <SectionHeading
        description="A simple view of consistency and volume."
        id="training-summary-heading"
        title="Last 30 days"
      />
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map(([label, value], index) => (
            <div
              className={cn(
                "px-5 py-5 md:px-6",
                index % 2 === 1 && "border-l border-border/70",
                index >= 2 && "border-t border-border/70",
                index > 0 && "lg:border-l lg:border-border/70",
                "lg:border-t-0",
              )}
              key={label}
            >
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                {label}
              </p>
              <p className="mt-2 font-serif text-3xl font-semibold tabular-nums">
                {formatNumber(value, { maximumFractionDigits: 0 })}
              </p>
            </div>
          ))}
        </div>
        <Consistency weeks={training.weeks} />
      </div>
    </section>
  );
}

function Consistency({ weeks }: { weeks: BrowserTrainingView["weeks"] }) {
  const max = Math.max(1, ...weeks.map((week) => week.count));

  return (
    <div className="border-t border-border/70 px-5 py-5 md:px-6">
      <div className="flex justify-between gap-4 text-sm">
        <p className="font-medium">Eight-week consistency</p>
        <p className="text-muted-foreground">Workouts per week</p>
      </div>
      <div className="mt-5 grid h-24 grid-cols-8 items-end gap-2 sm:gap-3">
        {weeks.map((week) => (
          <div
            className="flex h-full flex-col items-center justify-end gap-2"
            key={week.startDate}
          >
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {week.count || ""}
            </span>
            <div
              aria-label={`${week.label}: ${week.count} ${pluralize(
                week.count,
                "workout",
              )}`}
              className={cn(
                "w-full max-w-12 rounded-t-md",
                week.count ? "bg-primary/75" : "bg-muted",
              )}
              role="img"
              style={{
                height: week.count
                  ? Math.max(18, Math.round((week.count / max) * 72))
                  : 6,
              }}
            />
            <span className="hidden truncate font-mono text-[8px] uppercase text-muted-foreground sm:block">
              {week.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentWorkouts({
  sessions,
}: {
  sessions: readonly TrainingSessionView[];
}) {
  return (
    <section aria-labelledby="recent-workouts-heading">
      <SectionHeading
        description="Open a session to review every recorded set."
        id="recent-workouts-heading"
        title="Recent workouts"
      />
      {sessions.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70">
          {sessions.map((session, index) => (
            <WorkoutDetails
              key={session.id}
              open={index === 0}
              session={session}
            />
          ))}
        </div>
      ) : (
        <SmallEmpty text="Finished workouts will appear here." />
      )}
    </section>
  );
}

function WorkoutDetails({
  open,
  session,
}: {
  open: boolean;
  session: TrainingSessionView;
}) {
  return (
    <details
      className="group border-b border-border/70 last:border-0"
      open={open}
    >
      <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Dumbbell aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{session.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatIsoDate(session.date, {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
              year: "numeric",
            })}
            {session.durationMinutes
              ? ` · ${session.durationMinutes} min`
              : ""}
            {session.distanceKm !== null
              ? ` · ${formatNumber(session.distanceKm, {
                  maximumFractionDigits: 1,
                })} km`
              : ""}
            {session.exerciseCount
              ? ` · ${session.exerciseCount} ${pluralize(
                  session.exerciseCount,
                  "exercise",
                )}`
              : ""}
            {session.completedSetCount
              ? ` · ${session.completedSetCount} ${pluralize(
                  session.completedSetCount,
                  "set",
                )}`
              : ""}
          </p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-border/60 bg-muted/[0.16] px-4 py-5 sm:px-5">
        <div className="flex flex-col gap-5">
          {session.exercises.length > 0 ? (
            session.exercises.map((exercise) => (
              <ExerciseSets exercise={exercise} key={exercise.id} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No exercise details were recorded for this workout.
            </p>
          )}
        </div>
        {session.note ? (
          <p className="mt-5 border-l-2 border-primary/30 pl-3 text-sm text-muted-foreground">
            {session.note}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function ExerciseSets({ exercise }: { exercise: TrainingExerciseView }) {
  const sets = exercise.sets.filter((set) => set.completed);

  return (
    <div>
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-medium">{exercise.name}</h4>
          {exercise.note ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {exercise.note}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {sets.length} {pluralize(sets.length, "set")}
        </span>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-background/70">
        {sets.length > 0 ? (
          sets.map((set) => {
            const value = formatTrainingSet(set);
            return (
              <div
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 border-b border-border/60 px-3 py-2.5 last:border-0"
                key={set.id}
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  {set.order}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium tabular-nums">
                    {value}
                  </span>
                  {set.note && value !== set.note ? (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {set.note}
                    </span>
                  ) : null}
                </span>
                {set.rpe !== null ? (
                  <span className="text-xs text-muted-foreground">
                    RPE {compact(set.rpe)}
                  </span>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            No completed sets recorded.
          </p>
        )}
      </div>
    </div>
  );
}

function ExerciseProgress({
  entries,
}: {
  entries: readonly TrainingExerciseProgress[];
}) {
  return (
    <section aria-labelledby="exercise-progress-heading">
      <SectionHeading
        description="Latest and strongest sets from the last six months."
        id="exercise-progress-heading"
        title="Exercise progress"
      />
      {entries.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70">
          {entries.map((entry) => (
            <div
              className="border-b border-border/70 px-4 py-4 last:border-0"
              key={entry.id}
            >
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium">{entry.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.sessionCount}{" "}
                    {pluralize(entry.sessionCount, "workout")} ·{" "}
                    {entry.setCount} {pluralize(entry.setCount, "set")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatIsoDate(entry.lastPerformedDate, {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <ProgressValue label="Last" set={entry.lastSet} />
                <ProgressValue label="Best" set={entry.bestSet} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <SmallEmpty text="Progress appears after Murph has a few completed sets." />
      )}
    </section>
  );
}

function ProgressValue({
  label,
  set,
}: {
  label: string;
  set: TrainingSetView | null;
}) {
  const value = set ? formatTrainingSet(set) : "—";

  return (
    <div className="rounded-xl bg-muted/55 px-3 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className="mt-1 truncate text-sm font-semibold tabular-nums"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyTraining({
  authenticated,
  contactOption,
  onContactAction,
}: {
  authenticated: boolean;
  contactOption: MurphContactOption | null;
  onContactAction?: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/70 px-6 py-10 md:px-10 md:py-12">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Dumbbell aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-6 max-w-lg font-serif text-3xl font-semibold">
        Your workout log starts with one message.
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Tell Murph what you are doing at the gym. Sets, reps, weight and
        corrections become one private history you can review here over time.
      </p>
      <ContactAction
        authenticated={authenticated}
        className="mt-6 w-full sm:w-fit"
        label="Start workout"
        onContactAction={onContactAction}
        option={contactOption}
      />
      <div className="mt-9 border-t border-border/70 pt-7">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          Try saying
        </p>
        <MessageExamples className="mt-3" />
      </div>
    </section>
  );
}

function MessageGuide() {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/70 px-5 py-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessageCircle aria-hidden="true" className="size-4" />
        </span>
        <div>
          <h2 className="font-serif text-xl font-semibold">
            Just tell Murph what happened.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start, log, correct or ask what you did last time without opening
            another app.
          </p>
        </div>
      </div>
      <MessageExamples className="mt-5" />
    </section>
  );
}

function MessageExamples({ className }: { className?: string }) {
  return (
    <ul className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {MESSAGE_EXAMPLES.map((message) => (
        <li
          className="rounded-xl border border-border/70 bg-background/70 px-3 py-3 text-sm"
          key={message}
        >
          “{message}”
        </li>
      ))}
    </ul>
  );
}

function ContactAction({
  authenticated,
  className,
  label,
  onContactAction,
  option,
}: {
  authenticated: boolean;
  className?: string;
  label: string;
  onContactAction?: () => void;
  option: MurphContactOption | null;
}) {
  if (!authenticated) {
    return (
      <AuthButton className={className} size="lg">
        Log in to start training
      </AuthButton>
    );
  }
  if (!option) {
    return (
      <a
        aria-label="Set up messaging to use training"
        className={cn(
          buttonVariants({ size: "lg", variant: "outline" }),
          className,
        )}
        href="/settings"
      >
        <MessageCircle aria-hidden="true" />
        Set up messaging
      </a>
    );
  }
  return (
    <a
      aria-label={`${label} with ${option.label}`}
      className={cn(buttonVariants({ size: "lg" }), className)}
      href={option.href}
      onClick={onContactAction}
      rel={option.rel}
      target={option.target}
    >
      <MessageCircle aria-hidden="true" />
      {label}
    </a>
  );
}

function SectionHeading({
  description,
  id,
  title,
}: {
  description: string;
  id: string;
  title: string;
}) {
  return (
    <div className="mb-4">
      <h2
        className="font-serif text-2xl font-semibold tracking-tight"
        id={id}
      >
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function SmallEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function TrainingSkeleton() {
  return (
    <div
      aria-label="Loading training log"
      className="flex flex-col gap-6"
      role="status"
    >
      <div className="h-52 animate-pulse rounded-2xl bg-muted" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="h-28 animate-pulse bg-muted" key={index} />
        ))}
      </div>
      <span className="sr-only">Loading your training log.</span>
    </div>
  );
}

function formatTrainingSet(set: TrainingSetView): string {
  const load = set.weight !== null
    ? `${compact(set.weight)}${set.weightUnit ? ` ${set.weightUnit}` : ""}`
    : set.addedWeightKg !== null
      ? `+${compact(set.addedWeightKg)} kg`
      : set.assistanceKg !== null
        ? `${compact(set.assistanceKg)} kg assist`
        : set.bodyweightKg !== null
          ? "Bodyweight"
          : null;

  const measurements: string[] = [];
  if (load && set.reps !== null) {
    measurements.push(`${load} × ${set.reps}`);
  } else if (load) {
    measurements.push(load);
  } else if (set.reps !== null) {
    measurements.push(`${set.reps} ${pluralize(set.reps, "rep")}`);
  }
  if (set.durationSeconds !== null) {
    measurements.push(formatDuration(set.durationSeconds));
  }
  if (set.distanceMeters !== null) {
    measurements.push(formatDistance(set.distanceMeters));
  }
  if (measurements.length > 0) {
    return measurements.join(" · ");
  }
  if (set.note) return set.note;
  return "Completed";
}

function formatDuration(seconds: number): string {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  if (roundedSeconds < 60) return `${roundedSeconds} sec`;
  const minutes = Math.floor(roundedSeconds / 60);
  const remainder = roundedSeconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes} min`;
}

function formatDistance(meters: number): string {
  return meters >= 1_000
    ? `${compact(meters / 1_000)} km`
    : `${compact(meters)} m`;
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

function pluralize(value: number, singular: string): string {
  return value === 1 ? singular : `${singular}s`;
}
