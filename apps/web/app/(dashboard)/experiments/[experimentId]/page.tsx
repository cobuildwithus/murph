"use client";

import { use } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { ExperimentHero } from "@/src/components/experiments/experiment-detail/experiment-hero";
import { ExperimentHeader } from "@/src/components/experiments/experiment-detail/experiment-header";
import { ProtocolTab } from "@/src/components/experiments/experiment-detail/protocol-tab";
import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import type { Experiment } from "@/src/types/experiments";

const MOCK_EXPERIMENTS: Record<string, Experiment> = {
  "finnish-sauna": {
    id: "finnish-sauna",
    title: "Finnish Sauna Protocol",
    category: "recovery",
    status: "active",
    image: "/design-assets/hero-sauna.png",
    matchPercent: 92,
    durationDays: 21,
    baselineDays: 7,
    studyCount: 8,
    day: 8,
    completionPercent: 38,
    evidenceLevel: 5,
    evidenceLabel: "Strong evidence",
    description:
      "57 minutes per week of dry sauna at 80–100°C, across 3–4 sessions. Activates heat shock proteins, reduces all-cause mortality by 40%, and improves cardiovascular function comparable to moderate exercise.",
    expectedSignals: [
      {
        label: "HRV",
        value: "",
        expected: "+10–25%",
        direction: "up",
        delta: "",
        description:
          "Heat stress trains the autonomic nervous system, increasing parasympathetic dominance at rest.",
      },
      {
        label: "Resting HR",
        value: "",
        expected: "-3–8 bpm",
        direction: "down",
        delta: "",
        description:
          "Repeated heat exposure improves cardiac output efficiency, lowering resting heart rate.",
      },
      {
        label: "Deep Sleep",
        value: "",
        expected: "+15–30%",
        direction: "up",
        delta: "",
        description:
          "Core temp drop after sauna triggers deeper slow-wave sleep via thermoregulatory pathways.",
      },
    ],
    protocol: [
      {
        number: 1,
        title: "Temperature: 80–100°C dry heat",
        detail:
          "Traditional Finnish sauna. Infrared (45–60°C) also works but requires longer sessions for equivalent HSP activation.",
      },
      {
        number: 2,
        title: "Duration: 15–20 min per session, 3–4x/week",
        detail:
          "57 min/week total is the studied minimum effective dose. Exit if dizzy or nauseous.",
      },
      {
        number: 3,
        title: "Hydration: 500ml water before, electrolytes after",
        detail:
          "You lose 300–500ml sweat per session. Replace sodium, potassium, magnesium.",
      },
      {
        number: 4,
        title: "Timing: evening, 2–3h before bed",
        detail:
          "Core temp drops ~1.5°C in the 90 min after — this drop is the sleep-enhancing signal.",
      },
    ],
    whyItWorks:
      "Sauna activates heat shock proteins (HSP70, HSP90) — molecular chaperones that repair misfolded proteins and protect cells from stress.\n\nA 20-year Finnish study tracking 2,315 men found 4–7 sessions/week reduced all-cause mortality by 40% and sudden cardiac death by 63%.\n\nHeart rate rises to 120–150 bpm during a session — comparable to moderate exercise. Blood vessels dilate, improving endothelial function.",
    experts: [
      {
        initials: "RP",
        name: "Rhonda Patrick",
        field: "Biomedical Science, PhD",
        quote:
          "One of the most robust longevity interventions we have data for.",
      },
      {
        initials: "AH",
        name: "Andrew Huberman",
        field: "Neuroscience, Stanford",
        quote:
          "Heat exposure triggers growth hormone release — up to 16x in specific protocols.",
      },
      {
        initials: "PA",
        name: "Peter Attia",
        field: "Medicine, Longevity",
        quote:
          "The Finnish data on sauna and mortality is among the strongest observational evidence we have.",
      },
    ],
    researchStats: {
      studies: 8,
      participants: 6890,
      yearsFollowUp: 20,
      evidenceLevel: "5/5",
    },
    studies: [
      {
        type: "OBS",
        title:
          "Association Between Sauna Bathing and Fatal Cardiovascular and All-Cause Mortality",
        authors: "Laukkanen et al.",
        journal: "JAMA Internal Medicine",
        year: 2015,
        participants: 2315,
        duration: "20 years",
        finding:
          "4–7 sessions/week: 40% reduced all-cause mortality, 63% reduced sudden cardiac death.",
      },
      {
        type: "RCT",
        title:
          "Heat acclimation-induced elevations in heat shock protein 72",
        authors: "Kuennen et al.",
        journal: "J Applied Physiology",
        year: 2011,
        participants: 20,
        duration: "10 days",
        finding:
          "Measurable HSP72 elevation after 10 days. Correlated with improved cytoprotection.",
      },
      {
        type: "OBS",
        title:
          "Sauna bathing is associated with reduced cardiovascular mortality",
        authors: "Laukkanen et al.",
        journal: "BMC Medicine",
        year: 2018,
        participants: 1688,
        duration: "15 years",
        finding:
          "Dose-response confirmed. Adding sauna frequency to risk models improved prediction accuracy.",
      },
    ],
    podcastLinks: [
      { label: "Huberman Lab #83", url: "#" },
      { label: "FoundMyFitness — Sauna", url: "#" },
      { label: "The Drive #218 — Heat", url: "#" },
    ],
    safety: {
      cautionLevel: 3,
      whoShouldAvoid: [
        "Unstable angina",
        "Recent myocardial infarction",
        "Severe aortic stenosis",
        "Pregnancy",
        "Acute illness with fever",
      ],
      precautions: [
        "Never combine with alcohol. Stay hydrated. Exit if lightheaded or nauseous. Avoid sessions beyond 20 min until adapted. Start with 10 min if new to sauna.",
      ],
    },
    signals: [
      {
        label: "HRV",
        value: "52.1",
        unit: "ms",
        delta: "12.0% vs baseline",
        direction: "up",
        expected: "+10–25%",
        baseline: undefined,
      },
      {
        label: "Resting HR",
        value: "61.8",
        unit: "bpm",
        delta: "3.7% vs baseline",
        direction: "down",
        expected: "-3–8 bpm",
        baseline: undefined,
      },
      {
        label: "Deep Sleep",
        value: "1h42m",
        delta: "15.9% vs baseline",
        direction: "up",
        expected: "+15–30%",
        baseline: undefined,
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
          { day: 9, value: 48 },
          { day: 11, value: 49.5 },
          { day: 14, value: 51 },
          { day: 17, value: 52.1 },
        ],
        baselineAvg: 46.5,
        currentValue: 52.1,
        delta: "+12.0%",
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
          { day: 9, value: 63.5 },
          { day: 11, value: 62.8 },
          { day: 14, value: 62 },
          { day: 17, value: 61.8 },
        ],
        baselineAvg: 64.2,
        currentValue: 61.8,
        delta: "↓ 3.7%",
      },
    ],
    timeline: [
      {
        date: "Apr 5",
        label: "End",
        title: "Experiment ends",
        description: "Final analysis generated",
        variant: "default",
        upcoming: true,
      },
      {
        date: "Apr 1",
        label: "Checkpoint",
        title: "Week 2 review",
        variant: "outline",
        upcoming: true,
      },
      {
        date: "Mar 31",
        label: "Upcoming",
        title: "Session 3 of 3",
        upcoming: true,
      },
      {
        date: "Mar 30",
        label: "Today",
        title: "Session logged",
        description: "20 min at 85°C. Deep sleep was 1h50m last night.",
      },
      {
        date: "Mar 29",
        title: "HRV milestone",
        description: "HRV crossed 50ms for the first time.",
      },
      {
        date: "Mar 25",
        label: "Checkpoint",
        title: "Week 1 complete",
        description: "Baseline captured. Active phase started.",
        variant: "outline",
      },
      {
        date: "Mar 18",
        label: "Start",
        title: "Experiment started",
        description: "Finnish Sauna Protocol · 21 days",
        variant: "primary",
        last: true,
      },
    ],
    nextStep: {
      title: "Sauna session · 15–20 min @ 80–100°C",
      when: "Today evening",
      instructions: "Stay hydrated, replace electrolytes after",
      context: "Session 2 of 3 this week",
      nextSession: "Friday",
    },
  },
  "cold-exposure": {
    id: "cold-exposure",
    title: "Deliberate Cold Exposure",
    category: "recovery",
    status: "upcoming",
    image: "/design-assets/hero-02.png",
    matchPercent: 87,
    durationDays: 14,
    baselineDays: 5,
    studyCount: 6,
    evidenceLevel: 4,
    evidenceLabel: "Strong evidence",
    description:
      "2–5 minutes of cold water immersion (11°C or below), 3–4 times per week. Triggers norepinephrine release, improves mood, accelerates recovery, and builds stress resilience through deliberate hormetic stress.",
    expectedSignals: [
      {
        label: "HRV",
        value: "",
        expected: "+8–20%",
        direction: "up" as const,
        delta: "",
        description:
          "Cold triggers a parasympathetic rebound after the initial sympathetic spike. Consistent exposure trains the autonomic nervous system.",
      },
      {
        label: "Mood & Energy",
        value: "",
        expected: "Noticeable improvement",
        direction: "up" as const,
        delta: "",
        description:
          "Norepinephrine increases 200–300% during cold exposure. Effects last several hours post-session.",
      },
      {
        label: "Recovery Score",
        value: "",
        expected: "+10–20%",
        direction: "up" as const,
        delta: "",
        description:
          "Reduced inflammation markers and faster muscle recovery between training sessions.",
      },
    ],
    protocol: [
      {
        number: 1,
        title: "Temperature: 11°C or below",
        detail:
          "Cold enough to make you want to get out but safe to stay in. Cold showers work but immersion is more effective.",
      },
      {
        number: 2,
        title: "Duration: 2–5 minutes per session",
        detail:
          "Start with 30 seconds, add 15 seconds each session. Total weekly cold exposure of 11 minutes is the studied target.",
      },
      {
        number: 3,
        title: "Frequency: 3–4x per week",
        detail:
          "Space sessions across the week. Avoid cold within 4 hours after strength training if hypertrophy is the goal.",
      },
    ],
    whyItWorks:
      "Cold water immersion activates the sympathetic nervous system, releasing norepinephrine and dopamine. The subsequent parasympathetic rebound trains autonomic flexibility.\n\nStudies show a 200–300% increase in norepinephrine that persists for hours. This is the mechanism behind improved mood and alertness.",
    experts: [
      {
        initials: "AH",
        name: "Andrew Huberman",
        field: "Neuroscience, Stanford",
        quote:
          "Deliberate cold exposure is one of the most potent tools for increasing baseline dopamine and norepinephrine.",
      },
      {
        initials: "SS",
        name: "Susanna Søberg",
        field: "Cold Researcher, PhD",
        quote:
          "11 minutes total per week of cold immersion was the threshold for measurable metabolic changes.",
      },
      {
        initials: "WH",
        name: "Wim Hof",
        field: "Cold Exposure Pioneer",
        quote:
          "The cold is your warm friend. It teaches you to breathe and trust yourself.",
      },
    ],
    researchStats: {
      studies: 6,
      participants: 1240,
      yearsFollowUp: 5,
      evidenceLevel: "4/5",
    },
    studies: [
      {
        type: "RCT" as const,
        title: "Winter swimming improves general well-being",
        authors: "Huttunen et al.",
        journal: "Int J Circumpolar Health",
        year: 2004,
        participants: 46,
        duration: "4 months",
        finding:
          "Regular winter swimmers reported less tension, fatigue, and negative mood states. Significant improvement in general well-being.",
      },
    ],
    podcastLinks: [
      { label: "Huberman Lab — Cold", url: "#" },
      { label: "Søberg — 11 Min Protocol", url: "#" },
    ],
    safety: {
      cautionLevel: 4,
      whoShouldAvoid: [
        "Raynaud's disease",
        "Cardiovascular conditions",
        "Uncontrolled hypertension",
        "Pregnancy",
      ],
      precautions: [
        "Never alone. Start gradual. Exit if you feel numbness in extremities or can't control breathing. Warm up naturally, not with hot water.",
      ],
    },
    signals: [],
    trends: [],
    timeline: [],
  },
};

const FINISHED_EXPERIMENT: Experiment = {
  ...MOCK_EXPERIMENTS["finnish-sauna"],
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

export default function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = use(params);

  // For demo: show finished state for a specific ID, active for others
  const experiment =
    experimentId === "finnish-sauna-finished"
      ? FINISHED_EXPERIMENT
      : MOCK_EXPERIMENTS[experimentId] ?? MOCK_EXPERIMENTS["finnish-sauna"];

  return (
    <div className="flex flex-col gap-8">
      {(experiment.status === "active" || experiment.status === "upcoming") && (
        <ExperimentHero image={experiment.image} title={experiment.title} />
      )}

      <ExperimentHeader
        title={experiment.title}
        category={experiment.category}
        durationDays={experiment.durationDays}
        evidenceLevel={experiment.evidenceLevel}
        evidenceLabel={experiment.evidenceLabel}
        matchPercent={experiment.matchPercent}
        status={experiment.status}
        day={experiment.day}
        dateRange={experiment.dateRange}
        baselineDays={experiment.baselineDays}
        completionPercent={experiment.completionPercent}
        description={experiment.description}
      />

      <Tabs
        defaultValue={experiment.status === "upcoming" ? "protocol" : "results"}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="protocol">Protocol</TabsTrigger>
          <TabsTrigger value="results">Your Results</TabsTrigger>
        </TabsList>
        <TabsContent value="protocol" className="pt-4">
          <ProtocolTab experiment={experiment} />
        </TabsContent>
        <TabsContent value="results" className="pt-4">
          <ResultsTab experiment={experiment} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
