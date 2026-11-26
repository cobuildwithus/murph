import { createHash, randomUUID } from "node:crypto";
import { createHostedOpaqueIdentifier } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { invalidGameRequest } from "../game/http/errors";
import type { CardSpec, HealthWinAchievement } from "./engine";
import { formatNumber, formatWinMonth, milesFromKm } from "./engine/shared";

type Option = "original" | "hide_numbers" | "hide_map" | "hours";
const labels: Record<Option, string> = {
  original: "Original card",
  hide_numbers: "Hide my numbers",
  hide_map: "Hide the map",
  hours: "Show hours",
};

const hiddenTitles = {
  Sleep: "Sleep milestone", Heart: "Heart health milestone", Fitness: "Fitness milestone",
  Challenges: "Challenge milestone", Experiments: "Finished an experiment", Labs: "Lab milestone", Diet: "Diet milestone",
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

type TrendCard = Extract<CardSpec, { kind: "trend_change" }>;

function convertTrend(card: TrendCard, unit: "hr" | "mi", convert: (value: number) => number): TrendCard | null {
  const chart = card.chart;
  const series = chart.series.map(point => ({ ...point, value: convert(point.value) }));
  const latest = series.at(-1);
  if (!latest) return null;
  const baseline = convert(chart.baseline);
  const usualTenths = Math.round(baseline * 10), currentTenths = Math.round(latest.value * 10);
  const deltaTenths = currentTenths - usualTenths;
  return {
    ...card, title: { ...card.title, number: `${deltaTenths < 0 ? "−" : "+"}${formatNumber(Math.abs(deltaTenths) / 10)} ${unit}` },
    chart: { ...chart, unit, baseline, delta: convert(chart.delta), series,
      pills: [`Usual ${formatNumber(usualTenths / 10)} ${unit}`, `${formatWinMonth(latest.month, "short")} ${formatNumber(currentTenths / 10)} ${unit}`] },
  };
}

function hoursCard(card: CardSpec): CardSpec | null {
  if (card.kind === "trend_change" && card.chart.unit === "min") {
    return convertTrend(card, "hr", minutes => minutes / 60);
  }
  if (card.kind === "best_month" && card.chart.unit === "min") {
    const chart = card.chart, highlighted = chart.series.find(point => point.month === chart.highlight);
    if (!highlighted) return null;
    return { ...card, title: { ...card.title, number: `${formatNumber(highlighted.value / 60)} hr` },
      chart: { ...chart, unit: "hr", series: chart.series.map(point => ({ ...point, value: point.value / 60 })) } };
  }
  if (card.kind === "personal_record" && card.chart.unit === "min") {
    const chart = card.chart;
    return { ...card, title: { ...card.title, number: `${formatNumber(chart.highlight.value / 60)} hr` },
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
  option: Exclude<Option, "hide_map">;
  specRevision: string;
  spec: FrozenHealthCard["spec"];
}

interface MapRemoval {
  option: "hide_map";
  specRevision: string;
  spec: null;
}

interface CandidateDisplay {
  id: string;
  variants: [Variant, ...(Variant | MapRemoval)[]];
}

export interface CachedHealthCandidate extends CandidateDisplay {
  miles?: CandidateDisplay;
  /** Private detector evidence on the sealed wrapper, independent of its units or variants. */
  achievement?: HealthWinAchievement;
  sourceComplete?: boolean;
}

/** Older sealed sets have only the km display. Derive their alternate ID and revisions consistently on read. */
export function withDistanceTrendUnits(candidate: CachedHealthCandidate): CachedHealthCandidate {
  const original = candidate.variants[0].spec;
  if (candidate.miles || original.kind !== "trend_change" || original.chart.type !== "trend" || original.chart.unit !== "km") return candidate;
  const id = createHash("sha256").update(`miles:${candidate.id}`).digest("base64url");
  const card = convertTrend({ ...original, id, kind: original.kind, chart: original.chart }, "mi", milesFromKm);
  if (!card) return candidate;
  const safe = hidden(card);
  return { ...candidate, miles: { id, variants: [
    { option: "original", spec: card, specRevision: specDigest(card) },
    { option: "hide_numbers", spec: safe, specRevision: specDigest(safe) },
  ] } };
}

/** Store each derived option in the authenticated set. Later deploys can replay exactly what the composer displayed. */
export function prepareHealthCandidates(
  memberId: string, cards: readonly CardSpec[], distanceArtUrl: string | null = null,
  detection?: { achievements: ReadonlyMap<string, HealthWinAchievement>; complete: boolean },
): CachedHealthCandidate[] {
  return cards.map(engineCard => {
    const id = createHostedOpaqueIdentifier("health-win-card", JSON.stringify([memberId, engineCard.id]))!;
    const card = engineCard.kind === "cumulative" && distanceArtUrl
      ? { ...engineCard, id, chart: { ...engineCard.chart, art: { url: distanceArtUrl } } }
      : { ...engineCard, id };
    const variants: CachedHealthCandidate["variants"] = [{ option: "original", specRevision: randomUUID(), spec: card }];
    const converted = hoursCard(card);
    if (converted) variants.push({ option: "hours", specRevision: randomUUID(), spec: converted });
    variants.push({ option: "hide_numbers", specRevision: randomUUID(), spec: hidden(card) });
    const achievement = detection?.achievements.get(engineCard.id);
    return withDistanceTrendUnits({ id, variants, ...(achievement && { achievement, sourceComplete: detection?.complete }) });
  });
}

/** Hash the spec as it will be sealed. Preserve array order and sort JSON object keys at every depth. */
export function specDigest(spec: FrozenHealthCard["spec"] | null): string {
  const canonical = JSON.stringify(spec, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function prepareRecordedCandidate(card: CardSpec, hiddenTitle: string): CachedHealthCandidate {
  const safe = hidden(card, hiddenTitle);
  const withoutNumbers = card.kind === "activity_route"
    ? { ...safe, kind: card.kind, chart: {
      type: card.chart.type, paths: card.chart.paths, frame: card.chart.frame, art: card.chart.art,
    } }
    : safe;
  const variants: CachedHealthCandidate["variants"] = [
    { option: "original", spec: card, specRevision: specDigest(card) },
    { option: "hide_numbers", spec: withoutNumbers, specRevision: specDigest(withoutNumbers) },
  ];
  if (card.kind === "activity_route") variants.push({ option: "hide_map", spec: null, specRevision: specDigest(null) });
  return { id: card.id, variants };
}

export interface HealthCardSelection { candidateId: string; option: string; specRevision?: string }

function chooseVariant(candidate: CachedHealthCandidate, option: string) {
  const variant = candidate.variants.find(item => item.option === option);
  if (!variant) throw invalidGameRequest("Choose one of this card's options.");
  return variant;
}

export function previewHealthCandidate(candidate: CachedHealthCandidate, option = "original") {
  const { spec, specRevision } = chooseVariant(candidate, option);
  if (spec === null) throw invalidGameRequest("This option removes the card.");
  return { ...spec, specRevision,
    change_options: candidate.variants.map(item => ({ id: item.option, label: labels[item.option] })),
    caption_tips: spec.share.caption_tips.length ? spec.share.caption_tips : ["What helped you get here?", "How did it feel?"] };
}

/** A preview can contain caller-chosen paths. Only a published card discloses the shared art handle. */
function recordedPreviewDisplay<T extends FrozenHealthCard["spec"]>(spec: T) {
  if (spec.chart.type !== "route_map") return spec;
  const { type, paths, frame, chips, stats } = spec.chart;
  return { ...spec, chart: { type, paths, frame, ...(chips && { chips }), ...(stats && { stats }) } };
}

/** Recorded previews have no stored set or change endpoint, so include each alternate display. */
export function previewRecordedCandidate(candidate: CachedHealthCandidate) {
  return { ...recordedPreviewDisplay(previewHealthCandidate(candidate)), candidateId: candidate.id,
    change_options: candidate.variants.map(({ option, specRevision, spec }) => ({
      id: option, label: labels[option], specRevision, ...(option === "original" ? {} : { spec: spec && recordedPreviewDisplay(spec) }),
    })),
  };
}

export function findCandidate(candidates: CachedHealthCandidate[], candidateId: string) {
  const candidate = candidates.find(item => item.id === candidateId || item.miles?.id === candidateId);
  if (!candidate) throw invalidGameRequest("Choose a card from this set.");
  return { claimId: candidate.id, display: candidate.miles?.id === candidateId ? candidate.miles : candidate };
}

export function freezeHealthSelections(candidates: CachedHealthCandidate[], selections: readonly HealthCardSelection[]): FrozenHealthCard[] {
  if (selections.length > 12) throw invalidGameRequest("Choose up to twelve different cards.");
  const seen = new Set<string>();
  return selections.flatMap(({ candidateId, option }) => {
    const { claimId, display } = findCandidate(candidates, candidateId);
    if (seen.has(claimId)) throw invalidGameRequest("Choose up to twelve different cards.");
    seen.add(claimId);
    const { spec, specRevision } = chooseVariant(display, option);
    return spec === null ? [] : [{ id: candidateId, specRevision, spec }];
  });
}

export function resolveRecordedSelection(candidates: readonly CachedHealthCandidate[], pick: HealthCardSelection): FrozenHealthCard | null {
  const variant = candidates.find(card => card.id === pick.candidateId)?.variants.find(item => item.option === pick.option);
  if (!variant || pick.specRevision !== variant.specRevision) throw hostedOnboardingError({
    code: "HEALTH_ACTIVITY_CARD_CHANGED", httpStatus: 409, message: "Preview the activity again before posting.",
  });
  return variant.spec === null ? null : { id: pick.candidateId, specRevision: variant.specRevision, spec: variant.spec };
}
