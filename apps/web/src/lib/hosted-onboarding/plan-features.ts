// Single source of truth for the member-facing selling points on every plan
// card. Surfaces intentionally differ — the join page markets a plan to
// someone deciding to sign up, while settings and the plan dialogs compare
// plans a member can switch between — but every list lives here so a wording
// change lands on all surfaces at once.
//
// Copy rule: only Edge and Max may claim the most capable AI models. The top
// model requires their shared premium runtime entitlement
// (ASSISTANT_MODEL_SOL_REQUIRES_EDGE), so that claim on Pulse or Core would
// promise something the product blocks.

export const JOIN_PULSE_FEATURES = [
  "Private personal health assistant",
  "Questions, decisions, plans, and follow-through",
  "Sync your health data",
  "Chat with Murph via iMessage, Telegram, or email",
  "Experiments when you need a clear answer",
] as const;

export const SETTINGS_PULSE_FEATURES = [
  "Run experiments, see what changed",
  "Sync your health data",
  "Private before/after outcomes",
  "Chat with Murph via iMessage, Telegram, or email",
] as const;

export const CHECKOUT_PULSE_FEATURES = [
  ...SETTINGS_PULSE_FEATURES,
  "Guided experiment setup",
] as const;

export const EDGE_ONLY_FEATURES = [
  "The most capable AI models",
  "Higher monthly usage",
  "Murph remembers more of your history",
  "Deeper research and analysis",
] as const;

export const SETTINGS_EDGE_FEATURES = [
  "Everything in Pulse",
  ...EDGE_ONLY_FEATURES,
] as const;

export const SETTINGS_MAX_FEATURES = [
  "Everything in Edge",
  "Highest included monthly AI usage",
  "More room for frequent deep research and analysis",
  "Built for heavier, ongoing Murph use",
] as const;

export const JOIN_EDGE_FEATURES = [
  "Everything in Pulse and:",
  "The most capable AI models",
  "Higher monthly usage",
  "Murph remembers more of your history",
  "Deeper analysis across your context",
  "Richer plans and protocol recommendations",
  "Early access to new features",
] as const;

export const SETTINGS_CORE_FEATURES = [
  "Stay connected to Murph groups",
  "Sync your health and activity data",
  "Keep group scores current",
  "Private Murph chat",
  "Lighter included AI usage",
] as const;

export const CHECKOUT_CORE_FEATURES = [
  "Keep your wearable syncing",
  "Keep group activity current",
  "Private Murph conversations",
  "Lighter included AI usage",
] as const;

export const JOIN_FAMILY_FEATURES = [
  "2 to 6 people, one bill",
  "Choose Pulse, Edge, or Max for each person",
  "Each person keeps a private Murph",
  "Family members' chats and health data stay private",
] as const;

export const SETTINGS_FAMILY_FEATURES = [
  "2 to 6 people, one bill",
  "Choose Pulse, Edge, or Max for each person",
  "Each person keeps a private Murph",
  "You can't see members' chats or health data",
] as const;
