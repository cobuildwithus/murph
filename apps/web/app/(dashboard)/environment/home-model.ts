// Catalog-backed model for the environment page: five categories, each
// aggregating catalog aspects, with illustration sprites per indicator.

import {
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
  type HabitatIndicatorValue,
} from "@murphai/contracts";

export type HabitatValues = Record<
  string,
  Record<string, HabitatIndicatorValue>
>;

export type HabitatIndicatorNotes = Record<string, Record<string, string>>;

export interface ObjectSprite {
  src: string;
  w: number;
  h: number;
  anchorY?: number;
}

interface ObjectDef {
  id: string;
  aspectId: string;
  indicatorId: string;
  label: string;
  decor?: boolean;
  sprite?: ObjectSprite;
}

interface CategoryDef {
  id: string;
  title: string;
  aspectIds: readonly string[];
  thumbnail: ObjectSprite;
  objects: readonly ObjectDef[];
}

export interface ResolvedCategory extends CategoryDef {
  known: number;
  total: number;
}

export interface HabitatScene {
  categories: ResolvedCategory[];
  known: number;
  total: number;
}

const habitatSprite = (
  file: string,
  w: number,
  h: number,
  anchorY?: number,
): ObjectSprite => ({
  src: `/design-assets/habitat/${file}.svg`,
  w,
  h,
  ...(anchorY === undefined ? {} : { anchorY }),
});

const CATEGORIES: readonly CategoryDef[] = [
  {
    id: "sleep",
    title: "Sleep",
    aspectIds: ["sleep-environment"],
    thumbnail: habitatSprite("bed", 48, 48),
    objects: [
      {
        id: "bed",
        aspectId: "sleep-environment",
        indicatorId: "mattress_satisfaction",
        label: "Mattress",
        sprite: habitatSprite("bed", 168, 135, 0.78),
      },
      {
        id: "window",
        aspectId: "sleep-environment",
        indicatorId: "window_at_night",
        label: "Window at night",
        sprite: habitatSprite("window-front", 88, 88, 1),
      },
      {
        id: "ac",
        aspectId: "sleep-environment",
        indicatorId: "temp_control",
        label: "Temperature control",
        sprite: habitatSprite("ac-front", 70, 30, 1),
      },
      {
        id: "phone",
        aspectId: "sleep-environment",
        indicatorId: "phone_by_bed",
        label: "Phone by the bed",
        sprite: habitatSprite("nightstand", 80, 73, 0.78),
      },
      {
        id: "co2",
        aspectId: "sleep-environment",
        indicatorId: "co2_typical_ppm",
        label: "Bedroom CO₂",
        sprite: habitatSprite("aranet", 34, 27, 0.82),
      },
      {
        id: "tv",
        aspectId: "sleep-environment",
        indicatorId: "tv_in_bedroom",
        label: "Bedroom TV",
        sprite: habitatSprite("tv", 62, 73, 0.84),
      },
      {
        id: "humidifier",
        aspectId: "sleep-environment",
        indicatorId: "humidity_known",
        label: "Humidity",
        sprite: habitatSprite("humidifier", 38, 68, 0.86),
      },
    ],
  },
  {
    id: "air",
    title: "Air & water",
    aspectIds: ["home-air", "water"],
    thumbnail: habitatSprite("purifier", 48, 48),
    objects: [
      {
        id: "purifier",
        aspectId: "home-air",
        indicatorId: "air_purifier",
        label: "Air purifier",
        sprite: habitatSprite("purifier", 74, 74, 0.84),
      },
      {
        id: "stove",
        aspectId: "home-air",
        indicatorId: "stove",
        label: "Stove",
        sprite: habitatSprite("stove", 84, 106, 0.82),
      },
      {
        id: "airmeter",
        aspectId: "home-air",
        indicatorId: "air_quality_meter",
        label: "Air-quality meter",
      },
    ],
  },
  {
    id: "light",
    title: "Light",
    aspectIds: ["lighting"],
    thumbnail: habitatSprite("lamp", 48, 48),
    objects: [
      {
        id: "lamp",
        aspectId: "lighting",
        indicatorId: "evening_light",
        label: "Evening light",
        sprite: habitatSprite("lamp", 52, 151, 0.9),
      },
      {
        id: "sun",
        aspectId: "lighting",
        indicatorId: "morning_light_access",
        label: "Morning daylight",
        decor: true,
      },
    ],
  },
  {
    id: "recovery",
    title: "Recovery & devices",
    aspectIds: ["recovery-access", "health-devices"],
    thumbnail: habitatSprite("plunge", 48, 48),
    objects: [
      {
        id: "sauna",
        aspectId: "recovery-access",
        indicatorId: "sauna_access",
        label: "Sauna",
        sprite: habitatSprite("sauna-glass", 150, 184, 0.82),
      },
      {
        id: "plunge",
        aspectId: "recovery-access",
        indicatorId: "cold_exposure",
        label: "Cold exposure",
        sprite: habitatSprite("plunge", 96, 96, 0.82),
      },
      {
        id: "redlight",
        aspectId: "recovery-access",
        indicatorId: "red_light",
        label: "Red light",
        sprite: habitatSprite("redlight", 50, 132, 0.9),
      },
      {
        id: "scale",
        aspectId: "health-devices",
        indicatorId: "scale",
        label: "Scale",
        sprite: habitatSprite("scale", 52, 29, 0.72),
      },
      {
        id: "bpcuff",
        aspectId: "health-devices",
        indicatorId: "bp_cuff",
        label: "Blood-pressure cuff",
        sprite: habitatSprite("bpcuff", 56, 43, 0.8),
      },
    ],
  },
  {
    id: "workspace",
    title: "Workspace",
    aspectIds: ["workspace"],
    thumbnail: habitatSprite("desk", 48, 48),
    objects: [
      {
        id: "desk",
        aspectId: "workspace",
        indicatorId: "standing_desk",
        label: "Standing desk",
        sprite: habitatSprite("desk", 126, 133, 0.8),
      },
      {
        id: "chair",
        aspectId: "workspace",
        indicatorId: "chair",
        label: "Chair",
        sprite: habitatSprite("chair", 84, 84, 0.82),
      },
    ],
  },
];

const indicatorSprite = (file: string): ObjectSprite => ({
  src: `/design-assets/habitat/${file}.svg`,
  w: 150,
  h: 150,
});

export const INDICATOR_SPRITES: Readonly<Record<string, ObjectSprite>> = {
  night_temp_c: indicatorSprite("night-temp"),
  darkness: indicatorSprite("curtains"),
  night_noise: indicatorSprite("night-noise"),
  noise_countermeasures: indicatorSprite("earplugs"),
  bedding_overheating: indicatorSprite("duvet"),
  co_sleepers: indicatorSprite("pillows"),
  ventilation: indicatorSprite("vent"),
  damp_or_mold: indicatorSprite("mold"),
  air_quality_meter: indicatorSprite("airmeter"),
  smoke_sources: indicatorSprite("smoke"),
  radon_tested: indicatorSprite("radon"),
  morning_light_access: indicatorSprite("morning-sun"),
  daytime_light: indicatorSprite("day-window"),
  high_cri_bulbs: indicatorSprite("bulb"),
  light_therapy_lamp: indicatorSprite("sad-lamp"),
  drinking_water: indicatorSprite("water-pitcher"),
  thermometer: indicatorSprite("thermometer"),
  pulse_oximeter: indicatorSprite("oximeter"),
  work_mode: indicatorSprite("briefcase"),
  desk_hours: indicatorSprite("wall-clock"),
  screen_setup: indicatorSprite("monitor"),
  screen_at_eye_level: indicatorSprite("monitor-riser"),
  external_keyboard: indicatorSprite("keyboard"),
  wrist_complaints: indicatorSprite("wrist"),
  breaks: indicatorSprite("coffee-break"),
};

export const CATEGORY_THUMBNAILS: Readonly<Record<string, ObjectSprite>> =
  Object.fromEntries(
    CATEGORIES.map((category) => [category.id, category.thumbnail]),
  );

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

export function resolveHabitatScene(values: HabitatValues): HabitatScene {
  let known = 0;
  let total = 0;

  const categories = CATEGORIES.map<ResolvedCategory>((category) => {
    const categoryKnown = category.aspectIds.reduce((sum, aspectId) => {
      const aspect = catalogAspectById.get(aspectId);
      const aspectValues = values[aspectId] ?? {};
      return (
        sum +
        (aspect?.indicators.filter(
          (indicator) =>
            indicator.informational !== true &&
            isKnownIndicatorValue(aspectValues[indicator.id]),
        ).length ?? 0)
      );
    }, 0);
    const categoryTotal = category.aspectIds.reduce((sum, aspectId) => {
      const aspectValues = values[aspectId] ?? {};
      return (
        sum +
        (catalogAspectById
          .get(aspectId)
          ?.indicators.filter(
            (indicator) =>
              indicator.informational !== true &&
              aspectValues[indicator.id] !== HABITAT_DECLINED_VALUE,
          ).length ?? 0)
      );
    }, 0);

    known += categoryKnown;
    total += categoryTotal;

    return { ...category, known: categoryKnown, total: categoryTotal };
  });

  return { categories, known, total };
}

// Coverage uses the same gradeable catalog indicators as the audit.
// Home context is still useful for the hero and live conditions, but it does
// not make the health assessment look more complete.
export function resolveEnvironmentCoverage(scene: HabitatScene): {
  known: number;
  total: number;
  coverage: number;
} {
  const { known, total } = scene;
  return {
    known,
    total,
    coverage: total === 0 ? 0 : Math.round((100 * known) / total),
  };
}
