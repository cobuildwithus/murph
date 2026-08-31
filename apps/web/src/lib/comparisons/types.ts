export const COMPARISON_CATEGORIES = [
  {
    description:
      "Devices and ecosystems that measure sleep, recovery, activity, and training.",
    id: "wearables",
    label: "Wearables and recovery",
  },
  {
    description:
      "Apps that collect records, symptoms, habits, and health data into one view.",
    id: "health-data",
    label: "Health data and dashboards",
  },
  {
    description:
      "Lab memberships, preventive scans, longevity programs, and clinical services.",
    id: "labs-longevity",
    label: "Labs and longevity",
  },
  {
    description:
      "Training plans, personal coaching, workout libraries, and sports analysis.",
    id: "fitness",
    label: "Fitness and coaching",
  },
  {
    description:
      "Food logging, weight programs, metabolic feedback, and nutrition care.",
    id: "nutrition",
    label: "Nutrition and weight",
  },
  {
    description:
      "Sleep improvement, stress support, meditation, mood, and mental wellbeing.",
    id: "sleep-mental",
    label: "Sleep and mental wellbeing",
  },
  {
    description:
      "Conversational and AI-led products that answer health questions or guide habits.",
    id: "health-assistants",
    label: "Health assistants",
  },
] as const;

export type ComparisonCategoryId =
  (typeof COMPARISON_CATEGORIES)[number]["id"];

export type ComparisonRelationship =
  | "alternative"
  | "complement"
  | "different-role";

export type ComparisonIsoDate = `${number}-${number}-${number}`;

export function formatComparisonDate(value: ComparisonIsoDate): string {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export interface ComparisonSource {
  label: string;
  url: string;
}

export interface ComparisonFaq {
  answer: string;
  question: string;
}

export interface CompetitorProfile {
  clinicalRole: string;
  followThrough: string;
  format: string;
  hardware: string;
  inputs: string;
  insightStyle: string;
  platforms: string;
  pricing: string;
  primaryJob: string;
}

export type CompetitorEvidence = {
  [Key in keyof CompetitorProfile]: readonly [number, ...number[]];
};

export interface ComparisonEntry {
  aliases?: readonly string[];
  bestFor: string;
  bottomLine: string;
  category: ComparisonCategoryId;
  chooseCompetitor: string;
  chooseMurph: string;
  competitor: CompetitorProfile;
  competitorEvidence: CompetitorEvidence;
  faqs: readonly [ComparisonFaq, ComparisonFaq, ComparisonFaq];
  headline: string;
  lastVerified: ComparisonIsoDate;
  metaDescription: string;
  name: string;
  overview: string;
  relationship: ComparisonRelationship;
  slug: string;
  sources: readonly [ComparisonSource, ComparisonSource, ...ComparisonSource[]];
  tradeoffs: readonly [string, string, ...string[]];
  useTogether?: string;
}

export function defineComparisons<
  const TEntries extends readonly ComparisonEntry[],
>(entries: TEntries): TEntries {
  return entries;
}
