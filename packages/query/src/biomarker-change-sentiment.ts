import type {
  HealthCommonsBiomarkerDesiredDirection,
} from "@murphai/contracts";

export type BiomarkerChangeDirection = "down" | "neutral" | "up";
export type BiomarkerChangeSentiment = "negative" | "neutral" | "positive";

/**
 * Interpret a raw biomarker movement without conflating it with an experiment
 * hypothesis. Stable, contextual, unknown, and unchanged signals do not carry
 * enough directional information for a favorable/unfavorable judgment.
 */
export function resolveBiomarkerChangeSentiment(
  direction: BiomarkerChangeDirection,
  desiredDirection: HealthCommonsBiomarkerDesiredDirection | null,
): BiomarkerChangeSentiment {
  if (
    direction === "neutral" ||
    desiredDirection === null ||
    desiredDirection === "stable" ||
    desiredDirection === "mixed_or_contextual"
  ) {
    return "neutral";
  }

  if (desiredDirection === "higher" || desiredDirection === "higher_or_stable") {
    return direction === "up" ? "positive" : "negative";
  }

  if (desiredDirection === "lower" || desiredDirection === "lower_or_stable") {
    return direction === "down" ? "positive" : "negative";
  }

  return assertUnreachableDesiredDirection(desiredDirection);
}

function assertUnreachableDesiredDirection(value: never): never {
  throw new Error(`Unsupported biomarker desired direction: ${String(value)}`);
}
