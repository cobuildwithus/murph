import { createHash, randomUUID } from "node:crypto";
import type { ClientUnits } from "../companion/client-info";
import { createHostedOpaqueIdentifier } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { invalidGameRequest } from "../game/http/errors";
import type { CardSpec, HealthWinAchievement } from "./engine";
import { gameClimbMetricDisplay } from "./engine/activities";
import { convertTrend, dailyDistanceAlternative } from "./engine/daily-distance";
import { formatNumber, milesFromKm } from "./engine/shared";

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
  /** Distance alternates for US/UK or metric. Height alternates serve both metric and UK. */
  miles?: CandidateDisplay;
  kilometers?: CandidateDisplay;
  meters?: CandidateDisplay;
  /** Private detector evidence on the sealed wrapper, independent of its units or variants. */
  achievement?: HealthWinAchievement;
  sourceComplete?: boolean;
}

export function healthCandidateDisplay(candidate: CachedHealthCandidate, units: ClientUnits = "us"): CandidateDisplay {
  const distance = units === "metric" ? candidate.kilometers : candidate.miles;
  const height = units === "us" ? undefined : candidate.meters;
  return distance ?? height ?? candidate;
}

function alternateId(system: string, id: string) {
  return createHash("sha256").update(`${system}:${id}`).digest("base64url");
}

/** Older sealed sets have only the km display. Derive their alternate ID and revisions consistently on read. */
export function withDistanceTrendUnits(candidate: CachedHealthCandidate): CachedHealthCandidate {
  const original = candidate.variants[0].spec;
  if (candidate.miles || original.kind !== "trend_change" || original.chart.type !== "trend" || original.chart.unit !== "km") return candidate;
  const id = alternateId("miles", candidate.id);
  const card = convertTrend({ ...original, id, kind: original.kind, chart: original.chart }, "mi", milesFromKm);
  if (!card) return candidate;
  return { ...candidate, miles: prepareDisplay(card, specDigest) };
}

function prepareDisplay(card: ShareableCard, revision: (spec: Variant["spec"]) => string): CandidateDisplay {
  const variant = (option: Variant["option"], spec: Variant["spec"]): Variant => ({ option, spec, specRevision: revision(spec) });
  const variants: CachedHealthCandidate["variants"] = [variant("original", card)];
  const converted = hoursCard(card);
  if (converted) variants.push(variant("hours", converted));
  variants.push(variant("hide_numbers", hidden(card)));
  return { id: card.id, variants };
}

function prepareMemberCandidate(
  memberId: string, engineCard: CardSpec, revision: (spec: Variant["spec"]) => string, distanceArtUrl?: string | null,
): CachedHealthCandidate {
  const id = createHostedOpaqueIdentifier("health-win-card", JSON.stringify([memberId, engineCard.id]))!;
  const card = engineCard.kind === "cumulative" && distanceArtUrl
    ? { ...engineCard, id, chart: { ...engineCard.chart, art: { url: distanceArtUrl } } }
    : { ...engineCard, id };
  const candidate = prepareDisplay(card, revision);
  const alternate = card.kind === "game_climb" ? gameClimbMetricDisplay(card) : dailyDistanceAlternative(card);
  if (!alternate) return candidate;
  const display = prepareDisplay({ ...alternate.card, id: alternateId(alternate.units, id) }, specDigest);
  return { ...candidate, [alternate.units]: display };
}

/** Store each derived option in the authenticated set. Later deploys can replay exactly what the composer displayed. */
export function prepareHealthCandidates(
  memberId: string, cards: readonly CardSpec[], distanceArtUrl: string | null = null,
  detection?: { achievements: ReadonlyMap<string, HealthWinAchievement>; complete: boolean },
): CachedHealthCandidate[] {
  return cards.map(card => {
    const candidate = prepareMemberCandidate(memberId, card, () => randomUUID(), distanceArtUrl);
    const achievement = detection?.achievements.get(card.id);
    return achievement ? { ...candidate, achievement, sourceComplete: detection?.complete } : candidate;
  });
}

export function prepareSeeYoursCandidate(memberId: string, card: CardSpec, units: ClientUnits): CachedHealthCandidate {
  if (!card.measure) throw invalidGameRequest("Choose a card with a measure.");
  const candidate = prepareMemberCandidate(memberId, card, specDigest);
  const display = healthCandidateDisplay(candidate, units);
  return { id: `mine:${card.measure}:${card.kind}`, variants: display.variants };
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

/** A card without its own tips. A recording just made is asked how it went, not how the member got there. */
function defaultCaptionTips(kind: string): string[] {
  if (kind === "activity_route" || kind === "activity_splits") return ["How did it feel?", "Where did you go?"];
  if (kind.startsWith("activity_")) return ["How did it feel?"];
  return ["What helped you get here?", "How did it feel?"];
}

export function previewHealthCandidate(candidate: CachedHealthCandidate, option = "original") {
  const { spec, specRevision } = chooseVariant(candidate, option);
  if (spec === null) throw invalidGameRequest("This option removes the card.");
  return { ...spec, specRevision,
    change_options: candidate.variants.map(item => ({ id: item.option, label: labels[item.option] })),
    caption_tips: spec.share.caption_tips.length ? spec.share.caption_tips : defaultCaptionTips(spec.kind) };
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
  for (const candidate of candidates) {
    const display = [candidate, candidate.miles, candidate.kilometers, candidate.meters].find(item => item?.id === candidateId);
    if (display) return { claimId: candidate.id, display };
  }
  throw invalidGameRequest("Choose a card from this set.");
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

const activityCardChanged = () => hostedOnboardingError({
  code: "HEALTH_ACTIVITY_CARD_CHANGED", httpStatus: 409, message: "Preview the activity again before posting.",
});

export function resolveRecordedSelection(
  candidates: readonly CachedHealthCandidate[], pick: HealthCardSelection, onChanged: () => Error = activityCardChanged,
): FrozenHealthCard | null {
  const variant = candidates.find(card => card.id === pick.candidateId)?.variants.find(item => item.option === pick.option);
  if (!variant || pick.specRevision !== variant.specRevision) throw onChanged();
  return variant.spec === null ? null : { id: variant.spec.id, specRevision: variant.specRevision, spec: variant.spec };
}
