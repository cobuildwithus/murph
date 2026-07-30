import {
  EnvironmentCaptureCard,
  EnvironmentEmptyState,
} from "../(dashboard)/environment/environment-page-client";
import type { EnvironmentVoiceScript } from "../(dashboard)/environment/environment-voice-script";

const GAP_SCRIPTS: Readonly<Record<10 | 30 | 70, EnvironmentVoiceScript>> = {
  10: gapScript([
    ["sleep", "Sleep", ["Night temperature", "Darkness", "Night noise"]],
    ["air", "Air & water", ["Ventilation", "Damp or mold", "Smoke sources"]],
    ["light", "Light", ["Morning light access", "Evening light"]],
    ["recovery", "Recovery & devices", ["Sauna access", "Scale"]],
    ["workspace", "Workspace", ["Desk hours", "Screen setup", "Breaks"]],
  ]),
  30: gapScript([
    ["sleep", "Sleep", ["Night temperature", "Night noise"]],
    ["air", "Air & water", ["Ventilation", "Radon tested"]],
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
  return (
    <div
      className="flex flex-col gap-10"
      data-design-section="environment-progressive-capture"
      id="environment-progressive-capture"
      inert
    >
      <StudyState label="0% · First walkthrough">
        <EnvironmentEmptyState contactAction={null} />
      </StudyState>
      <StudyState label="10% · Build the core picture">
        <EnvironmentCaptureCard
          contactAction={null}
          coverage={10}
          known={3}
          script={GAP_SCRIPTS[10]}
          total={30}
        />
      </StudyState>
      <StudyState label="30% · Continue from known facts">
        <EnvironmentCaptureCard
          contactAction={null}
          coverage={30}
          known={9}
          script={GAP_SCRIPTS[30]}
          total={30}
        />
      </StudyState>
      <StudyState label="70% · Ask only for remaining gaps">
        <EnvironmentCaptureCard
          contactAction={null}
          coverage={70}
          known={21}
          script={GAP_SCRIPTS[70]}
          total={30}
        />
      </StudyState>
      <StudyState label="100% · Free-form update">
        <EnvironmentCaptureCard
          contactAction={null}
          coverage={100}
          known={30}
          script={UPDATE_SCRIPT}
          total={30}
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
