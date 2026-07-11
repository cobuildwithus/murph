// Catalog-backed scene model for the environment page. Each catalog category
// owns one free-standing stage.

import {
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
  type HabitatIndicatorValue,
} from "@murphai/contracts";

export type HabitatState = "known" | "skipped" | "unknown";

export type ObjectKind =
  | "bed"
  | "ac"
  | "window"
  | "sensor"
  | "lamp"
  | "sun"
  | "purifier"
  | "stove"
  | "sauna"
  | "plunge"
  | "redlight"
  | "desk"
  | "chair"
  | "device";

export interface ObjectSprite {
  src: string;
  w: number;
  h: number;
  anchorY?: number;
}

interface ObjectDef {
  id: string;
  kind: ObjectKind;
  aspectId: string;
  indicatorId: string;
  label: string;
  lx: number;
  ly: number;
  z?: number;
  decor?: boolean;
  absent?: readonly HabitatIndicatorValue[];
  mount?: { side: "n" | "w"; z: number };
  sprite?: ObjectSprite;
}

interface CategoryDef {
  id: string;
  title: string;
  presentation: "vignette" | "shelf";
  aspectIds: readonly string[];
  thumbnail: ObjectSprite;
  w: number;
  d: number;
  objects: readonly ObjectDef[];
}

export interface ResolvedObject extends ObjectDef {
  state: HabitatState;
  value: HabitatIndicatorValue | undefined;
  valueText: string | null;
}

export interface ResolvedCategory extends Omit<CategoryDef, "objects"> {
  objects: ResolvedObject[];
  known: number;
  total: number;
}

export interface HabitatScene {
  categories: ResolvedCategory[];
  known: number;
  total: number;
}

const CATEGORIES: readonly CategoryDef[] = [
  {
    id: "sleep",
    title: "Sleep",
    presentation: "vignette",
    aspectIds: ["sleep-environment"],
    thumbnail: {
      src: "/design-assets/habitat/bed.svg",
      w: 48,
      h: 48,
    },
    w: 5,
    d: 4,
    objects: [
      {
        id: "bed",
        kind: "bed",
        aspectId: "sleep-environment",
        indicatorId: "mattress_satisfaction",
        label: "Mattress",
        lx: 1.9,
        ly: 1.7,
        sprite: {
          src: "/design-assets/habitat/bed.svg",
          w: 168,
          h: 135,
          anchorY: 0.78,
        },
      },
      {
        id: "window",
        kind: "window",
        aspectId: "sleep-environment",
        indicatorId: "window_at_night",
        label: "Window at night",
        lx: 4,
        ly: 0,
        mount: { side: "n", z: 8 },
        sprite: {
          src: "/design-assets/habitat/window-front.svg",
          w: 88,
          h: 88,
          anchorY: 1,
        },
      },
      {
        id: "ac",
        kind: "ac",
        aspectId: "sleep-environment",
        indicatorId: "temp_control",
        label: "Temperature control",
        lx: 1.3,
        ly: 0,
        absent: ["none"],
        mount: { side: "n", z: 50 },
        sprite: {
          src: "/design-assets/habitat/ac-front.svg",
          w: 70,
          h: 30,
          anchorY: 1,
        },
      },
      {
        id: "phone",
        kind: "device",
        aspectId: "sleep-environment",
        indicatorId: "phone_by_bed",
        label: "Phone by the bed",
        lx: 0.55,
        ly: 0.95,
        absent: [false],
        sprite: {
          src: "/design-assets/habitat/nightstand.svg",
          w: 80,
          h: 73,
          anchorY: 0.78,
        },
      },
      {
        id: "co2",
        kind: "sensor",
        aspectId: "sleep-environment",
        indicatorId: "co2_typical_ppm",
        label: "Bedroom CO₂",
        lx: 0.6,
        ly: 3.5,
        sprite: {
          src: "/design-assets/habitat/aranet.svg",
          w: 34,
          h: 27,
          anchorY: 0.82,
        },
      },
      {
        id: "tv",
        kind: "device",
        aspectId: "sleep-environment",
        indicatorId: "tv_in_bedroom",
        label: "Bedroom TV",
        lx: 0.5,
        ly: 2.3,
        absent: [false],
        sprite: {
          src: "/design-assets/habitat/tv.svg",
          w: 62,
          h: 73,
          anchorY: 0.84,
        },
      },
      {
        id: "humidifier",
        kind: "purifier",
        aspectId: "sleep-environment",
        indicatorId: "humidity_known",
        label: "Humidity",
        lx: 4.45,
        ly: 1,
        absent: ["unmanaged"],
        sprite: {
          src: "/design-assets/habitat/humidifier.svg",
          w: 38,
          h: 68,
          anchorY: 0.86,
        },
      },
    ],
  },
  {
    id: "air",
    title: "Air & water",
    presentation: "shelf",
    aspectIds: ["home-air", "water"],
    thumbnail: {
      src: "/design-assets/habitat/purifier.svg",
      w: 48,
      h: 48,
    },
    w: 4,
    d: 3.5,
    objects: [
      {
        id: "purifier",
        kind: "purifier",
        aspectId: "home-air",
        indicatorId: "air_purifier",
        label: "Air purifier",
        lx: 0.65,
        ly: 2.85,
        absent: ["none"],
        sprite: {
          src: "/design-assets/habitat/purifier.svg",
          w: 74,
          h: 74,
          anchorY: 0.84,
        },
      },
      {
        id: "stove",
        kind: "stove",
        aspectId: "home-air",
        indicatorId: "stove",
        label: "Stove",
        lx: 2.7,
        ly: 0.9,
        sprite: {
          src: "/design-assets/habitat/stove.svg",
          w: 84,
          h: 106,
          anchorY: 0.82,
        },
      },
      {
        id: "airmeter",
        kind: "sensor",
        aspectId: "home-air",
        indicatorId: "air_quality_meter",
        label: "Air-quality meter",
        lx: 3.25,
        ly: 2.75,
        absent: ["none"],
      },
    ],
  },
  {
    id: "light",
    title: "Light",
    presentation: "shelf",
    aspectIds: ["lighting"],
    thumbnail: {
      src: "/design-assets/habitat/lamp.svg",
      w: 48,
      h: 48,
    },
    w: 3.5,
    d: 3.5,
    objects: [
      {
        id: "lamp",
        kind: "lamp",
        aspectId: "lighting",
        indicatorId: "evening_light",
        label: "Evening light",
        lx: 1.05,
        ly: 2.65,
        sprite: {
          src: "/design-assets/habitat/lamp.svg",
          w: 52,
          h: 151,
          anchorY: 0.9,
        },
      },
      {
        id: "sun",
        kind: "sun",
        aspectId: "lighting",
        indicatorId: "morning_light_access",
        label: "Morning daylight",
        lx: 3.1,
        ly: 0.15,
        z: 70,
        decor: true,
      },
    ],
  },
  {
    id: "recovery",
    title: "Recovery & devices",
    presentation: "shelf",
    aspectIds: ["recovery-access", "health-devices"],
    thumbnail: {
      src: "/design-assets/habitat/plunge.svg",
      w: 48,
      h: 48,
    },
    w: 4.5,
    d: 4,
    objects: [
      {
        id: "sauna",
        kind: "sauna",
        aspectId: "recovery-access",
        indicatorId: "sauna_access",
        label: "Sauna",
        lx: 1.25,
        ly: 0.9,
        absent: ["none"],
        sprite: {
          src: "/design-assets/habitat/sauna-glass.svg",
          w: 150,
          h: 184,
          anchorY: 0.82,
        },
      },
      {
        id: "plunge",
        kind: "plunge",
        aspectId: "recovery-access",
        indicatorId: "cold_exposure",
        label: "Cold exposure",
        lx: 3.1,
        ly: 1.1,
        absent: ["none"],
        sprite: {
          src: "/design-assets/habitat/plunge.svg",
          w: 96,
          h: 96,
          anchorY: 0.82,
        },
      },
      {
        id: "redlight",
        kind: "redlight",
        aspectId: "recovery-access",
        indicatorId: "red_light",
        label: "Red light",
        lx: 3.5,
        ly: 3,
        absent: ["none"],
        sprite: {
          src: "/design-assets/habitat/redlight.svg",
          w: 50,
          h: 132,
          anchorY: 0.9,
        },
      },
      {
        id: "scale",
        kind: "device",
        aspectId: "health-devices",
        indicatorId: "scale",
        label: "Scale",
        lx: 1.1,
        ly: 3.25,
        absent: ["none"],
        sprite: {
          src: "/design-assets/habitat/scale.svg",
          w: 52,
          h: 29,
          anchorY: 0.72,
        },
      },
      {
        id: "bpcuff",
        kind: "device",
        aspectId: "health-devices",
        indicatorId: "bp_cuff",
        label: "Blood-pressure cuff",
        lx: 2.25,
        ly: 3.2,
        absent: [false],
        sprite: {
          src: "/design-assets/habitat/bpcuff.svg",
          w: 56,
          h: 43,
          anchorY: 0.8,
        },
      },
    ],
  },
  {
    id: "workspace",
    title: "Workspace",
    presentation: "vignette",
    aspectIds: ["workspace"],
    thumbnail: {
      src: "/design-assets/habitat/desk.svg",
      w: 48,
      h: 48,
    },
    w: 4,
    d: 4,
    objects: [
      {
        id: "desk",
        kind: "desk",
        aspectId: "workspace",
        indicatorId: "standing_desk",
        label: "Standing desk",
        lx: 2,
        ly: 1.2,
        sprite: {
          src: "/design-assets/habitat/desk.svg",
          w: 126,
          h: 133,
          anchorY: 0.8,
        },
      },
      {
        id: "chair",
        kind: "chair",
        aspectId: "workspace",
        indicatorId: "chair",
        label: "Chair",
        lx: 2,
        ly: 2.7,
        sprite: {
          src: "/design-assets/habitat/chair.svg",
          w: 84,
          h: 84,
          anchorY: 0.82,
        },
      },
    ],
  },
];

const catalogAspectById = new Map(
  HABITAT_CATALOG.aspects.map((aspect) => [aspect.id, aspect]),
);

function isKnownIndicatorValue(
  value: HabitatIndicatorValue | undefined,
): boolean {
  return (
    value !== undefined && value !== null && value !== HABITAT_DECLINED_VALUE
  );
}

function resolveState(value: HabitatIndicatorValue | undefined): HabitatState {
  if (value === undefined || value === null) {
    return "unknown";
  }
  return value === HABITAT_DECLINED_VALUE ? "skipped" : "known";
}

function valueText(value: HabitatIndicatorValue | undefined): string | null {
  if (
    value === undefined ||
    value === null ||
    value === HABITAT_DECLINED_VALUE
  ) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return typeof value === "string" ? value.replaceAll("_", " ") : String(value);
}

export function resolveHabitatScene(
  values: Record<string, Record<string, HabitatIndicatorValue>>,
): HabitatScene {
  let known = 0;
  let total = 0;

  const categories = CATEGORIES.map<ResolvedCategory>((category) => {
    const objects = category.objects.map<ResolvedObject>((object) => {
      if (object.decor) {
        return { ...object, state: "known", value: undefined, valueText: null };
      }

      const value = values[object.aspectId]?.[object.indicatorId];
      return {
        ...object,
        state: resolveState(value),
        value,
        valueText: valueText(value),
      };
    });

    const categoryKnown = category.aspectIds.reduce((sum, aspectId) => {
      const aspect = catalogAspectById.get(aspectId);
      const aspectValues = values[aspectId] ?? {};
      return (
        sum +
        (aspect?.indicators.filter((indicator) =>
          isKnownIndicatorValue(aspectValues[indicator.id]),
        ).length ?? 0)
      );
    }, 0);
    const categoryTotal = category.aspectIds.reduce(
      (sum, aspectId) =>
        sum + (catalogAspectById.get(aspectId)?.indicators.length ?? 0),
      0,
    );

    known += categoryKnown;
    total += categoryTotal;

    return { ...category, objects, known: categoryKnown, total: categoryTotal };
  });

  return { categories, known, total };
}

export function isInstalled(object: ResolvedObject): boolean {
  if (object.decor) {
    return true;
  }
  if (object.state !== "known") {
    return false;
  }
  return !object.absent?.includes(object.value ?? null);
}

export const MOCK_HABITAT_VALUES: Record<
  string,
  Record<string, HabitatIndicatorValue>
> = {
  "home-location": {
    location: "Lisbon",
    area_type: "urban_center",
    travel_pattern: "mostly_home",
  },
  "sleep-environment": {
    night_temp_c: 19,
    temp_control: "ac",
    window_at_night: "open",
    co2_meter: "aranet",
    co2_typical_ppm: 1150,
    darkness: "blackout",
    night_noise: "quiet",
    noise_countermeasures: HABITAT_DECLINED_VALUE,
    humidity_known: "humidifier",
    mattress_satisfaction: "good",
    bedding_overheating: "never",
    co_sleepers: "partner",
    phone_by_bed: true,
    tv_in_bedroom: true,
  },
  "home-air": {
    ventilation: "windows_only",
    damp_or_mold: "none",
    air_purifier: "hepa",
    stove: "induction",
    smoke_sources: "none",
  },
  lighting: {
    evening_light: "warm_dim",
    morning_light_access: "balcony_or_garden",
    daytime_light: "by_window",
    light_therapy_lamp: false,
  },
  water: {
    drinking_water: "filtered",
  },
  "recovery-access": {
    sauna_access: "home",
    sauna_type: "dry",
    cold_exposure: "plunge",
    red_light: "panel_owned",
    red_light_model: HABITAT_DECLINED_VALUE,
  },
  "health-devices": {
    scale: "smart",
    bp_cuff: true,
    thermometer: true,
    pulse_oximeter: false,
  },
  "allergens-home": {
    pets_at_home: "cat",
    carpets: true,
  },
  workspace: {
    work_mode: "remote",
    desk_hours: 8,
    standing_desk: "adjustable_used",
    screen_setup: "laptop_only",
    screen_at_eye_level: true,
    chair: "ergonomic",
    external_keyboard: true,
    wrist_complaints: false,
    breaks: "irregular",
  },
  "exercise-access": {
    gym_access: "home_gym",
  },
};
