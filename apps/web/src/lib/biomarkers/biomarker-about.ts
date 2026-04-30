// TEMPORARY: replace with `BiomarkerPageModel.about` field once rocketman-21
// adds it to the Health Commons biomarker model.
// Tracked in TODOS.md → "Health Commons biomarker model field gaps".
//
// Per-biomarker prose for the About 3-column section on the biomarker page.
// When a biomarker is missing here, the About section falls back to rendering
// only the biomarker.summary as a single paragraph.
//
// Keep each column to one tight sentence (~15–25 words). The column is meant
// to be scanned, not read.

export interface BiomarkerAboutContent {
  whyItMatters: string;
  howItsMeasured: string;
  whatMovesIt: string;
}

const ABOUT_LOOKUP: Record<string, BiomarkerAboutContent> = {
  "resting-heart-rate": {
    whyItMatters: "Lower means the heart works less at rest. A reliable proxy for aerobic fitness and recovery.",
    howItsMeasured: "Wearables read it overnight. Manually: just after waking, sitting still for one minute, before caffeine.",
    whatMovesIt: "Down with aerobic training, sleep, heat adaptation. Up with stress, illness, alcohol, undertraining.",
  },
  "hrv-rmssd": {
    whyItMatters: "Higher means stronger parasympathetic recovery. A readiness signal for hard efforts the next day.",
    howItsMeasured: "Wearables read it overnight from beat-to-beat intervals. Same sleep window, no late alcohol.",
    whatMovesIt: "Up with aerobic training, sleep regularity, breathwork. Down with acute stress, alcohol, illness.",
  },
  "estimated-vo2max": {
    whyItMatters: "The strongest single longevity correlate Murph tracks. Caps how hard the body can work aerobically.",
    howItsMeasured: "Wearables estimate from heart rate during sustained efforts. Trends matter more than absolute values.",
    whatMovesIt: "Up with high-intensity intervals and zone-2 volume over months. Down within weeks of detraining.",
  },
  "blood-glucose": {
    whyItMatters: "Stable, low-amplitude curves predict better long-term cardiometabolic health than any single value.",
    howItsMeasured: "CGMs capture full curves. Finger-prick gives point reads. Same context every time.",
    whatMovesIt: "Fiber, protein, and post-meal movement reduce spikes. Sleep and timing matter as much as food.",
  },
  "blood-oxygen-spo2": {
    whyItMatters: "Persistently low readings can signal sleep-disordered breathing. Trends matter more than single values.",
    howItsMeasured: "Optical estimate. Affected by skin tone, motion, cold extremities. Low single reads need clinical context.",
    whatMovesIt: "Altitude, sleep position, and respiratory health move SpO₂. Sustained drops with symptoms need a clinician.",
  },
  "deep-sleep-minutes": {
    whyItMatters: "When the body does most of its physical recovery and growth-hormone work.",
    howItsMeasured: "Wearables stage sleep from heart rate, movement, temperature. Track trends, not absolute minutes.",
    whatMovesIt: "Up with cool rooms, consistent bedtime, daytime aerobic load. Down with late screens, alcohol, warm rooms.",
  },
};

export function resolveBiomarkerAbout(biomarkerId: string): BiomarkerAboutContent | null {
  return ABOUT_LOOKUP[biomarkerId] ?? null;
}
