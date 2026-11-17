import landmarks from "./bank/landmarks.json";
import times from "./bank/time.json";

export interface BankEntry {
  id: string;
  name: string;
  kind: "height" | "time" | "route";
  at: number;
  short: string;
  tagline: string;
  blurbMetric: string | null;
  timeText: string | null;
  blurb: string;
  where: string | null;
  source: string;
  ladder: boolean;
  use: string[];
}

export const BANK: readonly BankEntry[] = [
  ...landmarks.map(entry => ({
    id: entry.id, name: entry.name, kind: entry.kind === "long" ? "route" as const : "height" as const,
    at: entry.kind === "long" ? entry.distance_km! * 1000 : entry.height_ft!,
    short: "short" in entry ? entry.short! : entry.name, tagline: entry.tagline,
    blurbMetric: "blurb_metric" in entry ? entry.blurb_metric! : null, timeText: null,
    blurb: entry.blurb, where: entry.where, source: entry.source_url, ladder: entry.ladder, use: [],
  })),
  ...times.map(entry => ({
    id: entry.id, name: entry.name, kind: "time" as const, at: entry.seconds, timeText: entry.display,
    short: "short" in entry ? entry.short! : entry.name, tagline: entry.tagline,
    blurbMetric: "blurb_metric" in entry ? entry.blurb_metric! : null,
    blurb: entry.what, where: null, source: entry.source_url, ladder: entry.ladder, use: entry.ladderUse,
  })),
];

export function ladder(kind: BankEntry["kind"], use: string): BankEntry[] {
  return BANK.filter(entry => entry.kind === kind && entry.ladder && (kind !== "time" || entry.use.includes(use)))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function search(q: string): BankEntry[] {
  const query = q.trim().toLocaleLowerCase("en-US");
  return BANK.filter(entry => entry.name.toLocaleLowerCase("en-US").includes(query)
    || entry.id.includes(query)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** Checked lookup facts. Heights are feet; durations are seconds. */
export type FoundEntry = {
  id: string;
  kind: "height" | "time";
  name: string;
  short: string;
  tagline: string;
  at: number;
  where: string | null;
  blurb: string;
  sourceUrl: string;
};

/** The threshold is frozen in measure units when earned. */
export type RungDefinition = {
  at: number;
  target: { kind: "height" | "time"; id: string } | { found: FoundEntry };
};

export function rungEntry(rung: RungDefinition): BankEntry | FoundEntry {
  const target = rung.target;
  return "found" in target ? target.found : BANK.find(entry => entry.kind === target.kind && entry.id === target.id)!;
}
