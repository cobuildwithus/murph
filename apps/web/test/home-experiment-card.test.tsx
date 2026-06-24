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

test("HomeExperimentCard renders private result data instead of protocol imagery and copy", async () => {
  const { HomeExperimentCard } = await import(
    "@/src/components/home/home-experiment-card"
  );
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card: resultCard(),
  }));

  assert.match(markup, /data-home-experiment-card/);
  assert.match(markup, /Deep sleep/);
  assert.match(markup, />83</);
  assert.match(markup, /Baseline 70 min/);
  assert.match(markup, /Current 83 min/);
  assert.match(markup, /<polyline/);
  assert.match(markup, /Private data/);
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /Protocol preview copy that should stay hidden/);
});

test("HomeExperimentCard falls back to a visual progress state when result metrics are unavailable", async () => {
  const { HomeExperimentCard } = await import(
    "@/src/components/home/home-experiment-card"
  );
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card: progressCard(),
  }));

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
      primarySignal: {
        baseline: "70 min",
        delta: "+13 min",
        direction: "up",
        expected: "",
        label: "Deep sleep",
        sentiment: "positive",
        unit: "min",
        value: "83",
      },
      primaryTrend: {
        active: [
          { day: 3, value: 76 },
          { day: 4, value: 83 },
        ],
        baseline: [
          { day: 1, value: 68 },
          { day: 2, value: 72 },
        ],
        baselineAvg: 70,
        currentValue: 83,
        delta: "+13 min",
        history: [],
        label: "Deep sleep",
        startDate: "2026-05-01",
        unit: "min",
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
    },
    searchText: "cold plunge",
    startedOn: "2026-06-01",
    statusLabel: "Active",
    statusVariant: "default",
    title: "Cold Plunge",
  };
}
