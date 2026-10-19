import { BiomarkerPrivateTrendCard } from "./biomarker-private-trend-card";
import type { BiomarkerOverviewProjection } from "@/src/lib/health-commons/biomarker-projections";

export function BiomarkerOverview({ biomarker }: { biomarker: BiomarkerOverviewProjection }) {
  return (
    <div className="flex flex-col gap-12 pb-12">
      <BiomarkerPrivateTrendCard biomarker={biomarker} />
    </div>
  );
}
