"use client";

import type { ReactNode } from "react";

import {
  TrainingPageView,
  type TrainingHandoffRefreshState,
} from "@/app/(dashboard)/training/training-page-client";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import type {
  BrowserTrainingView,
  TrainingSetView,
} from "@/src/lib/training/browser-training";

function studySet(input: {
  completed: boolean;
  id: string;
  note?: string;
  order: number;
  reps?: number;
  rpe?: number;
  weight?: number;
}): TrainingSetView {
  return {
    addedWeightKg: null,
    assistanceKg: null,
    bodyweightKg: null,
    completed: input.completed,
    distanceMeters: null,
    durationSeconds: null,
    id: input.id,
    note: input.note ?? null,
    order: input.order,
    reps: input.reps ?? null,
    rpe: input.rpe ?? null,
    weight: input.weight ?? null,
    weightUnit: input.weight === undefined ? null : "lb",
  };
}

const benchLast = studySet({
  completed: true,
  id: "progress-bench-last",
  order: 3,
  reps: 6,
  weight: 155,
});
const benchBest = studySet({
  completed: true,
  id: "progress-bench-best",
  order: 2,
  reps: 9,
  weight: 155,
});
const inclineLast = studySet({
  completed: true,
  id: "progress-incline-last",
  order: 3,
  reps: 8,
  weight: 55,
});
const inclineBest = studySet({
  completed: true,
  id: "progress-incline-best",
  order: 1,
  reps: 8,
  weight: 60,
});
const lateralLast = studySet({
  completed: true,
  id: "progress-lateral-last",
  order: 3,
  reps: 12,
  weight: 20,
});
const lateralBest = studySet({
  completed: true,
  id: "progress-lateral-best",
  order: 2,
  reps: 10,
  weight: 25,
});

const STUDY_CONTACT_OPTION: MurphContactOption = {
  href: "sms:+15555550100?body=Continue%20my%20workout.",
  kind: "text",
  label: "Text Murph",
};

const TRAINING_STUDY_VIEW: BrowserTrainingView = {
  activeSession: {
    activityType: "strength-training",
    completedSetCount: 7,
    date: "2026-08-09",
    distanceKm: null,
    durationMinutes: null,
    endedAt: null,
    exerciseCount: 4,
    exercises: [
      {
        id: "active-bench",
        name: "Bench press",
        note: null,
        order: 1,
        sets: [
          studySet({ completed: true, id: "active-bench-1", order: 1, reps: 10, weight: 135 }),
          studySet({ completed: true, id: "active-bench-2", order: 2, reps: 9, weight: 150 }),
          studySet({ completed: true, id: "active-bench-3", order: 3, reps: 7, weight: 150 }),
        ],
        sourceExerciseId: "bench-press",
      },
      {
        id: "active-incline",
        name: "Incline dumbbell press",
        note: null,
        order: 2,
        sets: [
          studySet({ completed: true, id: "active-incline-1", order: 1, reps: 10, weight: 55 }),
          studySet({ completed: true, id: "active-incline-2", order: 2, reps: 9, weight: 55 }),
          studySet({ completed: true, id: "active-incline-3", order: 3, reps: 8, weight: 55 }),
        ],
        sourceExerciseId: "incline-dumbbell-press",
      },
      {
        id: "active-lateral",
        name: "Lateral raise",
        note: null,
        order: 3,
        sets: [
          studySet({ completed: true, id: "active-lateral-1", order: 1, reps: 12, weight: 20 }),
          studySet({ completed: false, id: "active-lateral-2", order: 2 }),
          studySet({ completed: false, id: "active-lateral-3", order: 3 }),
        ],
        sourceExerciseId: "lateral-raise",
      },
      {
        id: "active-triceps",
        name: "Triceps pressdown",
        note: null,
        order: 4,
        sets: [
          studySet({ completed: false, id: "active-triceps-1", order: 1 }),
          studySet({ completed: false, id: "active-triceps-2", order: 2 }),
          studySet({ completed: false, id: "active-triceps-3", order: 3 }),
        ],
        sourceExerciseId: "triceps-pressdown",
      },
    ],
    id: "active-push-day",
    note: null,
    setCount: 12,
    startedAt: "2026-08-09T14:30:00.000Z",
    state: "in_progress",
    title: "Push day",
  },
  exerciseProgress: [
    {
      bestSet: benchBest,
      id: "bench-press",
      lastPerformedDate: "2026-08-09",
      lastSet: benchLast,
      name: "Bench press",
      sessionCount: 11,
      setCount: 34,
    },
    {
      bestSet: inclineBest,
      id: "incline-dumbbell-press",
      lastPerformedDate: "2026-08-09",
      lastSet: inclineLast,
      name: "Incline dumbbell press",
      sessionCount: 9,
      setCount: 29,
    },
    {
      bestSet: lateralBest,
      id: "lateral-raise",
      lastPerformedDate: "2026-08-09",
      lastSet: lateralLast,
      name: "Lateral raise",
      sessionCount: 7,
      setCount: 24,
    },
  ],
  generatedAt: "2026-08-09T16:00:00.000Z",
  recentSessions: [
    {
      activityType: "strength-training",
      completedSetCount: 9,
      date: "2026-08-06",
      distanceKm: null,
      durationMinutes: 52,
      endedAt: "2026-08-06T20:22:00.000Z",
      exerciseCount: 3,
      exercises: [
        {
          id: "recent-bench",
          name: "Bench press",
          note: null,
          order: 1,
          sets: [
            studySet({ completed: true, id: "recent-bench-1", order: 1, reps: 10, weight: 135 }),
            studySet({ completed: true, id: "recent-bench-2", order: 2, reps: 8, weight: 150 }),
            studySet({ completed: true, id: "recent-bench-3", order: 3, reps: 7, weight: 150 }),
          ],
          sourceExerciseId: "bench-press",
        },
        {
          id: "recent-incline",
          name: "Incline dumbbell press",
          note: null,
          order: 2,
          sets: [
            studySet({ completed: true, id: "recent-incline-1", order: 1, reps: 10, weight: 55 }),
            studySet({ completed: true, id: "recent-incline-2", order: 2, reps: 9, weight: 55 }),
            studySet({ completed: true, id: "recent-incline-3", order: 3, reps: 8, weight: 55 }),
          ],
          sourceExerciseId: "incline-dumbbell-press",
        },
        {
          id: "recent-lateral",
          name: "Lateral raise",
          note: null,
          order: 3,
          sets: [
            studySet({ completed: true, id: "recent-lateral-1", order: 1, reps: 12, weight: 20 }),
            studySet({ completed: true, id: "recent-lateral-2", order: 2, reps: 10, weight: 25 }),
            studySet({ completed: true, id: "recent-lateral-3", order: 3, reps: 12, weight: 20 }),
          ],
          sourceExerciseId: "lateral-raise",
        },
      ],
      id: "recent-push-day",
      note: "Felt strong. Add five pounds next time.",
      setCount: 9,
      startedAt: "2026-08-06T19:30:00.000Z",
      state: "completed",
      title: "Push day",
    },
  ],
  summary: {
    exerciseCount: 12,
    setCount: 78,
    trainingDayCount: 9,
    workoutCount: 9,
  },
  weeks: [
    { count: 2, label: "Jun 22", startDate: "2026-06-22" },
    { count: 3, label: "Jun 29", startDate: "2026-06-29" },
    { count: 2, label: "Jul 6", startDate: "2026-07-06" },
    { count: 3, label: "Jul 13", startDate: "2026-07-13" },
    { count: 3, label: "Jul 20", startDate: "2026-07-20" },
    { count: 2, label: "Jul 27", startDate: "2026-07-27" },
    { count: 3, label: "Aug 3", startDate: "2026-08-03" },
    { count: 1, label: "Aug 10", startDate: "2026-08-10" },
  ],
};

const COMPLETED_TRAINING_STUDY_VIEW: BrowserTrainingView = {
  ...TRAINING_STUDY_VIEW,
  activeSession: null,
};

const ZERO_SET_TRAINING_STUDY_VIEW: BrowserTrainingView = {
  ...TRAINING_STUDY_VIEW,
  activeSession: {
    ...TRAINING_STUDY_VIEW.activeSession!,
    completedSetCount: 0,
    exerciseCount: 0,
    exercises: [],
    setCount: 0,
    title: "Workout",
  },
};

export function TrainingDashboardStudy() {
  return (
    <div className="flex flex-col gap-16">
      <TrainingStudyPage
        id="populated-active"
        status="ready"
        title="Populated · active workout"
        training={TRAINING_STUDY_VIEW}
      />
      <TrainingStudyPage
        id="completed-history"
        status="ready"
        title="Completed history · no active workout"
        training={COMPLETED_TRAINING_STUDY_VIEW}
      />
      <TrainingStudyPage
        id="active-zero-set"
        status="ready"
        title="Active workout · ready for first set"
        training={ZERO_SET_TRAINING_STUDY_VIEW}
      />
      <TrainingStudyPage
        id="loading"
        status="loading"
        title="Loading"
        training={null}
      />
      <TrainingStudyPage
        id="refresh-pending"
        refreshPending
        status="ready"
        title="Preparing older workout history · recovery available"
        training={null}
      />
      <TrainingStudyPage
        handoffRefreshState="checking"
        id="handoff-checking"
        refreshPending
        status="ready"
        title="Messages handoff · checking with retained data"
        training={COMPLETED_TRAINING_STUDY_VIEW}
      />
      <TrainingStudyPage
        handoffRefreshState="not_visible"
        id="handoff-not-visible"
        status="ready"
        title="Messages handoff · update not visible yet"
        training={COMPLETED_TRAINING_STUDY_VIEW}
      />
      <TrainingStudyPage
        id="empty"
        status="empty"
        title="Empty history"
        training={null}
      />
      <TrainingStudyPage
        error="Your saved workouts could not be refreshed."
        id="error"
        status="error"
        title="Vault error · retry available"
        training={null}
      />
      <TrainingStudyPage
        authenticated={false}
        id="signed-out"
        messagingConfigured={false}
        status="empty"
        title="Signed out"
        training={null}
      />
      <TrainingStudyPage
        id="no-messaging"
        messagingConfigured={false}
        status="ready"
        title="Authenticated · messaging not configured"
        training={TRAINING_STUDY_VIEW}
      />
    </div>
  );
}

function TrainingStudyPage({
  authenticated = true,
  error = null,
  handoffRefreshState = "idle",
  id,
  messagingConfigured = true,
  refreshPending = false,
  status,
  title,
  training,
}: {
  authenticated?: boolean;
  error?: string | null;
  handoffRefreshState?: TrainingHandoffRefreshState;
  id: string;
  messagingConfigured?: boolean;
  refreshPending?: boolean;
  status: "empty" | "error" | "loading" | "ready";
  title: string;
  training: BrowserTrainingView | null;
}) {
  const contactOptions = messagingConfigured ? [STUDY_CONTACT_OPTION] : [];

  return (
    <TrainingStudyState id={id} title={title}>
      <TrainingPageView
        authenticated={authenticated}
        continueContactOptions={contactOptions}
        error={error}
        handoffRefreshState={handoffRefreshState}
        onCheckUpdate={() => undefined}
        onRefresh={() => undefined}
        refreshPending={refreshPending}
        startContactOptions={contactOptions}
        status={status}
        training={training}
      />
    </TrainingStudyState>
  );
}

function TrainingStudyState({
  children,
  id,
  title,
}: {
  children: ReactNode;
  id: string;
  title: string;
}) {
  return (
    <section data-training-study-state={id}>
      <p className="mb-5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      {children}
    </section>
  );
}
