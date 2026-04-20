import type { Experiment } from "@/src/types/experiments";
import { ExpectedSignalCard } from "./expected-signal-card";
import { ExpertCard } from "./expert-card";
import { StudyCard } from "./study-card";
import { SafetySection } from "./safety-section";

interface ProtocolTabProps {
  experiment: Experiment;
}

export function ProtocolTab({ experiment }: ProtocolTabProps) {
  const {
    expectedSignals,
    protocol,
    whyItWorks,
    experts,
    researchStats,
    studies,
    podcastLinks,
    safety,
  } = experiment;

  return (
    <div className="flex flex-col gap-10">

      <div className="grid gap-4 pt-2 md:grid-cols-2 xl:grid-cols-3">
        {expectedSignals.map((signal) => (
          <ExpectedSignalCard
            key={signal.label}
            label={signal.label}
            expected={signal.expected}
            direction={signal.direction}
            description={signal.description ?? ""}
          />
        ))}
      </div>

      {/* Protocol steps + Why It Works */}
      <div className="flex flex-col gap-10 xl:flex-row">
        <div className="flex grow shrink basis-0 flex-col gap-5">
          <span className="font-mono text-[11px]/3.5 tracking-[0.12em] text-chart-5">
            PROTOCOL
          </span>
          {protocol.map((step) => (
            <div key={step.number} className="flex gap-3.5">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary/15">
                <span className="font-mono text-[11px]/3.5 text-chart-5">
                  {step.number}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm/4.5 font-semibold text-foreground">
                  {step.title}
                </span>
                <span className="text-[13px]/4 text-chart-5">
                  {step.detail}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex grow shrink basis-0 flex-col gap-4 rounded-xl border border-secondary/25 bg-card/90 p-7">
          <span className="font-mono text-[11px]/3.5 tracking-[0.12em] text-chart-5">
            WHY IT WORKS
          </span>
          {whyItWorks.split("\n\n").map((paragraph, i) => (
            <p
              key={i}
              className="text-[14px] leading-[170%] text-foreground/80"
            >
              {paragraph}
            </p>
          ))}
        </div>
      </div>

      {/* Recommended by */}
      {experts.length > 0 && (
        <div className="flex flex-col gap-3.5">
          <span className="font-mono text-[11px]/3.5 tracking-[0.12em] text-chart-5">
            RECOMMENDED BY
          </span>
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {experts.map((expert) => (
              <ExpertCard key={expert.name} {...expert} />
            ))}
          </div>
        </div>
      )}

      {/* Research */}
      <div className="flex flex-col gap-5">
        <span className="font-mono text-[11px]/3.5 tracking-[0.12em] text-chart-5">
          RESEARCH
        </span>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {researchStats.map((stat) => (
            <div
              key={stat.label}
              className="flex grow shrink basis-0 flex-col items-center gap-1 rounded-xl border border-secondary/25 bg-card/90 p-5"
            >
              <span className="font-serif text-[32px]/10 font-semibold text-foreground">
                {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
              </span>
              <span className="font-mono text-[10px]/3 tracking-[0.08em] text-chart-5">
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Study cards - unified container */}
        {studies.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-secondary/25 bg-card/90">
            {studies.map((study, i) => (
              <StudyCard
                key={study.title}
                {...study}
                last={i === studies.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      {/* Podcast links */}
      {podcastLinks && podcastLinks.length > 0 && (
        <div className="flex gap-2.5">
          {podcastLinks.map((link) => (
            <div
              key={link.label}
              className="flex items-center gap-2 rounded-lg bg-secondary/8 px-3.5 py-2"
            >
              <span className="font-mono text-[11px]/3.5 text-muted-foreground">
                ▶
              </span>
              <span className="text-xs/4 text-muted-foreground">{link.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Safety */}
      <SafetySection {...safety} />
    </div>
  );
}
