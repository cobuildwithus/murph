export interface ProjectedActivitySession {
  type: "run" | "walk" | "sauna" | "hiit" | "basketball" | "other";
  date: string;
  minutes: number;
}

export const DETAILED_WORKOUT_TYPES = [
  "cycling",
  "swimming",
  "walking",
  "functional_fitness",
  "hiking",
  "yoga",
  "dance",
  "sports",
  "strength_training",
] as const;
export type DetailedWorkout = Omit<ProjectedActivitySession, "type"> & {
  type: (typeof DETAILED_WORKOUT_TYPES)[number];
};
