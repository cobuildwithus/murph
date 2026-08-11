"use client";

import {
  EnvironmentCaptureCard,
  EnvironmentEmptyState,
  EnvironmentReport,
  EnvironmentShell,
  EnvironmentVoiceRefreshNotice,
} from "../(dashboard)/environment/environment-page-client";
import {
  deriveCategoryNote,
  overallGrade,
} from "../(dashboard)/environment/category-notes";
import type { EnvironmentVoiceScript } from "../(dashboard)/environment/environment-voice-script";
import {
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
    damp_or_mold: "none",
    smoke_sources: "none",
    ventilation: "mechanical",
  },
  lighting: {
    daytime_light: "by_window",
    evening_light: "warm_dim",
    morning_light_access: "outdoor_routine",
  },
  "sleep-environment": {
    darkness: "blackout",
    night_noise: "quiet",
    night_temp_c: 20,
  },
  workspace: {
    breaks: "systematic",
    screen_at_eye_level: true,
  },
};

const GAP_SCRIPTS: Readonly<Record<10 | 30 | 70, EnvironmentVoiceScript>> = {
  10: gapScript([
    ["sleep", "Sleep", ["Night temperature", "Darkness", "Night noise"]],
    [
      "air",
      "Air & water",
      ["City / region", "Ventilation", "Damp or mold"],
    ],
    ["light", "Light", ["Morning light access", "Evening light"]],
    ["recovery", "Recovery & devices", ["Sauna access", "Scale"]],
    ["workspace", "Workspace", ["Desk hours", "Screen setup", "Breaks"]],
  ]),
  30: gapScript([
    ["sleep", "Sleep", ["Night temperature", "Night noise"]],
    ["air", "Air & water", ["City / region", "Ventilation"]],
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
  idleDescription:
    "You do not need to repeat the full walkthrough. Mention only what is new or different.",
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

export function EnvironmentProgressStudy() {
  const reportScene = resolveHabitatScene(REPORT_DESIGN_VALUES);
  const reportNotes = reportScene.categories.map((category) =>
    deriveCategoryNote(category, REPORT_DESIGN_VALUES),
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
      <StudyState label="Populated report · Shared dashboard width">
        <div id="environment-populated-dashboard-shell">
          <EnvironmentShell>
            <EnvironmentReport
              conditions={{ outdoorAir: "Good", weather: "Clear · 21°C" }}
              contactOptions={DESIGN_CONTACT_OPTIONS}
              coverage={resolveEnvironmentCoverage(reportScene)}
              grade={overallGrade(reportNotes)}
              notes={reportNotes}
              onVoiceAccepted={() => {}}
              scene={reportScene}
              values={REPORT_DESIGN_VALUES}
              voiceCaptureDisabled={false}
            />
          </EnvironmentShell>
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
          state={{ status: "processing" }}
          onCheckAgain={() => {}}
        />
      </StudyState>
      <StudyState label="After processing · Waiting for the private report">
        <EnvironmentVoiceRefreshNotice
          state={{ status: "refreshing" }}
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
    idleDescription: `${topics.length} short ${
      topics.length === 1 ? "topic" : "topics"
    }, based on what Murph does not know yet.`,
    idleTitle: "Only the missing details",
    topics: [
      buildTopic(firstTopic),
      ...remainingTopics.map(buildTopic),
    ],
  };
}
