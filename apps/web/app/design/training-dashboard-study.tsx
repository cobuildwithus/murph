import { TrainingDashboard } from "@/app/(dashboard)/training/training-page-client";
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

const TRAINING_STUDY_VIEW: BrowserTrainingView = {
  activeSession: {
    activityType: "strength-training",
    completedSetCount: 7,
    date: "2026-08-09",
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

export function TrainingDashboardStudy() {
  return <TrainingDashboard training={TRAINING_STUDY_VIEW} />;
}
