// TEMPORARY: per-biomarker analysis profile used by the biomarker overview
// trend card. Provides population reference range, the "good" direction
// for this biomarker, and a one-line next-step recommendation.
//
// Drop once rocketman-21 ships these as part of the model. Tracked in
// TODOS.md.

export interface BiomarkerEvidenceProfile {
  studies: number;
  participants: number;
  studyType: "observational" | "RCT" | "meta-analysis";
  /** 1–5 evidence strength rating */
  rating: number;
  quote: string;
  attribution: string;
}

export interface BiomarkerAnalysisProfile {
  /** numeric typical population range, in the biomarker's native unit */
  typicalMin: number;
  typicalMax: number;
  /** caption shown next to the typical range, e.g. "healthy adults" */
  typicalRangeLabel: string;
  /** which direction is "good" for this biomarker */
  goodDirection: "down" | "up" | "stable";
  /** one-line recommendation when the user is on/near target */
  nextStep: string;
  /** mocked evidence summary for the trend section */
  evidence?: BiomarkerEvidenceProfile;
}

const ANALYSIS: Record<string, BiomarkerAnalysisProfile> = {
  "resting-heart-rate": {
    typicalMin: 55,
    typicalMax: 75,
    typicalRangeLabel: "healthy adults",
    goodDirection: "down",
    nextStep: "Keep aerobic training consistent",
    evidence: {
      studies: 4,
      participants: 18400,
      studyType: "meta-analysis",
      rating: 5,
      quote: "Resting heart rate is among the strongest non-invasive predictors of cardiovascular and all-cause mortality in healthy adults.",
      attribution: "Cooper Institute, 2019",
    },
  },
  "hrv-rmssd": {
    typicalMin: 30,
    typicalMax: 60,
    typicalRangeLabel: "healthy adults",
    goodDirection: "up",
    nextStep: "Sleep regularity is the strongest lever",
    evidence: {
      studies: 6,
      participants: 9200,
      studyType: "meta-analysis",
      rating: 4,
      quote: "Higher RMSSD reliably tracks parasympathetic recovery and predicts both training readiness and stress resilience.",
      attribution: "Frontiers in Physiology, 2022",
    },
  },
  "estimated-vo2max": {
    typicalMin: 35,
    typicalMax: 55,
    typicalRangeLabel: "healthy adults",
    goodDirection: "up",
    nextStep: "Add one zone-2 session per week",
    evidence: {
      studies: 8,
      participants: 122000,
      studyType: "meta-analysis",
      rating: 5,
      quote: "VO2max is the single strongest modifiable predictor of long-term mortality risk we have measured.",
      attribution: "JAMA Network Open, 2018",
    },
  },
  "blood-glucose": {
    typicalMin: 70,
    typicalMax: 100,
    typicalRangeLabel: "fasting reference",
    goodDirection: "stable",
    nextStep: "Walk 10 minutes after meals",
    evidence: {
      studies: 5,
      participants: 35400,
      studyType: "RCT",
      rating: 4,
      quote: "Time-in-range is a better proxy for metabolic health than fasting glucose alone in non-diabetic adults.",
      attribution: "Diabetes Care, 2021",
    },
  },
  "deep-sleep-minutes": {
    typicalMin: 60,
    typicalMax: 110,
    typicalRangeLabel: "healthy adults",
    goodDirection: "up",
    nextStep: "Cool the bedroom and avoid late alcohol",
    evidence: {
      studies: 3,
      participants: 7100,
      studyType: "observational",
      rating: 3,
      quote: "Slow-wave sleep duration is consistently linked with overnight glymphatic clearance and next-day cognitive performance.",
      attribution: "Sleep Medicine Reviews, 2020",
    },
  },
  "rem-sleep-minutes": {
    typicalMin: 80,
    typicalMax: 120,
    typicalRangeLabel: "healthy adults",
    goodDirection: "up",
    nextStep: "Consistent sleep window is the lever",
    evidence: {
      studies: 4,
      participants: 5600,
      studyType: "observational",
      rating: 3,
      quote: "REM sleep tracks emotional consolidation and creative problem-solving more cleanly than total sleep time.",
      attribution: "Nature Reviews Neuroscience, 2020",
    },
  },
  "blood-oxygen-spo2": {
    typicalMin: 95,
    typicalMax: 100,
    typicalRangeLabel: "healthy at sea level",
    goodDirection: "stable",
    nextStep: "If overnight averages drop with symptoms, see a clinician",
    evidence: {
      studies: 2,
      participants: 4300,
      studyType: "observational",
      rating: 3,
      quote: "Sustained overnight desaturation below 92% correlates with sleep-disordered breathing and warrants clinical follow-up.",
      attribution: "American Thoracic Society, 2021",
    },
  },
};

export function resolveBiomarkerAnalysis(biomarkerId: string): BiomarkerAnalysisProfile | null {
  return ANALYSIS[biomarkerId] ?? null;
}
