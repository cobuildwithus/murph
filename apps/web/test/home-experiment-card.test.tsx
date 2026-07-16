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
    variant: "history",
  }));

  assert.match(markup, /data-home-experiment-card/);
  assert.match(markup, /data-home-experiment-card-variant="history"/);
  assert.match(markup, /Sleep efficiency/);
  assert.match(markup, /-0\.7 percent/);
  assert.match(markup, /Deep sleep/);
  assert.match(markup, /\+20\.4 min/);
  assert.match(markup, /HRV RMSSD/);
  assert.match(markup, /\+0\.6 ms/);
  assert.match(markup, /Resting heart rate/);
  assert.match(markup, /-3\.3 bpm/);
  assert.doesNotMatch(markup, /Sleep latency/);
  assert.doesNotMatch(markup, /18 min/);
  assert.match(
    markup,
    /Sleep efficiency[\s\S]*Deep sleep[\s\S]*HRV RMSSD[\s\S]*Resting heart rate/,
  );
  assert.match(
    markup,
    /Sleep efficiency<\/p><p class="[^"]*text-amber-700[^"]*">-0\.7 percent<span class="sr-only">, unfavorable<\/span><\/p>/,
  );
  assert.match(
    markup,
    /Deep sleep<\/p><p class="[^"]*text-primary[^"]*">\+20\.4 min<span class="sr-only">, favorable<\/span><\/p>/,
  );
  assert.match(
    markup,
    /HRV RMSSD<\/p><p class="[^"]*text-foreground[^"]*">\+0\.6 ms<\/p>/,
  );
  assert.doesNotMatch(markup, /Baseline/);
  assert.doesNotMatch(markup, /Latest/);
  assert.match(markup, /Private data/);
  assert.match(markup, /size-3 shrink-0/);
  assert.match(
    markup,
    /<span class="min-w-0 truncate">May 1 to May 14<\/span>/,
  );
  assert.match(
    markup,
    /^<a[^>]*href="\/experiments\/red-light-glasses"[^>]*><article/,
  );
  assert.doesNotMatch(markup, /inline-flex size-7/);
  assert.doesNotMatch(markup, />Completed</);
  assert.doesNotMatch(markup, />View</);
  assert.doesNotMatch(markup, /h-full/);
  assert.doesNotMatch(markup, /min-h-\[240px\]/);
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /Protocol preview copy that should stay hidden/);
});

test("HomeExperimentCard preserves a non-redundant history status", async () => {
  const { HomeExperimentCard } = await import(
    "@/src/components/home/home-experiment-card"
  );
  const card = resultCard();
  card.statusLabel = "Review due";
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card,
    variant: "history",
  }));

  assert.match(markup, />Review due</);
});

test("HomeExperimentCard does not hide a source Done status", async () => {
  const { HomeExperimentCard } = await import(
    "@/src/components/home/home-experiment-card"
  );
  const card = resultCard();
  card.statusLabel = "Done";
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card,
    variant: "history",
  }));

  assert.match(markup, />Done</);
});

test("HomeExperimentCard hides a redundant Finished history status", async () => {
  const { HomeExperimentCard } = await import(
    "@/src/components/home/home-experiment-card"
  );
  const card = resultCard();
  card.statusLabel = "Finished";
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card,
    variant: "history",
  }));

  assert.doesNotMatch(markup, />Finished</);
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
    metric: {
      current: "18 min",
      label: "Sleep latency",
    },
    metrics: [],
  };
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card,
    variant: "history",
  }));
  const defaultCard = resultCard();
  defaultCard.runSummary = {
    completionPercent: 100,
    dateRange: "May 1 to May 14",
    day: 14,
    metrics: [],
  };
  const defaultMarkup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card: defaultCard,
    variant: "default",
  }));

  assert.match(markup, /No clear signal/);
  assert.match(
    markup,
    /<p class="[^"]*text-2xl[^"]*">No clear signal<\/p>/,
  );
  assert.doesNotMatch(
    markup,
    /<p class="[^"]*text-3xl[^"]*">No clear signal<\/p>/,
  );
  assert.match(
    defaultMarkup,
    /<p class="[^"]*text-3xl[^"]*">No clear signal<\/p>/,
  );
  assert.doesNotMatch(markup, /Sleep latency/);
  assert.doesNotMatch(markup, /18 min/);
  assert.doesNotMatch(markup, /Protocol preview copy that should stay hidden/);
  assert.doesNotMatch(markup, /<img/);
});

test("HomeExperimentCard combines current data with progress for an active run", async () => {
  const { HomeExperimentCard } = await import(
    "@/src/components/home/home-experiment-card"
  );
  const markup = renderToStaticMarkup(createElement(HomeExperimentCard, {
    card: progressCard(),
    variant: "default",
  }));

  assert.match(markup, /Resting heart rate/);
  assert.match(markup, /58 bpm/);
  assert.match(markup, /43%/);
  assert.match(markup, /Day 6/);
  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /aria-valuenow="43"/);
  assert.match(markup, /data-home-experiment-card-variant="default"/);
  assert.match(markup, /min-h-\[240px\] p-5/);
  assert.match(markup, /inline-flex size-7/);
  assert.match(markup, />Active</);
  assert.doesNotMatch(markup, /Sleep efficiency/);
  assert.doesNotMatch(markup, /94\.1 percent/);
  assert.doesNotMatch(markup, /<img/);
});

test("HomeExperiments gives history a denser three-column layout", async () => {
  const { HomeExperiments } = await import(
    "@/src/components/home/home-experiments"
  );
  const markup = renderToStaticMarkup(createElement(HomeExperiments, {
    history: [resultCard()],
    inProgress: [progressCard()],
  }));

  assert.match(markup, /data-home-experiment-card-variant="default"/);
  assert.match(markup, /data-home-experiment-card-variant="history"/);
  assert.match(markup, /grid grid-cols-6 items-start gap-5/);
  assert.match(
    markup,
    /col-span-6 h-fit sm:col-span-3 md:col-span-6 lg:col-span-3 xl:col-span-2/,
  );
  assert.match(markup, /grid gap-5 sm:grid-cols-2/);
});

test("HomeExperiments preserves the standard card treatment for stopped runs", async () => {
  const { HomeExperiments } = await import(
    "@/src/components/home/home-experiments"
  );
  const markup = renderToStaticMarkup(createElement(HomeExperiments, {
    history: [stoppedCard()],
    inProgress: [],
  }));

  assert.match(markup, /data-home-experiment-card-variant="default"/);
  assert.doesNotMatch(markup, /data-home-experiment-card-variant="history"/);
  assert.match(markup, /grid grid-cols-6 items-start gap-5/);
  assert.match(markup, /col-span-6 self-stretch sm:col-span-3/);
  assert.doesNotMatch(markup, /xl:col-span-2/);
  assert.match(markup, /<a class="block [^"]* h-full" href=/);
  assert.match(markup, /h-full min-h-\[240px\] p-5/);
  assert.match(markup, />Stopped</);
  assert.match(markup, /Deep sleep/);
  assert.match(
    markup,
    /\+20\.4 min<span class="sr-only">, favorable<\/span>/,
  );
  assert.match(markup, /Baseline/);
  assert.match(markup, /Latest/);
  assert.doesNotMatch(markup, /Sleep latency/);
  assert.match(markup, /Private data/);
  assert.match(markup, /inline-flex size-7/);
  assert.match(markup, />View</);
  assert.match(
    markup,
    /<a[^>]*href="\/experiments\/red-light-glasses"[^>]*><article/,
  );
});

test("HomeExperiments keeps mixed history cards on lifecycle-specific grid spans", async () => {
  const { HomeExperiments } = await import(
    "@/src/components/home/home-experiments"
  );
  const stopped = stoppedCard();
  stopped.id = "red-light-glasses-stopped";
  const markup = renderToStaticMarkup(createElement(HomeExperiments, {
    history: [resultCard(), stopped],
    inProgress: [],
  }));

  assert.match(markup, /grid grid-cols-6 items-start gap-5/);
  assert.match(
    markup,
    /class="col-span-6 h-fit sm:col-span-3 md:col-span-6 lg:col-span-3 xl:col-span-2"/,
  );
  assert.equal(
    markup.match(/class="col-span-6 self-stretch sm:col-span-3"/g)?.length,
    1,
  );
  assert.match(
    markup,
    /class="col-span-6 h-fit sm:col-span-3 md:col-span-6 lg:col-span-3 xl:col-span-2"[\s\S]*class="col-span-6 self-stretch sm:col-span-3"/,
  );
  assert.equal(
    markup.match(/data-home-experiment-card-variant="history"/g)?.length,
    1,
  );
  assert.equal(
    markup.match(/data-home-experiment-card-variant="default"/g)?.length,
    1,
  );
  assert.match(
    markup,
    /data-home-experiment-card-variant="history"[\s\S]*data-home-experiment-card-variant="default"/,
  );
  assert.match(
    markup,
    /data-home-experiment-card-variant="history"[\s\S]*h-full min-h-\[240px\][\s\S]*data-home-experiment-card-variant="default"/,
  );
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
      metrics: [
        {
          baseline: "94.8 percent",
          current: "94.1 percent",
          delta: "-0.7 percent",
          label: "Sleep efficiency",
          sentiment: "negative",
        },
        {
          baseline: "96.4 min",
          current: "116.8 min",
          delta: "+20.4 min",
          label: "Deep sleep",
          sentiment: "positive",
        },
        {
          baseline: "60.6 ms",
          current: "61.2 ms",
          delta: "+0.6 ms",
          label: "HRV RMSSD",
          sentiment: "neutral",
        },
        {
          baseline: "50.4 bpm",
          current: "47.1 bpm",
          delta: "-3.3 bpm",
          label: "Resting heart rate",
          sentiment: "positive",
        },
      ],
    },
    searchText: "red light glasses",
    startedOn: "2026-05-01",
    statusLabel: "Completed",
    statusVariant: "outline",
    title: "Red Light Glasses Before Bed",
  };
}

function stoppedCard(): ExperimentLibraryCard {
  const card = resultCard();
  card.runStatus = "stopped";
  card.statusLabel = "Stopped";
  card.statusVariant = "destructive";
  card.runSummary = {
    completionPercent: 43,
    dateRange: "May 1 to May 7",
    day: 7,
    metric: {
      baseline: "96.4 min",
      current: "116.8 min",
      delta: "+20.4 min",
      label: "Deep sleep",
      sentiment: "positive",
    },
    metrics: [{
      current: "18 min",
      label: "Sleep latency",
    }],
  };
  return card;
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
      metrics: [{
        baseline: "94.8 percent",
        current: "94.1 percent",
        delta: "-0.7 percent",
        label: "Sleep efficiency",
        sentiment: "negative",
      }],
    },
    searchText: "cold plunge",
    startedOn: "2026-06-01",
    statusLabel: "Active",
    statusVariant: "default",
    title: "Cold Plunge",
  };
}
