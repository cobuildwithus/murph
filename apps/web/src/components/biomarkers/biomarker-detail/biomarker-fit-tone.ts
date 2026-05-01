import type {
  BiomarkerProtocolRankingModel,
} from "@/src/lib/health-commons/biomarker-projections";

type BiomarkerFitLabel =
  | BiomarkerProtocolRankingModel["fitLabel"]
  | "Context"
  | "Exploratory"
  | "Good"
  | "Strong";

export function biomarkerFitToneClassName(
  fitLabel: BiomarkerFitLabel,
): string {
  switch (fitLabel) {
    case "High":
    case "Medium":
    case "Strong":
    case "Good":
      return "text-primary";
    case "Low":
    case "Unknown":
    case "Context":
      return "text-foreground";
    case "Exploratory":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}
