import assert from "node:assert/strict";

import { act, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
} from "@murphai/query/browser";

import {
  selectBrowserVaultTraining,
  type BrowserTrainingView,
} from "../src/lib/training/browser-training";
import type { BrowserVaultContextValue } from "../src/lib/browser-vault/context";

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
    distanceKm: null,
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
      distanceKm: null,
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

async function createActiveTrainingClient() {
  return createBrowserVaultQueryClient(
    await createBrowserVaultReplica({
      generatedAt: "2026-08-09T18:00:00.000Z",
      metricPoints: [],
      sourceBundleHash: "active-training-baseline",
      vault: createVaultReadModel({
        entities: [{
          attributes: {
            activityType: "strength-training",
            source: "manual",
            title: "Push day",
            workout: {
              exercises: [],
              sourceApp: "murph-live",
              startedAt: "2026-08-09T17:00:00.000Z",
            },
          },
          body: null,
          date: "2026-08-09",
          entityId: "active-workout",
          experimentSlug: null,
          family: "event",
          frontmatter: null,
          kind: "activity_session",
          links: [],
          lookupIds: ["active-workout"],
          occurredAt: "2026-08-09T17:00:00.000Z",
          path: "history/events/active-workout.jsonl",
          primaryLookupId: "active-workout",
          recordClass: "ledger",
          relatedIds: [],
          status: null,
          stream: null,
          tags: [],
          title: null,
        }],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    }),
  );
}

beforeEach(() => {
  mocks.useBrowserVault.mockReturnValue({
    error: null,
    ref: {
      sourceBundleHash: "a".repeat(64),
    },
    refresh: async () => {},
    refreshPending: false,
    runtimeRefreshPending: false,
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

test("Training keeps canonical date-only labels stable across browser time zones", () => {
  const dateOnlyTraining: BrowserTrainingView = {
    ...trainingFixture,
    exerciseProgress: trainingFixture.exerciseProgress.map((entry) => ({
      ...entry,
      lastPerformedDate: "2026-01-15",
    })),
    recentSessions: trainingFixture.recentSessions.map((session) => ({
      ...session,
      date: "2026-01-15",
    })),
  };
  const previousTimeZone = process.env.TZ;

  try {
    for (const timeZone of [
      "Pacific/Auckland",
      "Pacific/Kiritimati",
      "America/Los_Angeles",
    ]) {
      process.env.TZ = timeZone;
      const markup = renderToStaticMarkup(
        createElement(TrainingPageView, {
          authenticated: true,
          continueContactOptions,
          error: null,
          onRefresh: () => {},
          refreshPending: false,
          startContactOptions,
          status: "ready",
          training: dateOnlyTraining,
        }),
      );

      assert.equal((markup.match(/Jan 15/g) ?? []).length, 2, timeZone);
      assert.doesNotMatch(markup, /Jan 16/, timeZone);
    }
  } finally {
    if (previousTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimeZone;
    }
  }
});

test("Training requests one runtime-owned refresh after its messaging handoff returns", async () => {
  const unchangedClient = await createActiveTrainingClient();
  const changedClient = createBrowserVaultQueryClient(
    await createBrowserVaultReplica({
      generatedAt: "2026-08-09T18:05:00.000Z",
      metricPoints: [],
      sourceBundleHash: "training-source-change",
      vault: createVaultReadModel({
        entities: [{
          attributes: {
            activityType: "running",
            distanceKm: 4.828032,
            durationMinutes: 45,
            source: "manual",
            title: "45-minute run",
            workout: {
              exercises: [],
              sessionNote: "45 minute trail run 3 mi",
            },
          },
          body: null,
          date: "2026-08-09",
          entityId: "training_update",
          experimentSlug: null,
          family: "event",
          frontmatter: null,
          kind: "activity_session",
          links: [],
          lookupIds: ["training_update"],
          occurredAt: "2026-08-09T18:00:00.000Z",
          path: "history/events/training-update.jsonl",
          primaryLookupId: "training_update",
          recordClass: "ledger",
          relatedIds: [],
          status: null,
          stream: null,
          tags: [],
          title: null,
        }],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    }),
  );
  const refresh = vi.fn<BrowserVaultContextValue["refresh"]>(async () => {});
  let currentClient = unchangedClient;
  mocks.useBrowserVault.mockImplementation(() => ({
    client: currentClient,
    error: null,
    ref: {
      sourceBundleHash: "a".repeat(64),
    },
    refresh,
    refreshPending: false,
    runtimeRefreshPending: false,
    status: "ready",
  }));
  const rendered = await renderClientComponent(
    createElement(TrainingPageClient, {
      authenticated: true,
      continueContactOptions,
      startContactOptions,
    }),
    { requireButton: false },
  );

  try {
    await act(async () => {
      rendered.window.dispatchEvent(new rendered.window.Event("focus"));
      await Promise.resolve();
    });
    assert.equal(refresh.mock.calls.length, 0);

    const continueLink = [...rendered.container.querySelectorAll("a")]
      .find((link) => link.textContent?.includes("Continue workout"));
    assert.ok(continueLink);
    await act(async () => {
      continueLink.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
      rendered.window.dispatchEvent(new rendered.window.Event("focus"));
      await Promise.resolve();
    });
    assert.equal(refresh.mock.calls.length, 1);
    const refreshOptions = refresh.mock.calls[0]?.[0];
    assert.equal(refreshOptions?.background, true);
    assert.equal(typeof refreshOptions?.requestRuntimeRefreshUntil, "function");
    assert.equal(
      refreshOptions?.requestRuntimeRefreshUntil?.(unchangedClient),
      false,
    );
    await act(async () => {
      rendered.window.dispatchEvent(new rendered.window.Event("focus"));
      await Promise.resolve();
    });
    assert.equal(refresh.mock.calls.length, 1);
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Start workout|Continue workout/,
    );

    await act(async () => {
      assert.equal(
        refreshOptions?.requestRuntimeRefreshUntil?.(changedClient),
        true,
      );
      currentClient = changedClient;
    });
    const cardioUpdate = selectBrowserVaultTraining(changedClient);
    assert.equal(cardioUpdate.recentSessions[0]?.distanceKm, 4.828032);
    await rendered.rerender(
      createElement(TrainingPageClient, {
        authenticated: true,
        continueContactOptions,
        startContactOptions,
      }),
    );
    assert.match(rendered.container.textContent ?? "", /Continue workout/);

    currentClient = unchangedClient;
    await rendered.rerender(
      createElement(TrainingPageClient, {
        authenticated: true,
        continueContactOptions,
        startContactOptions,
      }),
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Checking for your saved update|Update not visible yet/,
    );
    assert.match(rendered.container.textContent ?? "", /Continue workout/);
  } finally {
    await rendered.cleanup();
  }
});

test("Training shows bounded recovery when the runtime owner expires a stalled request", async () => {
  let runtimeRefreshPending = false;
  const client = await createActiveTrainingClient();
  const refresh = vi.fn<BrowserVaultContextValue["refresh"]>(
    () => new Promise<void>(() => {}),
  );
  mocks.useBrowserVault.mockImplementation(() => ({
    client,
    error: null,
    ref: {
      sourceBundleHash: "a".repeat(64),
    },
    refresh,
    refreshPending: runtimeRefreshPending,
    runtimeRefreshPending,
    status: "ready",
  }));
  const createTrainingElement = () => createElement(
    TrainingPageClient,
    {
      authenticated: true,
      continueContactOptions,
      startContactOptions,
    },
  );
  const rendered = await renderClientComponent(createTrainingElement(), {
    requireButton: false,
  });

  try {
    const continueLink = [...rendered.container.querySelectorAll("a")]
      .find((link) => link.textContent?.includes("Continue workout"));
    assert.ok(continueLink);
    continueLink.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
    runtimeRefreshPending = true;
    await rendered.rerender(createTrainingElement());
    await act(async () => {
      rendered.window.dispatchEvent(new rendered.window.Event("focus"));
      await Promise.resolve();
    });
    assert.match(
      rendered.container.textContent ?? "",
      /Checking for your saved update/,
    );
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Start workout|Continue workout/,
    );
    assert.equal(refresh.mock.calls.length, 1);

    runtimeRefreshPending = false;
    await rendered.rerender(createTrainingElement());
    assert.match(rendered.container.textContent ?? "", /Update not visible yet/);
    assert.match(rendered.container.textContent ?? "", /Recent workouts/);
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Start workout|Continue workout/,
    );

    const checkAgain = [...rendered.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Check again"));
    assert.ok(checkAgain);
    const cancelUpdate = [...rendered.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("didn't send an update"));
    assert.ok(cancelUpdate);
    await act(async () => {
      checkAgain.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    assert.equal(refresh.mock.calls.length, 2);

    await act(async () => {
      cancelUpdate.dispatchEvent(
        new rendered.window.Event("click", { bubbles: true }),
      );
    });
    assert.equal(refresh.mock.calls.length, 2);
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Checking for your saved update|Update not visible yet/,
    );
    assert.match(rendered.container.textContent ?? "", /Continue workout/);
  } finally {
    await rendered.cleanup();
  }
});

test("Training rolls its local date forward while the same replica stays mounted", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 9, 23, 59, 59, 900));
  const emptyClient = createBrowserVaultQueryClient(
    await createBrowserVaultReplica({
      generatedAt: "2026-08-09T12:00:00.000Z",
      metricPoints: [],
      sourceBundleHash: "mounted-midnight-training",
      vault: createVaultReadModel({
        entities: [],
        metadata: null,
        vaultRoot: "browser://vault",
      }),
    }),
  );
  const currentWeekStarts: string[] = [];
  mocks.useBrowserVaultSelector.mockImplementation((selector) => {
    const view = selector(emptyClient);
    currentWeekStarts.push(view.weeks.at(-1)?.startDate ?? "none");
    return view;
  });

  const rendered = await renderClientComponent(
    createElement(TrainingPageClient, {
      authenticated: true,
      continueContactOptions,
      startContactOptions,
    }),
    { requireButton: false },
  );

  try {
    assert.equal(currentWeekStarts.at(-1), "2026-08-03");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    assert.equal(currentWeekStarts.at(-1), "2026-08-10");
  } finally {
    await rendered.cleanup();
    vi.useRealTimers();
  }
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

test("Training keeps retained data visible while a Messages update is checked and recoverable", () => {
  const checkingMarkup = renderToStaticMarkup(
    createElement(TrainingPageView, {
      authenticated: true,
      continueContactOptions,
      error: null,
      handoffRefreshState: "checking",
      onCheckUpdate: () => {},
      onRefresh: () => {},
      refreshPending: true,
      startContactOptions,
      status: "ready",
      training: trainingFixture,
    }),
  );

  assert.match(checkingMarkup, /Checking for your saved update/);
  assert.match(checkingMarkup, /Recent workouts/);
  assert.doesNotMatch(checkingMarkup, /Update not visible yet/);
  assert.doesNotMatch(checkingMarkup, /Start workout|Continue workout/);

  const onCheckUpdate = vi.fn();
  const onCancelUpdate = vi.fn();
  const recoveryMarkup = renderToStaticMarkup(
    createElement(TrainingPageView, {
      authenticated: true,
      continueContactOptions,
      error: null,
      handoffRefreshState: "not_visible",
      onCancelUpdate,
      onCheckUpdate,
      onRefresh: () => {},
      refreshPending: false,
      startContactOptions,
      status: "ready",
      training: trainingFixture,
    }),
  );

  assert.match(recoveryMarkup, /Update not visible yet/);
  assert.match(recoveryMarkup, /I didn&#x27;t send an update/);
  assert.match(recoveryMarkup, /Check again/);
  assert.match(recoveryMarkup, /Recent workouts/);
  assert.doesNotMatch(recoveryMarkup, /Start workout|Continue workout/);

  const emptyRecoveryMarkup = renderToStaticMarkup(
    createElement(TrainingPageView, {
      authenticated: true,
      continueContactOptions,
      error: null,
      handoffRefreshState: "not_visible",
      onCancelUpdate,
      onCheckUpdate,
      onRefresh: () => {},
      refreshPending: false,
      startContactOptions,
      status: "ready",
      training: null,
    }),
  );

  assert.match(emptyRecoveryMarkup, /Update not visible yet/);
  assert.match(emptyRecoveryMarkup, /I didn&#x27;t send an update/);
  assert.match(emptyRecoveryMarkup, /Check again/);
  assert.doesNotMatch(emptyRecoveryMarkup, /Start workout|Continue workout/);
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

test("Training shows both cardio measurements without calling a slower effort Best", () => {
  const fiveMinuteSet = {
    addedWeightKg: null,
    assistanceKg: null,
    bodyweightKg: null,
    completed: true,
    distanceMeters: 1_000,
    durationSeconds: 300,
    id: "cardio-five-minutes",
    note: null,
    order: 1,
    reps: null,
    rpe: null,
    weight: null,
    weightUnit: null,
  };
  const sixMinuteSet = {
    ...fiveMinuteSet,
    durationSeconds: 360,
    id: "cardio-six-minutes",
    order: 2,
  };
  const cardioTraining: BrowserTrainingView = {
    ...trainingFixture,
    activeSession: null,
    exerciseProgress: [
      {
        bestSet: null,
        id: "EX_CARDIO_ROW",
        lastPerformedDate: "2026-08-09",
        lastSet: sixMinuteSet,
        name: "Row",
        sessionCount: 1,
        setCount: 2,
      },
    ],
    recentSessions: [
      {
        activityType: "cardio",
        completedSetCount: 2,
        date: "2026-08-09",
        distanceKm: 4.828032,
        durationMinutes: 11,
        endedAt: "2026-08-09T17:11:00.000Z",
        exerciseCount: 1,
        exercises: [
          {
            id: "EX_CARDIO_ROW",
            name: "Row",
            note: null,
            order: 1,
            sets: [fiveMinuteSet, sixMinuteSet],
            sourceExerciseId: "EX_CARDIO_ROW",
          },
        ],
        id: "cardio-session",
        note: null,
        setCount: 2,
        startedAt: "2026-08-09T17:00:00.000Z",
        state: "completed",
        title: "Row intervals",
      },
    ],
    summary: {
      exerciseCount: 1,
      setCount: 2,
      trainingDayCount: 1,
      workoutCount: 1,
    },
  };
  const markup = renderToStaticMarkup(
    createElement(TrainingPageView, {
      authenticated: true,
      continueContactOptions,
      error: null,
      onRefresh: () => {},
      refreshPending: false,
      startContactOptions,
      status: "ready",
      training: cardioTraining,
    }),
  );

  assert.match(markup, /5 min · 1 km/);
  assert.match(markup, /6 min · 1 km/);
  assert.match(markup, /11 min · 4.8 km/);
  assert.match(markup, /Best<\/p><p[^>]*>—<\/p>/);
  assert.doesNotMatch(markup, /Best<\/p><p[^>]*>6 min · 1 km<\/p>/);
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
  assert.match(markup, /data-training-study-state="handoff-checking"/);
  assert.match(markup, /Checking for your saved update/);
  assert.match(markup, /data-training-study-state="handoff-not-visible"/);
  assert.match(markup, /Update not visible yet/);
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
