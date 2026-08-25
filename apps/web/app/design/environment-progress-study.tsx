"use client";

import {
  EnvironmentCaptureCard,
  EnvironmentEmptyState,
  EnvironmentReport,
  EnvironmentShell,
  EnvironmentVoiceRefreshNotice,
} from "../(dashboard)/environment/environment-page-client";
import {
  PrintEnvironmentLink,
  ShareEnvironmentButton,
} from "../(dashboard)/environment/environment-components";
import { EnvironmentReportSkeleton } from "../(dashboard)/environment/environment-report-skeleton";
import { EnvironmentShareCard } from "../(dashboard)/environment/environment-share-card";
import { EnvironmentVoiceCapture } from "../(dashboard)/environment/environment-voice-capture";
import {
  deriveCategoryNote,
  overallGrade,
} from "../(dashboard)/environment/category-notes";
import type { EnvironmentVoiceScript } from "../(dashboard)/environment/environment-voice-script";
import {
  type HabitatIndicatorNotes,
  type HabitatValues,
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "../(dashboard)/environment/home-model";

const DESIGN_CONTACT_OPTIONS = [
  {
    href: "sms:+15555550100",
    kind: "text" as const,
    label: "Messages",
  },
  {
    href: "https://t.me/withmurph_bot",
    kind: "telegram" as const,
    label: "Telegram",
  },
];

const REPORT_DESIGN_VALUES: HabitatValues = {
  "home-air": {
    air_purifier: "hepa",
    air_quality_meter: "combined",
    damp_or_mold: "none",
    smoke_sources: "none",
    ventilation: "mechanical",
  },
  "health-devices": {
    bp_cuff: true,
  },
  lighting: {
    daytime_light: "dim",
    evening_light: "warm_dim",
    morning_light_access: "outdoor_routine",
  },
  "sleep-environment": {
    darkness: "blackout",
    night_noise: "quiet",
    night_temp_c: 24,
  },
  workspace: {
    breaks: "systematic",
    screen_at_eye_level: true,
  },
};

const REPORT_DESIGN_NOTES: HabitatIndicatorNotes = {
  workspace: {
    screen_at_eye_level:
      "Large external display. Eyes line up with the middle of the screen.",
  },
};

const GAP_SCRIPTS: Readonly<Record<10 | 30 | 70, EnvironmentVoiceScript>> = {
  10: gapScript([
    ["sleep", "Sleep", ["Night temperature", "Darkness", "Night noise"]],
    ["air", "Air & water", ["City / region", "Ventilation", "Damp or mold"]],
    ["light", "Light", ["Morning light access", "Evening light"]],
    ["recovery", "Recovery & devices", ["Sauna access", "Scale"]],
    ["workspace", "Workspace", ["Desk hours", "Screen setup", "Breaks"]],
  ]),
  30: gapScript([
    ["sleep", "Sleep", ["Night temperature", "Night noise"]],
    ["air", "Air & water", ["City / region", "Area", "Ventilation"]],
    ["light", "Light", ["Evening light"]],
    ["workspace", "Workspace", ["Screen setup", "Breaks"]],
  ]),
  70: gapScript([
    ["sleep", "Sleep", ["Bedroom CO₂"]],
    ["workspace", "Workspace", ["Breaks"]],
  ]),
};

const UPDATE_SCRIPT: EnvironmentVoiceScript = {
  dialogTitle: "Update your environment",
  flow: "update",
  idleTitle: "Record what changed",
  topics: [
    {
      eyebrow: "Quick update",
      id: "update",
      prompt:
        "Describe anything that changed at home. Murph will update only the clear details.",
      title: "What changed?",
    },
  ],
};

const LIVE_TOPIC_SCRIPT: EnvironmentVoiceScript = {
  dialogTitle: "Continue your Environment report",
  flow: "fill-gaps",
  idleTitle: "Pick up where you left off",
  initialCoveredDetails: 6,
  totalDetails: 16,
  topics: [
    {
      eyebrow: "Workspace",
      fields: [
        {
          aspectId: "workspace",
          indicatorId: "work_mode",
          label: "Whether you work at home, an office, or both",
          valueType: { kind: "enum", values: ["remote", "office", "hybrid"] },
        },
        {
          aspectId: "workspace",
          indicatorId: "desk_hours",
          label: "How many hours you spend at a desk each day",
          valueType: { kind: "number", min: 0, max: 18, unit: "h/day" },
        },
        {
          aspectId: "workspace",
          indicatorId: "standing_desk",
          label: "Whether your desk adjusts for standing",
          valueType: {
            kind: "enum",
            values: ["adjustable_used", "adjustable_unused", "fixed"],
          },
        },
        {
          aspectId: "workspace",
          indicatorId: "screen_setup",
          label: "Whether your screen is at eye level",
          valueType: {
            kind: "enum",
            values: ["external_monitor", "laptop_only", "mixed"],
          },
        },
      ],
      focus: [
        "Whether you work at home, an office, or both",
        "How many hours you spend at a desk each day",
        "Whether your desk adjusts for standing",
        "Whether your screen is at eye level",
      ],
      id: "workspace:0",
      title: "Your work setup",
    },
  ],
};

export function EnvironmentProgressStudy() {
  const reportScene = resolveHabitatScene(REPORT_DESIGN_VALUES);
  const reportNotes = reportScene.categories.map((category) =>
    deriveCategoryNote(category, REPORT_DESIGN_VALUES, REPORT_DESIGN_NOTES),
  );

  return (
    <div
      className="flex flex-col gap-10"
      data-design-section="environment-progressive-capture"
      id="environment-progressive-capture"
      inert
    >
      <StudyState label="0% · Auth-gated first walkthrough">
        <div id="environment-empty-dashboard-shell">
          <EnvironmentShell>
            <EnvironmentEmptyState contactOptions={DESIGN_CONTACT_OPTIONS} />
          </EnvironmentShell>
        </div>
      </StudyState>
      <StudyState label="Guided interview · Start and recording flow">
        <EnvironmentVoiceCapture
          authGate={false}
          contactOptions={DESIGN_CONTACT_OPTIONS}
          initialTopicId="air"
          preview={{
            state: "idle",
          }}
          script={GAP_SCRIPTS[30]}
          showTrigger={false}
          triggerLabel="Preview live interview"
        />
      </StudyState>
      <StudyState label="Guided interview · Listening on a phone">
        <EnvironmentVoiceCapture
          authGate={false}
          contactOptions={DESIGN_CONTACT_OPTIONS}
          initialTopicId="workspace:0"
          preview={{
            capturedFieldKeys: ["workspace.work_mode", "workspace.standing_desk"],
            speaking: true,
            state: "listening",
            transcript:
              "I work from home most days.\nThe desk goes up and down, I use it standing in the afternoon.\nMy monitor sits at eye level.",
          }}
          script={LIVE_TOPIC_SCRIPT}
          showTrigger={false}
          triggerLabel="Preview live topic"
        />
      </StudyState>
      <StudyState label="Private report · Preparing and bounded recovery">
        <EnvironmentReportSkeleton onRetry={() => {}} />
      </StudyState>
      <StudyState label="Populated report · Shared dashboard width">
        <div id="environment-populated-dashboard-shell">
          <EnvironmentShell
            actions={
              <>
                <ShareEnvironmentButton
                  coverage={88}
                  grade={overallGrade(reportNotes, REPORT_DESIGN_VALUES)}
                  known={10}
                  total={16}
                />
                <PrintEnvironmentLink />
              </>
            }
          >
            <EnvironmentReport
              conditions={{ outdoorAir: "Good", weather: "Clear · 21°C" }}
              contactOptions={DESIGN_CONTACT_OPTIONS}
              coverage={resolveEnvironmentCoverage(reportScene)}
              grade={overallGrade(reportNotes, REPORT_DESIGN_VALUES)}
              indicatorNotes={REPORT_DESIGN_NOTES}
              notes={reportNotes}
              onVoiceAccepted={() => {}}
              scene={reportScene}
              values={REPORT_DESIGN_VALUES}
              voiceCaptureDisabled={false}
            />
          </EnvironmentShell>
        </div>
      </StudyState>
      <StudyState label="Personal share card · Grade and coverage">
        <div className="aspect-[1200/630] w-full overflow-hidden rounded-xl border border-border">
          <EnvironmentShareCard
            data={{
              coverage: 88,
              grade: "A",
              known: 14,
              score: 96,
              total: 16,
            }}
            logoDataUri="/logo.svg"
          />
        </div>
      </StudyState>
      <StudyState label="10% · Build the core picture">
        <EnvironmentCaptureCard
          contactOptions={DESIGN_CONTACT_OPTIONS}
          coverage={10}
          known={3}
          script={GAP_SCRIPTS[10]}
        />
      </StudyState>
      <StudyState label="30% · Continue from known facts">
        <EnvironmentCaptureCard
          contactOptions={DESIGN_CONTACT_OPTIONS}
          coverage={30}
          known={9}
          script={GAP_SCRIPTS[30]}
        />
      </StudyState>
      <StudyState label="70% · Ask only for remaining gaps">
        <EnvironmentCaptureCard
          contactOptions={DESIGN_CONTACT_OPTIONS}
          coverage={70}
          known={21}
          script={GAP_SCRIPTS[70]}
        />
      </StudyState>
      <StudyState label="100% · Free-form update">
        <EnvironmentCaptureCard
          contactOptions={DESIGN_CONTACT_OPTIONS}
          coverage={100}
          known={30}
          script={UPDATE_SCRIPT}
        />
      </StudyState>
      <StudyState label="After upload · Processing on the open report">
        <EnvironmentVoiceRefreshNotice
          state={{ baselineValues: "{}", status: "processing" }}
          onCheckAgain={() => {}}
        />
      </StudyState>
      <StudyState label="Long delay · Explicit recovery">
        <EnvironmentVoiceRefreshNotice
          state={{ status: "delayed" }}
          onCheckAgain={() => {}}
        />
      </StudyState>
    </div>
  );
}

function StudyState({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

function gapScript(
  topics: readonly [
    readonly [string, string, readonly string[]],
    ...Array<readonly [string, string, readonly string[]]>,
  ],
): EnvironmentVoiceScript {
  const [firstTopic, ...remainingTopics] = topics;
  const buildTopic = (
    topic: readonly [string, string, readonly string[]],
  ): EnvironmentVoiceScript["topics"][number] => {
    const [id, eyebrow, focus] = topic;
    return {
      eyebrow,
      focus,
      id,
      prompt:
        "Cover only the details Murph is still missing. If something does not apply or you would rather skip it, say so.",
      title: `Your remaining ${eyebrow.toLowerCase()} details`,
    };
  };

  return {
    dialogTitle: "Fill the gaps in your report",
    flow: "fill-gaps",
    idleTitle: "Only the missing details",
    topics: [buildTopic(firstTopic), ...remainingTopics.map(buildTopic)],
  };
}
