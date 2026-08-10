import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import type { BrowserTrainingView } from "../src/lib/training/browser-training";

const mocks = vi.hoisted(() => ({
  useBrowserVault: vi.fn(),
  useBrowserVaultSelector: vi.fn(),
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  useBrowserVault: mocks.useBrowserVault,
  useBrowserVaultSelector: mocks.useBrowserVaultSelector,
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton: ({ children }: { children: ReactNode }) =>
    createElement("button", null, children),
}));

import TrainingPageClient, {
  TrainingPageView,
} from "../app/(dashboard)/training/training-page-client";
import { TrainingDashboardStudy } from "../app/design/training-dashboard-study";
import { renderClientComponent } from "./render-client-component";

const trainingFixture: BrowserTrainingView = {
  activeSession: {
    activityType: "strength-training",
    completedSetCount: 1,
    date: "2026-08-09",
    durationMinutes: null,
    endedAt: null,
    exerciseCount: 1,
    exercises: [
      {
        id: "EX001",
        name: "Bench press",
        note: null,
        order: 1,
        sets: [
          {
            addedWeightKg: null,
            assistanceKg: null,
            bodyweightKg: null,
            completed: true,
            distanceMeters: null,
            durationSeconds: null,
            id: "active-set-1",
            note: null,
            order: 1,
            reps: 8,
            rpe: 8,
            weight: 155,
            weightUnit: "lb",
          },
          {
            addedWeightKg: null,
            assistanceKg: null,
            bodyweightKg: null,
            completed: false,
            distanceMeters: null,
            durationSeconds: null,
            id: "active-set-2",
            note: null,
            order: 2,
            reps: null,
            rpe: null,
            weight: null,
            weightUnit: null,
          },
        ],
        sourceExerciseId: "EX001",
      },
    ],
    id: "active-workout",
    note: null,
    setCount: 2,
    startedAt: "2026-08-09T17:00:00.000Z",
    state: "in_progress",
    title: "Push day",
  },
  exerciseProgress: [
    {
      bestSet: {
        addedWeightKg: null,
        assistanceKg: null,
        bodyweightKg: null,
        completed: true,
        distanceMeters: null,
        durationSeconds: null,
        id: "best-set",
        note: null,
        order: 2,
        reps: 8,
        rpe: 8,
        weight: 155,
        weightUnit: "lb",
      },
      id: "EX001",
      lastPerformedDate: "2026-08-09",
      lastSet: {
        addedWeightKg: null,
        assistanceKg: null,
        bodyweightKg: null,
        completed: true,
        distanceMeters: null,
        durationSeconds: null,
        id: "last-set",
        note: null,
        order: 1,
        reps: 8,
        rpe: 8,
        weight: 155,
        weightUnit: "lb",
      },
      name: "Bench press",
      sessionCount: 2,
      setCount: 4,
    },
  ],
  generatedAt: "2026-08-09T18:00:00.000Z",
  recentSessions: [
    {
      activityType: "strength-training",
      completedSetCount: 2,
      date: "2026-08-07",
      durationMinutes: 48,
      endedAt: "2026-08-07T17:48:00.000Z",
      exerciseCount: 1,
      exercises: [
        {
          id: "EX001",
          name: "Bench press",
          note: "Pause at the chest",
          order: 1,
          sets: [
            {
              addedWeightKg: null,
              assistanceKg: null,
              bodyweightKg: null,
              completed: true,
              distanceMeters: null,
              durationSeconds: null,
              id: "completed-set-1",
              note: "Smooth tempo",
              order: 1,
              reps: 10,
              rpe: null,
              weight: 135,
              weightUnit: "lb",
            },
            {
              addedWeightKg: null,
              assistanceKg: null,
              bodyweightKg: null,
              completed: true,
              distanceMeters: null,
              durationSeconds: null,
              id: "completed-set-2",
              note: null,
              order: 2,
              reps: 8,
              rpe: 8,
              weight: 145,
              weightUnit: "lb",
            },
          ],
          sourceExerciseId: "EX001",
        },
      ],
      id: "completed-workout",
      note: null,
      setCount: 2,
      startedAt: "2026-08-07T17:00:00.000Z",
      state: "completed",
      title: "Push day",
    },
  ],
  summary: {
    exerciseCount: 1,
    setCount: 3,
    trainingDayCount: 2,
    workoutCount: 2,
  },
  weeks: Array.from({ length: 8 }, (_, index) => ({
    count: index === 7 ? 2 : 0,
    label: `Week ${index + 1}`,
    startDate: `2026-0${index + 1}-01`,
  })),
};

const startContactOptions = [
  {
    href: "sms:+15555550100?body=Start%20a%20workout%20with%20me.",
    kind: "text" as const,
    label: "Text Murph",
  },
];

const continueContactOptions = [
  {
    href: "sms:+15555550100?body=Continue%20my%20active%20workout.",
    kind: "text" as const,
    label: "Text Murph",
  },
];

beforeEach(() => {
  mocks.useBrowserVault.mockReturnValue({
    error: null,
    refresh: async () => {},
    refreshPending: false,
    status: "ready",
  });
  mocks.useBrowserVaultSelector.mockReturnValue(trainingFixture);
});

test("Training renders live progress, history and a continuation action for the active workout", () => {
  const markup = renderToStaticMarkup(
    createElement(TrainingPageClient, {
      authenticated: true,
      continueContactOptions,
      startContactOptions,
    }),
  );

  assert.match(markup, /Your private log/);
  assert.match(markup, /Review recent workouts and see what is improving here/);
  assert.doesNotMatch(markup, /Review every workout/);
  assert.match(markup, /In progress/);
  assert.match(markup, /1 of 2 sets logged/);
  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /aria-valuenow="50"/);
  assert.match(markup, /Last 30 days/);
  assert.match(markup, /Recent workouts/);
  assert.match(markup, /Exercise progress/);
  assert.match(markup, /135 lb × 10/);
  assert.match(markup, /Pause at the chest/);
  assert.match(markup, /Smooth tempo/);
  assert.match(markup, /155 lb × 8/);
  assert.match(markup, /Continue workout/);
  assert.match(
    markup,
    /href="sms:\+15555550100\?body=Continue%20my%20active%20workout\."/,
  );
  assert.doesNotMatch(
    markup,
    /href="sms:\+15555550100\?body=Start%20a%20workout%20with%20me\."/,
  );
  assert.match(markup, /Same weight, 8 reps/);
});

test("Training gives a zero-data member one clear conversational start", () => {
  mocks.useBrowserVaultSelector.mockReturnValue({
    ...trainingFixture,
    activeSession: null,
    exerciseProgress: [],
    recentSessions: [],
    summary: {
      exerciseCount: 0,
      setCount: 0,
      trainingDayCount: 0,
      workoutCount: 0,
    },
  });

  const markup = renderToStaticMarkup(
    createElement(TrainingPageClient, {
      authenticated: true,
      continueContactOptions,
      startContactOptions,
    }),
  );

  assert.match(markup, /Your workout log starts with one message/);
  assert.match(markup, /Bench 135 lb × 10/);
  assert.match(markup, /Start workout/);
  assert.match(
    markup,
    /href="sms:\+15555550100\?body=Start%20a%20workout%20with%20me\."/,
  );
  assert.equal((markup.match(/body=Start%20a%20workout/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /Last 30 days/);
  assert.equal((markup.match(/Just tell Murph what happened/g) ?? []).length, 0);
});

test("Training waits for a generation refresh before declaring workout history empty", () => {
  const staleMarkup = renderToStaticMarkup(
    createElement(TrainingPageView, {
      authenticated: true,
      continueContactOptions,
      error: null,
      onRefresh: () => {},
      refreshPending: true,
      startContactOptions,
      status: "ready",
      training: null,
    }),
  );

  assert.match(staleMarkup, /Preparing your training view/);
  assert.match(staleMarkup, /Check again/);
  assert.doesNotMatch(staleMarkup, /Loading your training log/);
  assert.doesNotMatch(staleMarkup, /Your workout log starts with one message/);
  assert.doesNotMatch(staleMarkup, /Start workout/);

  const refreshedMarkup = renderToStaticMarkup(
    createElement(TrainingPageView, {
      authenticated: true,
      continueContactOptions,
      error: null,
      onRefresh: () => {},
      refreshPending: false,
      startContactOptions,
      status: "ready",
      training: trainingFixture,
    }),
  );

  assert.match(refreshedMarkup, /Recent workouts/);
  assert.match(refreshedMarkup, /Push day/);
  assert.equal((refreshedMarkup.match(/Pause at the chest/g) ?? []).length, 1);
  assert.doesNotMatch(refreshedMarkup, /Your workout log starts with one message/);
});

test("Training keeps a delayed generation refresh actionable after background polling ends", async () => {
  const onRefresh = vi.fn();
  const rendered = await renderClientComponent(
    createElement(TrainingPageView, {
      authenticated: true,
      continueContactOptions,
      error: null,
      onRefresh,
      refreshPending: true,
      startContactOptions,
      status: "ready",
      training: null,
    }),
  );

  try {
    assert.match(rendered.container.textContent ?? "", /Preparing your training view/);
    assert.match(rendered.container.textContent ?? "", /Check again/);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Loading your training log/);
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
    assert.equal(onRefresh.mock.calls.length, 1);
  } finally {
    await rendered.cleanup();
  }
});

test("Training exposes workout actions only when vault state is known", () => {
  for (const status of ["loading", "error"] as const) {
    const markup = renderToStaticMarkup(
      createElement(TrainingPageView, {
        authenticated: true,
        continueContactOptions,
        error: status === "error" ? "Refresh failed." : null,
        onRefresh: () => {},
        refreshPending: false,
        startContactOptions,
        status,
        training: null,
      }),
    );

    assert.doesNotMatch(markup, /Start workout|Continue workout/);
    assert.doesNotMatch(markup, /body=Start%20a%20workout/);
    assert.doesNotMatch(markup, /body=Continue%20my%20active%20workout/);
    assert.match(
      markup,
      status === "loading" ? /Loading your training log/ : /Retry/,
    );
  }

  for (const status of ["loading", "error"] as const) {
    const markup = renderToStaticMarkup(
      createElement(TrainingPageView, {
        authenticated: true,
        continueContactOptions,
        error: status === "error" ? "Refresh failed." : null,
        onRefresh: () => {},
        refreshPending: false,
        startContactOptions,
        status,
        training: trainingFixture,
      }),
    );

    assert.match(markup, /Continue workout/);
    assert.match(markup, /body=Continue%20my%20active%20workout/);
    assert.doesNotMatch(markup, /body=Start%20a%20workout/);
  }

  const resolvedEmptyMarkup = renderToStaticMarkup(
    createElement(TrainingPageView, {
      authenticated: true,
      continueContactOptions,
      error: null,
      onRefresh: () => {},
      refreshPending: false,
      startContactOptions,
      status: "empty",
      training: null,
    }),
  );
  assert.match(resolvedEmptyMarkup, /Start workout/);
  assert.match(resolvedEmptyMarkup, /body=Start%20a%20workout/);

  const signedOutMarkup = renderToStaticMarkup(
    createElement(TrainingPageView, {
      authenticated: false,
      continueContactOptions: [],
      error: null,
      onRefresh: () => {},
      refreshPending: false,
      startContactOptions: [],
      status: "empty",
      training: null,
    }),
  );
  assert.equal(
    (signedOutMarkup.match(/Log in to start training/g) ?? []).length,
    1,
  );

  const noMessagingMarkup = renderToStaticMarkup(
    createElement(TrainingPageView, {
      authenticated: true,
      continueContactOptions: [],
      error: null,
      onRefresh: () => {},
      refreshPending: false,
      startContactOptions: [],
      status: "empty",
      training: null,
    }),
  );
  assert.equal((noMessagingMarkup.match(/href="\/settings"/g) ?? []).length, 1);
});

test("Training handles an empty active workout without presenting false zero-percent failure", () => {
  mocks.useBrowserVaultSelector.mockReturnValue({
    ...trainingFixture,
    activeSession: {
      ...trainingFixture.activeSession!,
      completedSetCount: 0,
      exerciseCount: 0,
      exercises: [],
      setCount: 0,
      title: "Workout",
    },
  });

  const markup = renderToStaticMarkup(
    createElement(TrainingPageClient, {
      authenticated: true,
      continueContactOptions,
      startContactOptions,
    }),
  );

  assert.match(markup, />Ready</);
  assert.match(markup, /Tell Murph your first exercise/);
  assert.doesNotMatch(markup, /0%/);
  assert.doesNotMatch(markup, /role="progressbar"/);
});

test("Training design study renders the production dashboard with synthetic data", () => {
  const markup = renderToStaticMarkup(createElement(TrainingDashboardStudy));

  assert.match(markup, /58%/);
  assert.match(markup, /Recent workouts/);
  assert.match(markup, /Exercise progress/);
  assert.match(markup, /135 lb × 10/);
  assert.match(markup, /data-training-study-state="loading"/);
  assert.match(markup, /Loading your training log/);
  assert.match(markup, /data-training-study-state="refresh-pending"/);
  assert.match(markup, /Preparing your training view/);
  assert.match(markup, /Check again/);
  assert.match(markup, /Could not refresh your training log/);
  assert.match(markup, /Log in to start training/);
  assert.match(markup, /Set up messaging/);
  assert.doesNotMatch(markup, /<picture|<img|design-proof/);
});

test("Training offers a clear setup path when no messaging channel is available", () => {
  const markup = renderToStaticMarkup(
    createElement(TrainingPageClient, {
      authenticated: true,
      continueContactOptions: [],
      startContactOptions: [],
    }),
  );

  assert.match(markup, /Set up messaging/);
  assert.match(markup, /href="\/settings"/);
});
