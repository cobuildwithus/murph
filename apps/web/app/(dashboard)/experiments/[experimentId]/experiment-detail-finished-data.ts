import type { Experiment } from "@/src/types/experiments";
import { FINNISH_SAUNA_EXPERIMENT } from "./experiment-detail-data";

export const FINISHED_EXPERIMENT: Experiment = {
  ...FINNISH_SAUNA_EXPERIMENT,
  status: "finished",
  day: undefined,
  completionPercent: undefined,
  dateRange: "Mar 18 – Apr 5, 2026",
  summary: "Strong positive signal",
  summaryDetail:
    "3 of 4 tracked metrics improved beyond normal variation. HRV showed the largest and most consistent change.",
  signals: [
    {
      label: "HRV",
      value: "53.8",
      unit: "ms",
      delta: "+15.7%",
      direction: "up",
      expected: "+10–25%",
      baseline: "46.5",
    },
    {
      label: "Resting HR",
      value: "60.1",
      unit: "bpm",
      delta: "−6.4%",
      direction: "down",
      expected: "-3–8 bpm",
      baseline: "64.2",
    },
    {
      label: "Deep Sleep",
      value: "1h44m",
      delta: "+18.2%",
      direction: "up",
      expected: "+15–30%",
      baseline: "1h28m",
    },
  ],
  trends: [
    {
      label: "HRV Trend",
      unit: "ms",
      baseline: [
        { day: 1, value: 45 },
        { day: 3, value: 47 },
        { day: 5, value: 46 },
        { day: 7, value: 46.5 },
      ],
      active: [
        { day: 7, value: 46.5 },
        { day: 10, value: 49 },
        { day: 14, value: 51.5 },
        { day: 18, value: 53 },
        { day: 21, value: 53.8 },
      ],
      baselineAvg: 46.5,
      currentValue: 53.8,
      delta: "+15.7%",
    },
    {
      label: "Resting HR Trend",
      unit: "bpm",
      baseline: [
        { day: 1, value: 64 },
        { day: 3, value: 64.5 },
        { day: 5, value: 64 },
        { day: 7, value: 64.2 },
      ],
      active: [
        { day: 7, value: 64.2 },
        { day: 10, value: 63 },
        { day: 14, value: 61.5 },
        { day: 18, value: 60.5 },
        { day: 21, value: 60.1 },
      ],
      baselineAvg: 64.2,
      currentValue: 60.1,
      delta: "↓ 6.4%",
    },
    {
      label: "Deep Sleep Trend",
      unit: "",
      baseline: [
        { day: 1, value: 85 },
        { day: 3, value: 90 },
        { day: 5, value: 86 },
        { day: 7, value: 88 },
      ],
      active: [
        { day: 7, value: 88 },
        { day: 10, value: 92 },
        { day: 14, value: 98 },
        { day: 18, value: 102 },
        { day: 21, value: 104 },
      ],
      baselineAvg: 88,
      currentValue: 104,
      delta: "↑ 18.2%",
    },
  ],
  timeline: [
    {
      date: "Apr 5",
      label: "End",
      title: "Experiment completed",
      variant: "primary",
    },
    {
      date: "Apr 1",
      label: "Checkpoint",
      title: "Week 2 complete",
      variant: "outline",
    },
    {
      date: "Mar 30",
      title: "Session logged",
    },
    {
      date: "Mar 29",
      title: "HRV milestone",
    },
    {
      date: "Mar 25",
      label: "Checkpoint",
      title: "Week 1 complete",
      variant: "outline",
    },
    {
      date: "Mar 18",
      label: "Start",
      title: "Experiment started",
      variant: "primary",
      last: true,
    },
  ],
  conclusions: [
    {
      title: "What worked",
      variant: "positive",
      items: [
        {
          icon: "↑",
          text: "HRV +15.7% — well above ±4% normal variation. Parasympathetic tone increased consistently across all 3 weeks.",
        },
        {
          icon: "↑",
          text: "Deep sleep +18.2% — evening timing was key. Core temp drop post-sauna triggered thermoregulatory sleep enhancement.",
        },
        {
          icon: "✦",
          text: "Resting HR -6.4% — cardiovascular adaptation. Steady drop from week 1, plateaued week 3.",
        },
      ],
    },
    {
      title: "What didn't change",
      variant: "neutral",
      items: [
        {
          icon: "→",
          text: "Respiratory rate -2.6% — within normal variation. Not a meaningful signal for this protocol.",
        },
      ],
    },
    {
      title: "Key insights",
      variant: "insight",
      items: [
        {
          icon: "•",
          text: "Evening sessions (2–3h before bed) drove sleep gains. Morning sessions showed no sleep benefit.",
        },
        {
          icon: "•",
          text: "HRV improvements appeared after day 5, accelerated in week 2. Baseline phase confirmed this wasn't seasonal drift.",
        },
        {
          icon: "•",
          text: "Skipping one session had no negative impact. 2–3x/week appears sufficient.",
        },
        {
          icon: "•",
          text: "Hydration was critical — sessions without pre-hydration correlated with worse next-day HRV.",
        },
      ],
    },
    {
      title: "Recommendations",
      variant: "recommendation",
      items: [
        {
          icon: "→",
          text: "Continue sauna 2x/week as maintenance. Full 3x/week no longer needed — gains plateau after week 2.",
        },
        {
          icon: "→",
          text: "Add cold exposure post-sauna — contrast protocol may amplify HRV gains.",
        },
        {
          icon: "→",
          text: "Keep evening timing. Morning sessions didn't drive sleep improvements.",
        },
      ],
    },
  ],
};
