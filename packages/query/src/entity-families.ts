import type { CanonicalEntityFamily } from "./canonical-entities.ts";

export const ALL_QUERY_ENTITY_FAMILIES = [
  "allergy",
  "assessment",
  "audit",
  "condition",
  "core",
  "event",
  "experiment",
  "family",
  "food",
  "genetics",
  "goal",
  "habitat",
  "journal",
  "protocol",
  "provider",
  "regimen",
  "recipe",
  "sample",
  "workout_format",
] as const satisfies readonly CanonicalEntityFamily[];
