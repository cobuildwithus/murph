import { HomeExperimentCard } from "@/src/components/home/home-experiment-card";
import type { ExperimentLibraryCard } from "@/src/lib/experiments/library-cards";

const DESIGN_REPEATED_CADENCE_CARD: ExperimentLibraryCard = {
  category: "Movement",
  description: "Synthetic repeated-cadence run for component review.",
  hasPrivateData: true,
  href: "/design?tab=components#experiment-daily-cadence-card",
  id: "design-repeated-cadence",
  image: "/design-assets/hero-03.png",
  privateBadgeLabel: "Private data",
  runStatus: "active",
  runSummary: {
    completionPercent: 36,
    dailyCadence: {
      cadence: "6x Daily",
      completed: 3,
      expected: 6,
      label: "Movement practice",
    },
    day: 5,
    metrics: [],
  },
  searchText: "synthetic repeated daily movement cadence",
  startedOn: "2026-08-03",
  statusLabel: "Active",
  statusVariant: "default",
  title: "Movement practice",
};

export function ExperimentCadenceStudy() {
  return (
    <section
      className="mx-auto w-full max-w-5xl px-6 pb-4 pt-12 sm:px-10 lg:px-16"
      id="experiment-daily-cadence-card"
    >
      <div className="border-b border-[#e5e1d8] pb-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Experiment cadence
        </p>
        <h1 className="mt-2 max-w-2xl font-serif text-3xl font-semibold tracking-tight text-foreground">
          Repeated daily targets
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Active runs with multiple actions per day lead with today&apos;s completed count instead of elapsed-time progress.
        </p>

        <div
          className="mt-7 max-w-xl"
          data-design-experiment-daily-cadence-card
        >
          <HomeExperimentCard card={DESIGN_REPEATED_CADENCE_CARD} variant="default" />
        </div>
      </div>
    </section>
  );
}
