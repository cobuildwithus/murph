import type {
  BiomarkerProtocolRankingModel,
} from "@/src/lib/health-commons/biomarker-detail";

export function biomarkerFitToneClassName(
  fitLabel: BiomarkerProtocolRankingModel["fitLabel"],
): string {
  switch (fitLabel) {
    case "Strong":
    case "Good":
      return "text-primary";
    case "Context":
      return "text-foreground";
    case "Exploratory":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}
