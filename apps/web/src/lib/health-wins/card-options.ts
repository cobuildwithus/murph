import { randomUUID } from "node:crypto";
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

function hidden(card: CardSpec) {
  // Only closed labels survive. Even the engine ID, source notes and free-text experiment
  // titles can encode readings, dates, intervention names or adherence numbers.
  return {
    id: card.id, kind: card.kind, filter: card.filter, theme: card.theme,
    title: { number: "", measure: hiddenTitles[card.filter] }, subtitle: "Shared without numbers.",
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

export interface HealthCardSelection { candidateId: string; option: string }

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
