// TEMPORARY: replace with `BiomarkerProtocolRankingModel.signal` field once
// rocketman-21 adds it to the Health Commons biomarker model.
// Tracked in TODOS.md → "Health Commons biomarker model field gaps".
//
// Lookup keyed by `${experimentId}::${biomarkerId}`. When an entry is missing,
// the experiment card falls back to showing only the expectedDirection label.

export interface BiomarkerExperimentSignalEstimate {
  range: string;
  window: string;
  evidence: "high" | "moderate" | "variable" | "low";
}

const SIGNAL_LOOKUP: Record<string, BiomarkerExperimentSignalEstimate> = {
  "norwegian-4x4::resting-heart-rate": {
    range: "−5 to −10%",
    window: "4–8 wks",
    evidence: "moderate",
  },
  "finnish-sauna::resting-heart-rate": {
    range: "−3 to −7%",
    window: "4–8 wks",
    evidence: "moderate",
  },
  "bryan-johnson-blueprint::resting-heart-rate": {
    range: "−3 to −5%",
    window: "8–12 wks",
    evidence: "low",
  },
  "norwegian-4x4::hrv-rmssd": {
    range: "+5 to +10 ms",
    window: "4–8 wks",
    evidence: "moderate",
  },
  "finnish-sauna::hrv-rmssd": {
    range: "+3 to +7 ms",
    window: "4–8 wks",
    evidence: "variable",
  },
  "norwegian-4x4::estimated-vo2max": {
    range: "+3 to +6 ml/kg/min",
    window: "8–12 wks",
    evidence: "high",
  },
  "finnish-sauna::blood-glucose": {
    range: "−2 to −5 mg/dL",
    window: "8–12 wks",
    evidence: "low",
  },
  "finnish-sauna::deep-sleep-minutes": {
    range: "+10 to +20 min",
    window: "2–4 wks",
    evidence: "variable",
  },
  "red-light-glasses-before-bed::deep-sleep-minutes": {
    range: "+5 to +15 min",
    window: "2–4 wks",
    evidence: "low",
  },
};

export function resolveBiomarkerExperimentSignal(
  experimentId: string,
  biomarkerId: string,
): BiomarkerExperimentSignalEstimate | null {
  return SIGNAL_LOOKUP[`${experimentId}::${biomarkerId}`] ?? null;
}
