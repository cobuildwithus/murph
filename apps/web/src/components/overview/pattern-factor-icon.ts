import type { PersonalPatternFactor } from "@murphai/query/browser-overview";

const PATTERN_ASSET_ROOT = "/design-assets/patterns";
const HABITAT_ASSET_ROOT = "/design-assets/habitat";

export const ACTIVITY_FALLBACK_ICON = `${PATTERN_ASSET_ROOT}/activity.svg`;
export const INTERVENTION_FALLBACK_ICON = `${PATTERN_ASSET_ROOT}/tag.svg`;

const RULES: ReadonlyArray<{ icon: string; tokens: readonly string[] }> = [
  {
    icon: pattern("parenting"),
    tokens: ["parenting", "stroller", "babywearing", "toddlerwearing"],
  },
  { icon: pattern("dog-walking"), tokens: ["dog-walking"] },
  {
    icon: pattern("walking"),
    tokens: [
      "walking",
      "walk",
      "hiking",
      "rucking",
      "caddying",
      "wheelchair-pushing",
    ],
  },
  {
    icon: pattern("running"),
    tokens: [
      "running",
      "run",
      "jogging",
      "track-field",
      "duathlon",
      "triathlon",
      "obstacle-course",
      "stadium-steps",
      "stairmaster",
      "jumping-rope",
      "hiit",
    ],
  },
  {
    icon: pattern("cycling"),
    tokens: ["cycling", "biking", "bike", "spin", "assault-bike"],
  },
  { icon: pattern("swimming"), tokens: ["swimming", "swim"] },
  { icon: pattern("rowing"), tokens: ["rowing", "row"] },
  { icon: pattern("golf"), tokens: ["golf"] },
  {
    icon: pattern("racket-sports"),
    tokens: ["tennis", "squash", "pickleball", "badminton", "padel"],
  },
  {
    icon: pattern("combat-sports"),
    tokens: [
      "fencing",
      "wrestling",
      "boxing",
      "martial-arts",
      "jiu-jitsu",
      "kickboxing",
    ],
  },
  {
    icon: pattern("ball-sports"),
    tokens: [
      "baseball",
      "basketball",
      "field-hockey",
      "football",
      "ice-hockey",
      "lacrosse",
      "rugby",
      "soccer",
      "softball",
      "volleyball",
      "water-polo",
      "ultimate",
      "australian-football",
      "gaelic-football",
      "hurling",
      "camogie",
      "handball",
      "netball",
      "spikeball",
      "cricket",
      "polo",
    ],
  },
  {
    icon: pattern("winter-sports"),
    tokens: ["skiing", "snowboarding", "ice-skating", "cross-country-skiing"],
  },
  {
    icon: pattern("water-sports"),
    tokens: [
      "sailing",
      "kayaking",
      "paddleboarding",
      "surfing",
      "diving",
      "kite-boarding",
      "water-skiing",
      "wakeboarding",
    ],
  },
  {
    icon: pattern("outdoor-sports"),
    tokens: [
      "climbing",
      "climber",
      "parkour",
      "horseback-riding",
      "motocross",
      "paintball",
      "skateboarding",
      "inline-skating",
      "motor-racing",
    ],
  },
  {
    icon: pattern("strength"),
    tokens: [
      "weightlifting",
      "powerlifting",
      "strength",
      "functional-fitness",
      "gymnastics",
      "elliptical",
      "box-fitness",
      "f45-training",
      "barry-s",
    ],
  },
  {
    icon: pattern("mind-body"),
    tokens: ["meditation", "pilates", "yoga", "barre", "barre3", "stretching"],
  },
  {
    icon: pattern("performance"),
    tokens: [
      "dance",
      "dancing",
      "stage-performance",
      "musical-performance",
      "circus-arts",
      "public-speaking",
    ],
  },
  {
    icon: pattern("recovery"),
    tokens: ["massage", "air-compression", "percussive-massage"],
  },
  {
    icon: habitat("plunge"),
    tokens: ["ice-bath", "cold-plunge", "cold-exposure", "plunge"],
  },
  { icon: habitat("sauna"), tokens: ["sauna"] },
  { icon: pattern("commute"), tokens: ["commuting"] },
  { icon: pattern("gaming"), tokens: ["gaming", "watching-sports"] },
  { icon: habitat("stove"), tokens: ["cooking"] },
  {
    icon: habitat("briefcase"),
    tokens: [
      "operations-tactical",
      "operations-medical",
      "operations-flying",
      "operations-water",
      "high-stress-work",
      "coaching",
    ],
  },
  { icon: pattern("work"), tokens: ["manual-labor", "yard-work", "cleaning"] },
  { icon: pattern("general-activity"), tokens: ["activity", "other"] },
  {
    icon: habitat("coffee-break"),
    tokens: ["coffee", "caffeine", "espresso", "energy-drink"],
  },
  { icon: pattern("alcohol"), tokens: ["alcohol", "beer", "wine", "cocktail"] },
  {
    icon: pattern("meal"),
    tokens: [
      "meal",
      "dinner",
      "lunch",
      "breakfast",
      "food",
      "fasting",
      "snack",
    ],
  },
  {
    icon: pattern("medication"),
    tokens: [
      "medication",
      "medicine",
      "supplement",
      "magnesium",
      "melatonin",
      "vitamin",
    ],
  },
  {
    icon: habitat("smoke"),
    tokens: ["smoking", "cigarette", "nicotine", "tobacco"],
  },
  {
    icon: habitat("morning-sun"),
    tokens: ["sunlight", "morning-sun", "daylight"],
  },
  {
    icon: pattern("travel"),
    tokens: ["travel", "flight", "flying", "jet-lag"],
  },
  {
    icon: pattern("wellness"),
    tokens: [
      "breathwork",
      "breathing",
      "sickness",
      "illness",
      "stress",
      "hydration",
      "water",
      "menstrual",
      "period",
    ],
  },
  { icon: habitat("bed"), tokens: ["bedtime", "nap", "sleep"] },
  { icon: habitat("redlight"), tokens: ["red-light"] },
];

export function resolvePatternFactorIcon(
  factor: PersonalPatternFactor,
): string {
  const token = normalizeToken(`${factor.id} ${factor.label}`);
  const match = RULES.find((rule) =>
    rule.tokens.some((candidate) => tokenIncludes(token, candidate)),
  );
  if (match) return match.icon;
  return factor.kind === "activity"
    ? ACTIVITY_FALLBACK_ICON
    : INTERVENTION_FALLBACK_ICON;
}

function pattern(name: string): string {
  return `${PATTERN_ASSET_ROOT}/${name}.svg`;
}

function habitat(name: string): string {
  return `${HABITAT_ASSET_ROOT}/${name}.svg`;
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function tokenIncludes(token: string, candidate: string): boolean {
  return `-${token}-`.includes(`-${candidate}-`);
}
