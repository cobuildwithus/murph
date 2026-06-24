import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

import type { ExperimentLibraryCard } from "@/src/lib/experiments/library-cards";

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: string;
  }) {
    return createElement(
      "a",
      {
        className: props.className,
        href: props.href,
      },
      props.children,
    );
  },
}));

test("HomeExperimentCard shows the member's result instead of protocol imagery and copy", async () => {
  const { HomeExperimentCard } = await import(
    "@/src/components/home/home-experiment-card"
  );
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card: resultCard(),
  }));

  assert.match(markup, /data-home-experiment-card/);
  assert.match(markup, /Deep sleep/);
  assert.match(markup, /\+13 min/);
  assert.match(markup, /Baseline/);
  assert.match(markup, /70 min/);
  assert.match(markup, /Latest/);
  assert.match(markup, /83 min/);
  assert.match(markup, /Private data/);
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /Protocol preview copy that should stay hidden/);
});

test("HomeExperimentCard keeps low-confidence completed runs concise", async () => {
  const { HomeExperimentCard } = await import(
    "@/src/components/home/home-experiment-card"
  );
  const card = resultCard();
  card.runSummary = {
    completionPercent: 100,
    dateRange: "May 1 to May 14",
    day: 14,
  };
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, { card }));

  assert.match(markup, /No clear signal/);
  assert.doesNotMatch(markup, /Protocol preview copy that should stay hidden/);
  assert.doesNotMatch(markup, /<img/);
});

test("HomeExperimentCard combines current data with progress for an active run", async () => {
  const { HomeExperimentCard } = await import(
    "@/src/components/home/home-experiment-card"
  );
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card: progressCard(),
  }));

  assert.match(markup, /Resting heart rate/);
  assert.match(markup, /58 bpm/);
  assert.match(markup, /43%/);
  assert.match(markup, /Day 6/);
  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /aria-valuenow="43"/);
  assert.doesNotMatch(markup, /<img/);
});

function resultCard(): ExperimentLibraryCard {
  return {
    category: "Sleep",
    description: "Protocol preview copy that should stay hidden.",
    hasPrivateData: true,
    href: "/experiments/red-light-glasses",
    id: "red-light-glasses",
    image: "/design-assets/red-light-glasses.jpg",
    privateBadgeLabel: "Private data",
    runStatus: "finished",
    runSummary: {
      completionPercent: 100,
      dateRange: "May 1 to May 14",
      day: 14,
      metric: {
        baseline: "70 min",
        current: "83 min",
        delta: "+13 min",
        label: "Deep sleep",
        sentiment: "positive",
      },
    },
    searchText: "red light glasses",
    startedOn: "2026-05-01",
    statusLabel: "Completed",
    statusVariant: "outline",
    title: "Red Light Glasses Before Bed",
  };
}

function progressCard(): ExperimentLibraryCard {
  return {
    category: "Recovery",
    description: "Private run.",
    hasPrivateData: true,
    href: null,
    id: "cold-plunge",
    image: "/design-assets/cold-plunge.jpg",
    privateBadgeLabel: "Private only",
    runStatus: "active",
    runSummary: {
      completionPercent: 43,
      day: 6,
      metric: {
        baseline: "61 bpm",
        current: "58 bpm",
        delta: "-3 bpm",
        label: "Resting heart rate",
        sentiment: "positive",
      },
    },
    searchText: "cold plunge",
    startedOn: "2026-06-01",
    statusLabel: "Active",
    statusVariant: "default",
    title: "Cold Plunge",
  };
}
