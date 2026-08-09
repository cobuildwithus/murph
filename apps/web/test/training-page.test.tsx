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

import TrainingPageClient from "../app/(dashboard)/training/training-page-client";

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
        mode: "weight_reps",
        name: "Bench press",
        note: null,
        order: 1,
        sets: [
          {
            addedWeightKg: null,
            assistanceKg: null,
            bodyweightKg: null,
            completed: true,
            completedAt: "2026-08-09T17:10:00.000Z",
            distanceMeters: null,
            durationSeconds: null,
            id: "active-set-1",
            note: null,
            order: 1,
            reps: 8,
            rpe: 8,
            type: null,
            weight: 155,
            weightUnit: "lb",
          },
          {
            addedWeightKg: null,
            assistanceKg: null,
            bodyweightKg: null,
            completed: false,
            completedAt: null,
            distanceMeters: null,
            durationSeconds: null,
            id: "active-set-2",
            note: null,
            order: 2,
            reps: 8,
            rpe: null,
            type: null,
            weight: 155,
            weightUnit: "lb",
          },
        ],
        sourceExerciseId: "EX001",
      },
    ],
    id: "active-workout",
    note: null,
    routineId: null,
    setCount: 2,
    source: "manual",
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
        completedAt: null,
        distanceMeters: null,
        durationSeconds: null,
        id: "best-set",
        note: null,
        order: 2,
        reps: 8,
        rpe: 8,
        type: null,
        weight: 155,
        weightUnit: "lb",
      },
      id: "EX001",
      lastPerformedAt: "2026-08-09T17:00:00.000Z",
      lastSet: {
        addedWeightKg: null,
        assistanceKg: null,
        bodyweightKg: null,
        completed: true,
        completedAt: null,
        distanceMeters: null,
        durationSeconds: null,
        id: "last-set",
        note: null,
        order: 1,
        reps: 8,
        rpe: 8,
        type: null,
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
          mode: "weight_reps",
          name: "Bench press",
          note: null,
          order: 1,
          sets: [
            {
              addedWeightKg: null,
              assistanceKg: null,
              bodyweightKg: null,
              completed: true,
              completedAt: null,
              distanceMeters: null,
              durationSeconds: null,
              id: "completed-set-1",
              note: null,
              order: 1,
              reps: 10,
              rpe: null,
              type: null,
              weight: 135,
              weightUnit: "lb",
            },
            {
              addedWeightKg: null,
              assistanceKg: null,
              bodyweightKg: null,
              completed: true,
              completedAt: null,
              distanceMeters: null,
              durationSeconds: null,
              id: "completed-set-2",
              note: null,
              order: 2,
              reps: 8,
              rpe: 8,
              type: null,
              weight: 145,
              weightUnit: "lb",
            },
          ],
          sourceExerciseId: "EX001",
        },
      ],
      id: "completed-workout",
      note: null,
      routineId: null,
      setCount: 2,
      source: "manual",
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

beforeEach(() => {
  mocks.useBrowserVault.mockReturnValue({
    error: null,
    refresh: async () => {},
    refreshPending: false,
    status: "ready",
  });
  mocks.useBrowserVaultSelector.mockReturnValue(trainingFixture);
});

test("Training renders live progress, workout history and longitudinal exercise context", () => {
  const markup = renderToStaticMarkup(
    createElement(TrainingPageClient, {
      authenticated: true,
      contactOptions: [
        {
          href: "sms:+15555550100?body=Start%20a%20workout%20with%20me.",
          kind: "text",
          label: "Text Murph",
        },
      ],
    }),
  );

  assert.match(markup, /Your private log/);
  assert.match(markup, /In progress/);
  assert.match(markup, /1 of 2 sets logged/);
  assert.match(markup, /Last 30 days/);
  assert.match(markup, /Recent workouts/);
  assert.match(markup, /Exercise progress/);
  assert.match(markup, /135 lb × 10/);
  assert.match(markup, /155 lb × 8/);
  assert.match(markup, /href="sms:\+15555550100\?body=/);
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
      contactOptions: [
        {
          href: "sms:+15555550100?body=Start%20a%20workout%20with%20me.",
          kind: "text",
          label: "Text Murph",
        },
      ],
    }),
  );

  assert.match(markup, /Your workout log starts with one message/);
  assert.match(markup, /Bench 135 lb × 10/);
  assert.match(markup, /Text Murph/);
  assert.doesNotMatch(markup, /Last 30 days/);
});
