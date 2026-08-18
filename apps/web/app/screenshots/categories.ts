export const SCREENSHOT_CATEGORIES = [
  {
    id: "home",
    label: "Home and public pages",
    description: "Homepage, onboarding, referrals, and member home states.",
  },
  {
    id: "account",
    label: "Account and plans",
    description:
      "Identity, Family, billing, usage, and account lifecycle states.",
  },
  {
    id: "groups",
    label: "Groups",
    description: "Joining, starting, sharing, and funding group experiences.",
  },
  {
    id: "health",
    label: "Health and data",
    description:
      "Connected sources, Environment, Patterns, training, experiments, and biomarkers.",
  },
  {
    id: "messages",
    label: "Messages and results",
    description:
      "Channel handoffs, approvals, shared results, and message-facing states.",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Model, consent, export, access, and recovery controls.",
  },
  {
    id: "ops",
    label: "Operations",
    description: "Internal usage, growth, changelog, and presentation studies.",
  },
] as const;

export type ScreenshotCategory = (typeof SCREENSHOT_CATEGORIES)[number]["id"];
