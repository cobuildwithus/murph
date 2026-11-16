import landmarks from "./bank/landmarks.json";
import times from "./bank/time.json";
import { formatAmount, formatNumber } from "./format";

export interface BankEntry {
  id: string;
  name: string;
  kind: "height" | "time" | "route";
  at: number;
  atText: string;
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
    atText: entry.kind === "long" ? formatAmount(entry.distance_km! * 1000, "meters").text : `${formatNumber(entry.height_ft!, "compact")} ft`,
    blurb: entry.blurb, where: entry.where, source: entry.source_url, ladder: entry.ladder, use: [],
  })),
  ...times.map(entry => ({
    id: entry.id, name: entry.name, kind: "time" as const, at: entry.seconds, atText: entry.display,
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
