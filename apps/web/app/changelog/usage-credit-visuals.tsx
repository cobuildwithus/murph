import type { PreferenceEntry } from "./visuals";

export const GROUP_SPONSORSHIP_USAGE_CREDIT_VISUAL = {
  entries: [
    { label: "Usage credit", value: "$5" },
    { label: "Usage credit", value: "$10" },
    { label: "Usage credit", value: "$20" },
  ] satisfies readonly PreferenceEntry[],
  label: "Sponsor this group",
  meta: "Monthly maximum",
} as const;

export const GROUP_FUNDING_USAGE_CREDIT_VISUAL = {
  entries: [
    { label: "Usage credit", value: "$5" },
    { label: "Usage credit", value: "$10" },
    { label: "Usage credit", value: "$25" },
  ] satisfies readonly PreferenceEntry[],
  label: "Keep Murph going",
  meta: "Usage credit",
} as const;
