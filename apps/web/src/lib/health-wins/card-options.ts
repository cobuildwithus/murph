import { createHash, randomUUID } from "node:crypto";
import { createHostedOpaqueIdentifier } from "../hosted-onboarding/contact-privacy";
import { invalidGameRequest } from "../game/http/errors";
import type { CardSpec } from "./engine";
import { formatWinMonth } from "./engine/shared";

type Option = "original" | "hide_numbers" | "hours";
const labels: Record<Option, string> = {
  original: "Original card",
  hide_numbers: "Hide my numbers",
  hours: "Show hours",
};

const hiddenTitles = {
  Sleep: "Sleep milestone", Heart: "Heart health milestone", Fitness: "Fitness milestone",
  Challenges: "Challenge milestone", Experiments: "Finished an experiment", Labs: "Lab milestone",
} satisfies Record<CardSpec["filter"], string>;

function hidden(card: CardSpec, title = hiddenTitles[card.filter]) {
  // Only closed labels survive. Even the engine ID, source notes and free-text experiment
  // titles can encode readings, dates, intervention names or adherence numbers.
  return {
    id: card.id, kind: card.kind, filter: card.filter, theme: card.theme,
    title: { number: "", measure: title }, subtitle: "Shared without numbers.",
    source_note: "", chart: { type: "hidden" as const }, share: { caption_tips: [] },
  };
}

const hundredthsOfHour = (minutes: number) => Math.round(minutes * 100 / 60);
const hours = (minutes: number) => hundredthsOfHour(minutes) / 100;

function hoursCard(card: CardSpec): CardSpec | null {
  if (card.kind === "trend_change" && card.chart.unit === "min") {
    const chart = card.chart;
    const latest = chart.series.at(-1);
    if (!latest) return null;
    const displayedDelta = hundredthsOfHour(latest.value) - hundredthsOfHour(chart.baseline);
    return {
      ...card, title: { ...card.title, number: `${displayedDelta < 0 ? "−" : "+"}${Math.abs(displayedDelta) / 100} hr` },
      chart: { ...chart, unit: "hr", baseline: chart.baseline / 60, delta: chart.delta / 60,
        series: chart.series.map(point => ({ ...point, value: point.value / 60 })),
        pills: [`Usual ${hours(chart.baseline)} hr`, `${formatWinMonth(latest.month, "short")} ${hours(latest.value)} hr`] },
    };
  }
  if (card.kind === "best_month" && card.chart.unit === "min") {
    const chart = card.chart, highlighted = chart.series.find(point => point.month === chart.highlight);
    if (!highlighted) return null;
    return { ...card, title: { ...card.title, number: `${hours(highlighted.value)} hr` },
      chart: { ...chart, unit: "hr", series: chart.series.map(point => ({ ...point, value: point.value / 60 })) } };
  }
  if (card.kind === "personal_record" && card.chart.unit === "min") {
    const chart = card.chart;
    return { ...card, title: { ...card.title, number: `${hours(chart.highlight.value)} hr` },
      chart: { ...chart, unit: "hr", highlight: { ...chart.highlight, value: chart.highlight.value / 60 },
        series: chart.series.map(point => ({ ...point, value: point.value / 60 })) } };
  }
  return null;
}

type DistanceCard = Extract<CardSpec, { kind: "cumulative" }>;
type ShareableCard = Exclude<CardSpec, DistanceCard> | (DistanceCard & { chart: { art?: { url: string } } });

export interface FrozenHealthCard {
  id: string;
  specRevision: string;
  spec: ShareableCard | ReturnType<typeof hidden>;
}

interface Variant {
  option: Option;
  specRevision: string;
  spec: FrozenHealthCard["spec"];
}

export interface CachedHealthCandidate {
  id: string;
  variants: Variant[];
}

/** Store each derived option in the authenticated set. Later deploys can replay exactly what the composer displayed. */
export function prepareHealthCandidates(memberId: string, cards: readonly CardSpec[], distanceArtUrl: string | null = null): CachedHealthCandidate[] {
  return cards.map(engineCard => {
    const id = createHostedOpaqueIdentifier("health-win-card", JSON.stringify([memberId, engineCard.id]))!;
    const card = engineCard.kind === "cumulative" && distanceArtUrl
      ? { ...engineCard, id, chart: { ...engineCard.chart, art: { url: distanceArtUrl } } }
      : { ...engineCard, id };
    const variants: Variant[] = [{ option: "original", specRevision: randomUUID(), spec: card }];
    const converted = hoursCard(card);
    if (converted) variants.push({ option: "hours", specRevision: randomUUID(), spec: converted });
    variants.push({ option: "hide_numbers", specRevision: randomUUID(), spec: hidden(card) });
    return { id, variants };
  });
}

/** Hash the spec as it will be sealed. Preserve array order and sort JSON object keys at every depth. */
function recordedVariant(option: Option, spec: FrozenHealthCard["spec"]): Variant {
  const canonical = JSON.stringify(spec, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
  return { option, spec, specRevision: createHash("sha256").update(canonical).digest("hex") };
}

export function prepareRecordedCandidate(card: CardSpec, hiddenTitle: string): CachedHealthCandidate {
  return { id: card.id, variants: [
    recordedVariant("original", card),
    recordedVariant("hide_numbers", hidden(card, hiddenTitle)),
  ] };
}

export interface HealthCardSelection { candidateId: string; option: string; specRevision?: string }

function chooseVariant(candidate: CachedHealthCandidate, option: string) {
  const variant = candidate.variants.find(item => item.option === option);
  if (!variant) throw invalidGameRequest("Choose one of this card's options.");
  return variant;
}

export function previewHealthCandidate(candidate: CachedHealthCandidate, option = "original") {
  const { spec, specRevision } = chooseVariant(candidate, option);
  return { ...spec, specRevision,
    change_options: candidate.variants.map(item => ({ id: item.option, label: labels[item.option] })),
    caption_tips: spec.share.caption_tips.length ? spec.share.caption_tips : ["What helped you get here?", "How did it feel?"] };
}

/** Recorded previews have no stored set or change endpoint, so send the exact alternate display here. */
export function previewRecordedCandidate(candidate: CachedHealthCandidate) {
  return { ...previewHealthCandidate(candidate), candidateId: candidate.id,
    change_options: candidate.variants.map(({ option, specRevision, spec }) => ({
      id: option, label: labels[option], specRevision, ...(option === "original" ? {} : { spec }),
    })),
  };
}

export function findCandidate(candidates: CachedHealthCandidate[], candidateId: string) {
  const candidate = candidates.find(item => item.id === candidateId);
  if (!candidate) throw invalidGameRequest("Choose a card from this set.");
  return candidate;
}

export function freezeHealthSelections(candidates: CachedHealthCandidate[], selections: readonly HealthCardSelection[]): FrozenHealthCard[] {
  if (selections.length > 12 || new Set(selections.map(item => item.candidateId)).size !== selections.length) {
    throw invalidGameRequest("Choose up to twelve different cards.");
  }
  return selections.map(({ candidateId, option }) => {
    const { spec, specRevision } = chooseVariant(findCandidate(candidates, candidateId), option);
    return { id: candidateId, specRevision, spec };
  });
}
