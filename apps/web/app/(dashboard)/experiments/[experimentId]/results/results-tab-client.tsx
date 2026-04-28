"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { ResultsTab } from "@/src/components/experiments/experiment-detail/results-tab";
import { useBrowserVault } from "@/src/lib/browser-vault/context";
import { resolveBrowserVaultExperimentRun } from "@/src/lib/browser-vault/experiment-run";
import { composeExperimentDetail } from "@/src/lib/experiments/experiment-detail";
import type {
  ExperimentProtocol,
  ExperimentRunProjection,
} from "@/src/types/experiments";

export function ResultsTabClient({
  protocol,
}: {
  protocol: ExperimentProtocol;
}) {
  const browserVault = useBrowserVault();
  const searchParams = useSearchParams();
  const mockMode = searchParams.get("mock");
  const realPrivateRun = useMemo(
    () => resolveBrowserVaultExperimentRun({
      client: browserVault.client,
      protocol,
    }),
    [browserVault.client, protocol],
  );
  const isMock = mockMode === "active" || mockMode === "finished";
  const privateRun = useMemo(
    () => isMock
      ? buildMockPrivateRun(protocol, mockMode as "active" | "finished")
      : realPrivateRun,
    [isMock, mockMode, protocol, realPrivateRun],
  );
  const experiment = useMemo(
    () => composeExperimentDetail({ protocol, privateRun }),
    [privateRun, protocol],
  );

  return (
    <ResultsTab
      experiment={experiment}
      privateRunError={isMock ? null : browserVault.error}
      privateRunStatus={isMock ? "ready" : browserVault.status}
      onPrivateRunRetry={isMock ? undefined : browserVault.refresh}
    />
  );
}

function buildMockPrivateRun(
  protocol: ExperimentProtocol,
  mode: "active" | "finished",
): ExperimentRunProjection {
  const baselineDays = protocol.baselineDays;
  const protocolDays = Math.max(1, protocol.durationDays - baselineDays);
  const isFinished = mode === "finished";
  const day = isFinished
    ? protocol.durationDays
    : Math.min(baselineDays + Math.ceil(protocolDays / 2), protocol.durationDays);
  const completionPercent = isFinished ? 100 : Math.round((day / protocol.durationDays) * 100);

  return {
    id: `mock-${mode}-${protocol.id}`,
    source: "browser-vault",
    snapshotGeneratedAt: new Date().toISOString(),
    slug: protocol.id,
    status: isFinished ? "finished" : "active",
    statusLabel: isFinished ? "Finished" : "Active",
    startedOn: "2026-04-07",
    tags: ["mock"],
    title: protocol.title,
    day,
    completionPercent,
    dateRange: "Apr 7 – Apr 28",
    analysisAvailableOn: "2026-04-28",
    signals: [
      {
        label: "Resting Heart Rate",
        value: isFinished ? "56" : "58",
        unit: "bpm",
        delta: isFinished ? "−10%" : "−6%",
        direction: "down",
        baseline: "62 bpm",
        expected: "−5 to −10%",
      },
      {
        label: "Morning Blood Pressure",
        value: isFinished ? "114/74" : "116/76",
        unit: "mmHg",
        delta: isFinished ? "−6/−6" : "−4/−4",
        direction: "down",
        baseline: "120/80",
        expected: "−3 to −5 mmHg",
      },
      {
        label: "Sleep Efficiency",
        value: isFinished ? "91" : "89",
        unit: "%",
        delta: isFinished ? "+7pp" : "+5pp",
        direction: "up",
        baseline: "84%",
        expected: "+3 to +6 pp",
      },
    ],
    trends: [
      {
        label: "Resting Heart Rate",
        unit: "bpm",
        baseline: [
          { day: 1, value: 63 },
          { day: 2, value: 62 },
          { day: 3, value: 61 },
          { day: 4, value: 62 },
          { day: 5, value: 62 },
          { day: 6, value: 61 },
          { day: 7, value: 62 },
        ],
        active: isFinished
          ? [
              { day: 8, value: 61 },
              { day: 9, value: 60 },
              { day: 10, value: 60 },
              { day: 11, value: 59 },
              { day: 12, value: 58 },
              { day: 13, value: 58 },
              { day: 14, value: 57 },
              { day: 15, value: 57 },
              { day: 16, value: 57 },
              { day: 17, value: 56 },
              { day: 18, value: 56 },
              { day: 19, value: 56 },
              { day: 20, value: 56 },
              { day: 21, value: 56 },
            ]
          : [
              { day: 8, value: 61 },
              { day: 9, value: 60 },
              { day: 10, value: 60 },
              { day: 11, value: 59 },
              { day: 12, value: 58 },
              { day: 13, value: 58 },
              { day: 14, value: 58 },
            ],
        baselineAvg: 61.9,
        currentValue: isFinished ? 56 : 58,
        delta: isFinished ? "−6 bpm" : "−4 bpm",
        expectedRange: isFinished
          ? undefined
          : [
              { day: 14, low: 58, high: 58 },
              { day: 15, low: 57, high: 58 },
              { day: 16, low: 57, high: 59 },
              { day: 17, low: 56, high: 59 },
              { day: 18, low: 56, high: 59 },
              { day: 19, low: 55, high: 60 },
              { day: 20, low: 55, high: 60 },
              { day: 21, low: 55, high: 60 },
            ],
      },
      {
        label: "Morning Blood Pressure",
        unit: "mmHg",
        baseline: [
          { day: 1, value: 120 },
          { day: 2, value: 121 },
          { day: 3, value: 119 },
          { day: 4, value: 120 },
          { day: 5, value: 122 },
          { day: 6, value: 120 },
          { day: 7, value: 120 },
        ],
        active: isFinished
          ? [
              { day: 8, value: 119 },
              { day: 9, value: 118 },
              { day: 10, value: 118 },
              { day: 11, value: 117 },
              { day: 12, value: 117 },
              { day: 13, value: 116 },
              { day: 14, value: 116 },
              { day: 15, value: 115 },
              { day: 16, value: 115 },
              { day: 17, value: 115 },
              { day: 18, value: 114 },
              { day: 19, value: 114 },
              { day: 20, value: 114 },
              { day: 21, value: 114 },
            ]
          : [
              { day: 8, value: 119 },
              { day: 9, value: 118 },
              { day: 10, value: 118 },
              { day: 11, value: 117 },
              { day: 12, value: 117 },
              { day: 13, value: 116 },
              { day: 14, value: 116 },
            ],
        baselineAvg: 120.3,
        currentValue: isFinished ? 114 : 116,
        delta: isFinished ? "−6 mmHg" : "−4 mmHg",
        expectedRange: isFinished
          ? undefined
          : [
              { day: 14, low: 116, high: 116 },
              { day: 15, low: 115, high: 117 },
              { day: 16, low: 115, high: 117 },
              { day: 17, low: 114, high: 117 },
              { day: 18, low: 114, high: 118 },
              { day: 19, low: 114, high: 118 },
              { day: 20, low: 113, high: 118 },
              { day: 21, low: 113, high: 119 },
            ],
      },
      {
        label: "Sleep Efficiency",
        unit: "%",
        baseline: [
          { day: 1, value: 82 },
          { day: 2, value: 84 },
          { day: 3, value: 85 },
          { day: 4, value: 83 },
          { day: 5, value: 84 },
          { day: 6, value: 85 },
          { day: 7, value: 84 },
        ],
        active: isFinished
          ? [
              { day: 8, value: 85 },
              { day: 9, value: 86 },
              { day: 10, value: 87 },
              { day: 11, value: 87 },
              { day: 12, value: 88 },
              { day: 13, value: 89 },
              { day: 14, value: 89 },
              { day: 15, value: 90 },
              { day: 16, value: 90 },
              { day: 17, value: 90 },
              { day: 18, value: 91 },
              { day: 19, value: 91 },
              { day: 20, value: 91 },
              { day: 21, value: 91 },
            ]
          : [
              { day: 8, value: 85 },
              { day: 9, value: 86 },
              { day: 10, value: 87 },
              { day: 11, value: 87 },
              { day: 12, value: 88 },
              { day: 13, value: 89 },
              { day: 14, value: 89 },
            ],
        baselineAvg: 83.9,
        currentValue: isFinished ? 91 : 89,
        delta: isFinished ? "+7 pp" : "+5 pp",
        expectedRange: isFinished
          ? undefined
          : [
              { day: 14, low: 89, high: 89 },
              { day: 15, low: 89, high: 90 },
              { day: 16, low: 89, high: 90 },
              { day: 17, low: 89, high: 91 },
              { day: 18, low: 89, high: 91 },
              { day: 19, low: 88, high: 92 },
              { day: 20, low: 88, high: 92 },
              { day: 21, low: 88, high: 93 },
            ],
      },
    ],
    timeline: isFinished
      ? [
          { date: "Apr 7", title: "Baseline started", variant: "muted" },
          { date: "Apr 13", title: "Baseline complete", description: "Avg RHR 62 bpm", variant: "default" },
          { date: "Apr 14", title: "First sauna session", description: "20 min @ 80°C", variant: "primary" },
          { date: "Apr 16", label: "Schedule change", title: "Moved sessions to mornings", description: "Evening conflicts — swapped to 7:30am block.", variant: "outline" },
          { date: "Apr 18", label: "Missed", title: "Skipped today's session", description: "Travel day. Logged as missed; cadence recovers tomorrow.", variant: "muted" },
          { date: "Apr 22", label: "Note", title: "Logged poor sleep", description: "Resting HR spike noted; sauna session held to 15 min.", variant: "default" },
          { date: "Apr 24", title: "Mid-protocol check-in", description: "RHR trending down", variant: "default" },
          { date: "Apr 28", title: "Protocol complete", description: "Final readings captured", variant: "primary", last: true },
        ]
      : [
          { date: "Apr 7", title: "Baseline started", variant: "muted" },
          { date: "Apr 13", title: "Baseline complete", description: "Avg RHR 62 bpm", variant: "default" },
          { date: "Apr 14", title: "First sauna session", description: "20 min @ 80°C", variant: "primary" },
          { date: "Apr 16", label: "Schedule change", title: "Moved sessions to mornings", description: "Evening conflicts — swapped to 7:30am block.", variant: "outline" },
          { date: "Apr 18", label: "Missed", title: "Skipped today's session", description: "Travel day. Logged as missed; cadence recovers tomorrow.", variant: "muted" },
          { date: "Apr 19", label: "Note", title: "Logged poor sleep", description: "Resting HR spike noted; held next session to 15 min.", variant: "default" },
          { date: "Apr 20", title: "Today", description: "Day 7 of protocol", variant: "primary", upcoming: true, last: true },
        ],
    schedule: buildMockSchedule(mode),
    nextStep: isFinished
      ? undefined
      : {
          title: "20 min @ 80°C",
          when: "This evening",
          instructions: "After the session, log perceived recovery and water intake.",
          context: "Last session was 2 days ago — you are on cadence for the 3x/week target.",
          nextSession: "Wed, Apr 23 · evening",
        },
    summary: isFinished
      ? "Resting heart rate dropped 10%, in the upper end of expected range."
      : "You're on day 7 — early effects are showing. RHR down 4 bpm, BP down 4 mmHg, sleep efficiency up 5pp.",
    summaryDetail: isFinished
      ? "Three sessions a week for two weeks moved your RHR from 62 → 56 bpm. Morning BP and sleep efficiency also improved within expected ranges."
      : "Trends look promising and within the expected range for this protocol. Keep the cadence — full conclusions will land once the protocol window closes.",
    conclusions: isFinished
      ? [
          {
            title: "What worked",
            variant: "positive",
            items: [
              { icon: "check", text: "Held 3x/week cadence with no missed sessions." },
              { icon: "check", text: "RHR delta (−10%) at the strong end of expected range." },
              { icon: "check", text: "Sleep efficiency gain (+7pp) above expected midpoint." },
            ],
          },
          {
            title: "What to try next",
            variant: "recommendation",
            items: [
              { icon: "arrow", text: "Hold cadence for 4 more weeks and re-measure RHR." },
              { icon: "arrow", text: "Consider adding HRV tracking to deepen the recovery signal." },
            ],
          },
        ]
      : undefined,
  };
}

function buildMockSchedule(mode: "active" | "finished") {
  const isFinished = mode === "finished";
  const dayLabels = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];

  return {
    cadence: "3 sessions per week",
    dose: "~20 min @ 80°C per session",
    weeks: [
      {
        label: "Baseline",
        dateRange: "Apr 7 – Apr 13",
        summary: "7 days · complete",
        cells: dayLabels.map((dayLabel) => ({
          dayLabel,
          kind: "baseline" as const,
        })),
      },
      {
        label: "Week 1",
        dateRange: "Apr 14 – Apr 20",
        summary: isFinished ? "3 of 3 done" : "2 of 3 done · 1 missed",
        cells: [
          { dayLabel: "Tue", date: "Apr 14", kind: "completed" as const, detail: "20m" },
          { dayLabel: "Wed", date: "Apr 15", kind: "rest" as const },
          { dayLabel: "Thu", date: "Apr 16", kind: "completed" as const, detail: "20m" },
          { dayLabel: "Fri", date: "Apr 17", kind: "rest" as const },
          { dayLabel: "Sat", date: "Apr 18", kind: "missed" as const },
          { dayLabel: "Sun", date: "Apr 19", kind: "rest" as const },
          {
            dayLabel: "Mon",
            date: "Apr 20",
            kind: "rest" as const,
            isToday: !isFinished,
          },
        ],
      },
      {
        label: "Week 2",
        dateRange: "Apr 21 – Apr 27",
        summary: isFinished ? "3 of 3 done" : "Upcoming",
        cells: isFinished
          ? [
              { dayLabel: "Tue", date: "Apr 21", kind: "completed" as const, detail: "20m" },
              { dayLabel: "Wed", date: "Apr 22", kind: "rest" as const },
              { dayLabel: "Thu", date: "Apr 23", kind: "completed" as const, detail: "20m" },
              { dayLabel: "Fri", date: "Apr 24", kind: "rest" as const },
              { dayLabel: "Sat", date: "Apr 25", kind: "completed" as const, detail: "20m" },
              { dayLabel: "Sun", date: "Apr 26", kind: "rest" as const },
              { dayLabel: "Mon", date: "Apr 27", kind: "rest" as const },
            ]
          : [
              { dayLabel: "Tue", date: "Apr 21", kind: "scheduled" as const, detail: "20m" },
              { dayLabel: "Wed", date: "Apr 22", kind: "rest" as const },
              { dayLabel: "Thu", date: "Apr 23", kind: "scheduled" as const, detail: "20m" },
              { dayLabel: "Fri", date: "Apr 24", kind: "rest" as const },
              { dayLabel: "Sat", date: "Apr 25", kind: "scheduled" as const, detail: "20m" },
              { dayLabel: "Sun", date: "Apr 26", kind: "rest" as const },
              { dayLabel: "Mon", date: "Apr 27", kind: "rest" as const },
            ],
      },
    ],
  };
}
