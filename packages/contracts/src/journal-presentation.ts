/** Product artwork offered when authoring Journal notes. */
export const JOURNAL_ICON_ASSETS = {
  "note": "/design-assets/patterns/tag.svg",
  "bath": "/design-assets/journal/bath.svg",
  "shower": "/design-assets/journal/shower.svg",
  "headache": "/design-assets/journal/headache.svg",
  "fatigue": "/design-assets/journal/fatigue.svg",
  "muscle-soreness": "/design-assets/journal/muscle-soreness.svg",
  "abdominal-pain": "/design-assets/journal/abdominal-pain.svg",
  "nausea": "/design-assets/journal/nausea.svg",
  "congestion": "/design-assets/journal/congestion.svg",
  "activity": "/design-assets/patterns/general-activity.svg",
  "walking": "/design-assets/patterns/walking.svg",
  "running": "/design-assets/patterns/running.svg",
  "cycling": "/design-assets/patterns/cycling.svg",
  "swimming": "/design-assets/patterns/swimming.svg",
  "rowing": "/design-assets/patterns/rowing.svg",
  "strength": "/design-assets/patterns/strength.svg",
  "mobility": "/design-assets/patterns/mobility.svg",
  "mind-body": "/design-assets/patterns/mind-body.svg",
  "racket-sports": "/design-assets/patterns/racket-sports.svg",
  "ball-sports": "/design-assets/patterns/ball-sports.svg",
  "combat-sports": "/design-assets/patterns/combat-sports.svg",
  "winter-sports": "/design-assets/patterns/winter-sports.svg",
  "water-sports": "/design-assets/patterns/water-sports.svg",
  "outdoor-sports": "/design-assets/patterns/outdoor-sports.svg",
  "golf": "/design-assets/patterns/golf.svg",
  "dance": "/design-assets/patterns/performance.svg",
  "housework": "/design-assets/patterns/housework.svg",
  "yardwork": "/design-assets/patterns/work.svg",
  "parenting": "/design-assets/patterns/parenting.svg",
  "dog-walking": "/design-assets/patterns/dog-walking.svg",
  "travel": "/design-assets/patterns/travel.svg",
  "commute": "/design-assets/patterns/commute.svg",
  "meal": "/design-assets/patterns/meal.svg",
  "medication": "/design-assets/patterns/medication.svg",
  "alcohol": "/design-assets/patterns/alcohol.svg",
  "recovery": "/design-assets/patterns/recovery.svg",
  "wellness": "/design-assets/patterns/wellness.svg",
  "sleep": "/design-assets/habitat/bed.svg",
  "caffeine": "/design-assets/habitat/coffee-break.svg",
  "hydration": "/design-assets/habitat/water-pitcher.svg",
  "sauna": "/design-assets/habitat/sauna.svg",
  "cold-plunge": "/design-assets/habitat/plunge.svg",
  "sunlight": "/design-assets/habitat/morning-sun.svg",
  "red-light": "/design-assets/habitat/redlight.svg",
  "smoking": "/design-assets/habitat/smoke.svg",
  "temperature": "/design-assets/habitat/thermometer.svg",
  "work": "/design-assets/habitat/briefcase.svg",
  "screens": "/design-assets/habitat/monitor.svg",
  "noise": "/design-assets/habitat/night-noise.svg"
} as const;

export type JournalIcon = keyof typeof JOURNAL_ICON_ASSETS;
// The literal catalog owns every key and contains the default note entry.
export const JOURNAL_ICON_IDS = Object.keys(JOURNAL_ICON_ASSETS) as [JournalIcon, ...JournalIcon[]];

export function parseJournalIcon(value: unknown): JournalIcon | null {
  return typeof value === "string" && Object.hasOwn(JOURNAL_ICON_ASSETS, value)
    ? value as JournalIcon
    : null;
}

export const JOURNAL_TIMINGS = [
  "timed", "all_day", "morning", "afternoon", "evening", "night", "unknown",
] as const;
export type JournalTiming = typeof JOURNAL_TIMINGS[number];

export function parseJournalTiming(value: unknown): JournalTiming | null {
  return JOURNAL_TIMINGS.find((timing) => timing === value) ?? null;
}

export function journalTimingTag(timing: JournalTiming): string {
  return `timing-${timing.replaceAll("_", "-")}`;
}

export function readJournalTiming(tags: readonly string[]): JournalTiming | null {
  const values = JOURNAL_TIMINGS.filter((timing) => tags.includes(journalTimingTag(timing)));
  // Conflicting period evidence must never produce an invented clock time.
  return values.length > 1 ? "unknown" : values[0] ?? null;
}

export function readJournalIcon(tags: readonly string[]): JournalIcon | null {
  const values = [...new Set(tags.flatMap((tag) => {
    const icon = tag.startsWith("journal-icon-") ? parseJournalIcon(tag.slice(13)) : null;
    return icon ? [icon] : [];
  }))];
  return values.length === 1 ? values[0] ?? null : null;
}
