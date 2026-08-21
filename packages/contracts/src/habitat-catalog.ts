// Habitat domain catalog: the versioned product definition of what Murph is
// worth knowing about a member's living context. Product spec, not per-member
// state — see agent-docs/product-specs/habitat.md.

export const HABITAT_DOMAIN_IDS = ["environment", "workspace", "exercise"] as const;

export type HabitatDomainId = (typeof HABITAT_DOMAIN_IDS)[number];

export const HABITAT_INDICATOR_PRIORITIES = ["high", "medium", "low"] as const;

export type HabitatIndicatorPriority = (typeof HABITAT_INDICATOR_PRIORITIES)[number];

export const HABITAT_DECLINED_VALUE = "declined";

export type HabitatIndicatorValue = string | number | boolean | null;

export type HabitatIndicatorValueType =
  | { kind: "enum"; values: readonly string[] }
  | { kind: "number"; min?: number; max?: number; unit?: string }
  | { kind: "boolean" }
  | { kind: "text"; maxLength?: number };

export interface HabitatIndicatorDefinition {
  id: string;
  label: string;
  priority: HabitatIndicatorPriority;
  valueType: HabitatIndicatorValueType;
  /** Example conversational opener; catalog questions are starters, not form fields. */
  question?: string;
  /** Evidence anchor shown in UI/audit, e.g. "co2 < 1000 ppm". */
  target?: string;
  /** Informational indicators ground advice but never become target conditions. */
  informational?: boolean;
  /**
   * Optional positive capability credit. Missing, declined, and zero-point
   * values stay neutral. Related indicators share a group so one device cannot
   * count twice.
   */
  capabilityBonus?: {
    group?: string;
    pointsByValue: Readonly<Record<string, number>>;
  };
}

export interface HabitatAspectDefinition {
  /** Aspect slug; also the markdown file name under bank/habitat/. */
  id: string;
  title: string;
  domain: HabitatDomainId;
  summary: string;
  indicators: readonly HabitatIndicatorDefinition[];
}

export interface HabitatCatalog {
  version: string;
  aspects: readonly HabitatAspectDefinition[];
}

function enumType(...values: string[]): HabitatIndicatorValueType {
  return { kind: "enum", values };
}

const TEXT: HabitatIndicatorValueType = { kind: "text", maxLength: 400 };
const BOOL: HabitatIndicatorValueType = { kind: "boolean" };
const CITY_OR_REGION_MAX_LENGTH = 120;
const CITY_OR_REGION_CHARACTERS = /^[\p{L}\p{M}][\p{L}\p{M} .,'’()/-]*$/u;
const PRECISE_ADDRESS_WORDS =
  /\b(?:apartment|apt|avenue|boulevard|building|calle|drive|flat|floor|house|lane|lokal|mieszkanie|osiedle|postal|postcode|road|rue|street|suite|ulica|unit|zip)\b/iu;

/**
 * Returns provider-safe member-stated location context. This deliberately
 * refuses to infer a city from address-shaped input: callers should ask the
 * member for a city or approximate region instead.
 */
export function normalizeHabitatCityOrRegion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (
    normalized.length === 0
    || normalized.length > CITY_OR_REGION_MAX_LENGTH
    || !CITY_OR_REGION_CHARACTERS.test(normalized)
    || /\d/u.test(normalized)
    || PRECISE_ADDRESS_WORDS.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export const HABITAT_CATALOG: HabitatCatalog = {
  version: "2026-08-20",
  aspects: [
    {
      id: "home-location",
      title: "Location & climate",
      domain: "environment",
      summary:
        "Climate, season, daylight hours, pollen season, and outdoor air quality all derive from location.",
      indicators: [
        {
          id: "location",
          label: "City / region",
          priority: "high",
          informational: true,
          valueType: TEXT,
          question: "Where do you live these days? A city is enough.",
        },
        {
          id: "area_type",
          label: "Area type",
          priority: "medium",
          informational: true,
          valueType: enumType("urban_center", "suburbs", "rural"),
          question: "Are you in the city center, suburbs, or outside town?",
        },
        {
          id: "travel_pattern",
          label: "Travel pattern",
          priority: "low",
          valueType: enumType("mostly_home", "frequent_travel"),
          question: "Are you mostly in one place, or on the road a lot?",
          informational: true,
        },
      ],
    },
    {
      id: "sleep-environment",
      title: "Bedroom & sleep",
      domain: "environment",
      summary:
        "The strongest levers: temperature, CO2, darkness, noise. Worst exposure quintiles cut sleep efficiency by 3-5%.",
      indicators: [
        {
          id: "night_temp_c",
          label: "Night temperature",
          priority: "high",
          valueType: { kind: "number", min: -10, max: 45, unit: "°C" },
          question: "Do you know roughly how warm your bedroom is at night?",
          target: "18-22°C",
        },
        {
          id: "temp_control",
          label: "Temperature control",
          priority: "high",
          informational: true,
          valueType: enumType("ac", "adjustable_heating", "none"),
          question: "Can you control it — AC, heating?",
          capabilityBonus: {
            pointsByValue: { ac: 1, adjustable_heating: 1 },
          },
        },
        {
          id: "window_at_night",
          label: "Window at night",
          priority: "high",
          informational: true,
          valueType: enumType("open", "closed", "seasonal"),
          question: "Do you sleep with the window open or closed?",
        },
        {
          id: "co2_meter",
          label: "CO2 meter",
          priority: "high",
          informational: true,
          valueType: enumType("aranet", "other", "none"),
          question: "Ever measured CO2 in your bedroom?",
          capabilityBonus: {
            group: "indoor_air_measurement",
            pointsByValue: { aranet: 1, other: 1 },
          },
        },
        {
          id: "co2_typical_ppm",
          label: "Typical night CO2",
          priority: "medium",
          valueType: { kind: "number", min: 300, max: 10_000, unit: "ppm" },
          target: "<1000 ppm, ideally <800",
        },
        {
          id: "darkness",
          label: "Darkness",
          priority: "high",
          valueType: enumType("blackout", "partial", "bright"),
          question: "Is your bedroom properly dark, or does morning light wake you?",
          target: "full darkness",
        },
        {
          id: "night_noise",
          label: "Noise at night",
          priority: "high",
          valueType: enumType("quiet", "moderate", "loud"),
          question: "Is it quiet at night where you are?",
          target: "<35 dB",
        },
        {
          id: "noise_countermeasures",
          label: "Noise countermeasures",
          priority: "medium",
          informational: true,
          valueType: enumType("earplugs", "white_noise", "none"),
          capabilityBonus: {
            pointsByValue: { earplugs: 1, white_noise: 1 },
          },
        },
        {
          id: "humidity_known",
          label: "Humidity",
          priority: "medium",
          informational: true,
          valueType: enumType("measured", "humidifier", "dehumidifier", "unmanaged"),
          question: "Does the air get dry in winter? Do you run a humidifier?",
          target: "40-60% RH",
          capabilityBonus: {
            pointsByValue: { measured: 1, humidifier: 1, dehumidifier: 1 },
          },
        },
        {
          id: "mattress_satisfaction",
          label: "Mattress",
          priority: "medium",
          valueType: enumType("good", "acceptable", "poor"),
          question: "How's your mattress treating you?",
        },
        {
          id: "mattress_age_years",
          label: "Mattress age",
          priority: "low",
          informational: true,
          valueType: { kind: "number", min: 0, max: 60, unit: "years" },
        },
        {
          id: "bedding_overheating",
          label: "Overheating under bedding",
          priority: "medium",
          valueType: enumType("never", "sometimes", "often"),
          question: "Do you overheat under your duvet at night?",
        },
        {
          id: "co_sleepers",
          label: "Who shares the bed",
          priority: "medium",
          valueType: enumType("alone", "partner", "partner_and_kids", "kids", "pets", "mixed"),
          question: "Do you sleep alone or with someone — partner, kids, pets?",
          informational: true,
        },
        {
          id: "phone_by_bed",
          label: "Phone by the bed",
          priority: "medium",
          valueType: BOOL,
          question: "Does your phone sleep next to you, or in another room?",
        },
        {
          id: "tv_in_bedroom",
          label: "TV in the bedroom",
          priority: "low",
          valueType: BOOL,
        },
      ],
    },
    {
      id: "home-air",
      title: "Air at home",
      domain: "environment",
      summary:
        "PM2.5, NO2 from gas stoves, mold and damp. WHO: indoor PM2.5 under 10 µg/m³.",
      indicators: [
        {
          id: "ventilation",
          label: "Ventilation",
          priority: "high",
          informational: true,
          valueType: enumType("mechanical_recuperation", "mechanical", "windows_only"),
          question: "Does your place have mechanical ventilation, or do you air it out with windows?",
        },
        {
          id: "damp_or_mold",
          label: "Damp & mold",
          priority: "high",
          valueType: enumType("visible_mold", "damp_problems", "none"),
          question: "Any damp or mold anywhere in your place?",
        },
        {
          id: "air_purifier",
          label: "Air purifier",
          priority: "medium",
          informational: true,
          valueType: enumType("hepa", "other", "none"),
          question: "Do you run an air purifier?",
          capabilityBonus: {
            pointsByValue: { hepa: 3, other: 1 },
          },
        },
        {
          id: "air_quality_meter",
          label: "Air quality meter",
          priority: "medium",
          informational: true,
          valueType: enumType("pm25", "co2", "combined", "none"),
          question: "Do you measure air quality at home with anything?",
          capabilityBonus: {
            group: "indoor_air_measurement",
            pointsByValue: { pm25: 1, co2: 1, combined: 2 },
          },
        },
        {
          id: "stove",
          label: "Stove",
          priority: "medium",
          informational: true,
          valueType: enumType("gas", "induction", "electric"),
          question: "Do you cook on gas or induction?",
          target: "gas → NO2; ventilate while cooking",
        },
        {
          id: "smoke_sources",
          label: "Smoke indoors",
          priority: "low",
          valueType: enumType("smoking", "fireplace", "frequent_candles", "none"),
        },
        {
          id: "radon_tested",
          label: "Radon",
          priority: "low",
          informational: true,
          valueType: enumType("tested_ok", "tested_high", "not_tested"),
          target: "only relevant in risk regions on ground floor/basement",
          capabilityBonus: {
            pointsByValue: { tested_ok: 2 },
          },
        },
      ],
    },
    {
      id: "lighting",
      title: "Light",
      domain: "environment",
      summary:
        "Morning daylight anchors the circadian rhythm; cool bright evening light suppresses melatonin.",
      indicators: [
        {
          id: "evening_light",
          label: "Evening light",
          priority: "high",
          valueType: enumType("warm_dim", "warm_bright", "cool", "mixed"),
          question: "What's your light like in the evening — warm and dim, or bright white?",
          target: "≤2700-3000K, dimmed in the last 2h before bed",
        },
        {
          id: "morning_light_access",
          label: "Morning light access",
          priority: "high",
          valueType: enumType("outdoor_routine", "balcony_or_garden", "east_windows", "none"),
          question: "Can you catch daylight in the morning — balcony, a walk, east windows?",
          target: "10-30 min of daylight within 1h of waking",
        },
        {
          id: "daytime_light",
          label: "Daytime light",
          priority: "medium",
          valueType: enumType("by_window", "bright_artificial", "dim"),
          question: "Do you work near a window, or in a darker spot?",
        },
        {
          id: "high_cri_bulbs",
          label: "High-CRI bulbs",
          priority: "low",
          valueType: BOOL,
          informational: true,
        },
        {
          id: "light_therapy_lamp",
          label: "Light therapy lamp",
          priority: "low",
          valueType: BOOL,
          informational: true,
          capabilityBonus: {
            pointsByValue: { true: 1 },
          },
        },
      ],
    },
    {
      id: "water",
      title: "Water",
      domain: "environment",
      summary: "Low-priority aspect; one question and done.",
      indicators: [
        {
          id: "drinking_water",
          label: "Drinking water",
          priority: "low",
          valueType: enumType("tap", "filtered", "bottled"),
          question: "Do you drink tap water, filtered, or bottled?",
          informational: true,
        },
      ],
    },
    {
      id: "recovery-access",
      title: "Recovery infrastructure",
      domain: "environment",
      summary:
        "Access to sauna, cold, and red light — Murph should only propose protocols within reach.",
      indicators: [
        {
          id: "sauna_access",
          label: "Sauna",
          priority: "high",
          informational: true,
          valueType: enumType("home", "gym", "nearby", "none"),
          question: "Do you have access to a sauna anywhere — at home, at the gym?",
          capabilityBonus: {
            pointsByValue: { home: 3, gym: 2, nearby: 2 },
          },
        },
        {
          id: "sauna_type",
          label: "Sauna type",
          priority: "low",
          valueType: enumType("dry", "steam", "infrared"),
          informational: true,
        },
        {
          id: "cold_exposure",
          label: "Cold exposure",
          priority: "medium",
          valueType: enumType("cold_showers", "plunge", "winter_swimming", "none"),
          question: "Do you do anything with cold — cold showers, winter swims?",
          informational: true,
          capabilityBonus: {
            pointsByValue: {
              cold_showers: 1,
              plunge: 2,
              winter_swimming: 1,
            },
          },
        },
        {
          id: "red_light",
          label: "Red light therapy",
          priority: "medium",
          valueType: enumType("panel_owned", "access", "none"),
          question: "Do you have a red light panel?",
          informational: true,
          capabilityBonus: {
            pointsByValue: { panel_owned: 1, access: 1 },
          },
        },
        {
          id: "red_light_model",
          label: "Red light model",
          priority: "low",
          valueType: TEXT,
          target: "dosing depends on the model",
          informational: true,
        },
      ],
    },
    {
      id: "health-devices",
      title: "Health devices",
      domain: "environment",
      summary:
        "Standalone measurement devices without data integrations; what the member can measure on demand.",
      indicators: [
        {
          id: "scale",
          label: "Scale",
          priority: "medium",
          valueType: enumType("smart", "basic", "none"),
          informational: true,
          capabilityBonus: {
            pointsByValue: { smart: 1, basic: 1 },
          },
        },
        {
          id: "bp_cuff",
          label: "Blood-pressure cuff",
          priority: "medium",
          valueType: BOOL,
          question: "Do you have a blood-pressure cuff at home?",
          informational: true,
          capabilityBonus: {
            pointsByValue: { true: 2 },
          },
        },
        {
          id: "thermometer",
          label: "Thermometer",
          priority: "low",
          valueType: BOOL,
          informational: true,
          capabilityBonus: {
            pointsByValue: { true: 1 },
          },
        },
        {
          id: "pulse_oximeter",
          label: "Pulse oximeter",
          priority: "low",
          valueType: BOOL,
          informational: true,
          capabilityBonus: {
            pointsByValue: { true: 1 },
          },
        },
      ],
    },
    {
      id: "allergens-home",
      title: "Home allergens",
      domain: "environment",
      summary:
        "Exposure only; diagnosed allergies stay in the medical allergy records and link here.",
      indicators: [
        {
          id: "pets_at_home",
          label: "Pets at home",
          priority: "medium",
          valueType: enumType("cat", "dog", "cat_and_dog", "other", "none"),
          question: "Any pets at home?",
          informational: true,
        },
        {
          id: "carpets",
          label: "Carpets / rugs",
          priority: "low",
          valueType: BOOL,
          informational: true,
        },
      ],
    },
    {
      id: "workspace",
      title: "Desk ergonomics",
      domain: "workspace",
      summary:
        "Top of screen at eye level, 50-75 cm distance, desk at elbow height, 20-8-2 sit/stand/move pattern.",
      indicators: [
        {
          id: "work_mode",
          label: "Work mode",
          priority: "high",
          informational: true,
          valueType: enumType("remote", "office", "hybrid"),
        },
        {
          id: "desk_hours",
          label: "Hours at a desk",
          priority: "high",
          informational: true,
          valueType: { kind: "number", min: 0, max: 18, unit: "h/day" },
          question: "How many hours a day do you actually spend at a desk?",
        },
        {
          id: "standing_desk",
          label: "Standing desk",
          priority: "high",
          informational: true,
          valueType: enumType("adjustable_used", "adjustable_unused", "fixed"),
          question: "Do you have a height-adjustable desk? Do you use it standing?",
          target: "20-8-2 pattern",
          capabilityBonus: {
            pointsByValue: { adjustable_used: 2, adjustable_unused: 2 },
          },
        },
        {
          id: "screen_setup",
          label: "Screen setup",
          priority: "high",
          informational: true,
          valueType: enumType("external_monitor", "laptop_only", "mixed"),
          question: "Do you work on just the laptop, or an external monitor?",
          capabilityBonus: {
            pointsByValue: { external_monitor: 1, mixed: 1 },
          },
        },
        {
          id: "screen_at_eye_level",
          label: "Screen at eye level",
          priority: "high",
          valueType: BOOL,
          target: "top of screen ≈ eye level, 50-75 cm",
        },
        {
          id: "chair",
          label: "Chair",
          priority: "medium",
          informational: true,
          valueType: enumType("ergonomic", "ordinary", "varies"),
          question: "What do you sit on — a proper chair, or whatever's around?",
          capabilityBonus: {
            pointsByValue: { ergonomic: 1 },
          },
        },
        {
          id: "external_keyboard",
          label: "External keyboard with laptop",
          priority: "medium",
          informational: true,
          valueType: BOOL,
          capabilityBonus: {
            pointsByValue: { true: 1 },
          },
        },
        {
          id: "wrist_complaints",
          label: "Wrist complaints",
          priority: "medium",
          valueType: BOOL,
          question: "Wrists holding up okay?",
        },
        {
          id: "breaks",
          label: "Breaks",
          priority: "medium",
          valueType: enumType("systematic", "irregular", "none"),
          question: "Do you take breaks during the day, or power through?",
        },
      ],
    },
    {
      id: "exercise-access",
      title: "Exercise equipment & access",
      domain: "exercise",
      summary:
        "Skeleton aspect; the exercise domain (equipment, venues, movement preferences) is specified separately.",
      indicators: [
        {
          id: "gym_access",
          label: "Gym access",
          priority: "high",
          informational: true,
          valueType: enumType("membership", "home_gym", "both", "none"),
          question: "Do you have gym access — a membership, or gear at home?",
        },
      ],
    },
  ],
};

const habitatAspectById = new Map<string, HabitatAspectDefinition>(
  HABITAT_CATALOG.aspects.map((aspect) => [aspect.id, aspect]),
);

export function getHabitatAspectDefinition(
  aspectId: string,
): HabitatAspectDefinition | null {
  return habitatAspectById.get(aspectId) ?? null;
}

export function requireHabitatAspectDefinition(
  aspectId: string,
): HabitatAspectDefinition {
  const aspect = getHabitatAspectDefinition(aspectId);

  if (!aspect) {
    throw new Error(`Unknown habitat aspect "${aspectId}".`);
  }

  return aspect;
}

export function getHabitatIndicatorDefinition(
  aspectId: string,
  indicatorId: string,
): HabitatIndicatorDefinition | null {
  return (
    getHabitatAspectDefinition(aspectId)?.indicators.find(
      (indicator) => indicator.id === indicatorId,
    ) ?? null
  );
}

export function isHabitatDeclinedValue(value: HabitatIndicatorValue): boolean {
  return value === HABITAT_DECLINED_VALUE;
}

export function validateHabitatIndicatorValue(
  definition: HabitatIndicatorDefinition,
  value: HabitatIndicatorValue,
): string | null {
  if (value === null || isHabitatDeclinedValue(value)) {
    return null;
  }

  const valueType = definition.valueType;

  switch (valueType.kind) {
    case "enum":
      if (typeof value !== "string" || !valueType.values.includes(value)) {
        return `Expected one of: ${valueType.values.join(", ")}.`;
      }
      return null;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "Expected a number.";
      }
      if (valueType.min !== undefined && value < valueType.min) {
        return `Expected a number ≥ ${valueType.min}.`;
      }
      if (valueType.max !== undefined && value > valueType.max) {
        return `Expected a number ≤ ${valueType.max}.`;
      }
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : "Expected true or false.";
    case "text": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return "Expected non-empty text.";
      }
      if (valueType.maxLength !== undefined && value.length > valueType.maxLength) {
        return `Expected text of at most ${valueType.maxLength} characters.`;
      }
      return null;
    }
  }
}
