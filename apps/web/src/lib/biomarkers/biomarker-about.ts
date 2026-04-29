// TEMPORARY: replace with `BiomarkerPageModel.about` field once rocketman-21
// adds it to the Health Commons biomarker model.
// Tracked in TODOS.md → "Health Commons biomarker model field gaps".
//
// Per-biomarker prose for the About 3-column section on the biomarker page.
// When a biomarker is missing here, the About section falls back to rendering
// only the biomarker.summary as a single paragraph.

export interface BiomarkerAboutContent {
  whyItMatters: string;
  howItsMeasured: string;
  whatMovesIt: string;
}

const ABOUT_LOOKUP: Record<string, BiomarkerAboutContent> = {
  "resting-heart-rate": {
    whyItMatters:
      "Lower resting heart rate tracks aerobic fitness and parasympathetic tone. A calmer baseline usually means the heart works less per beat at rest, and the body recovers faster between efforts.",
    howItsMeasured:
      "Measured just after waking, before caffeine, while still lying or sitting quietly for at least one minute. Wearables read it overnight; clinical readings need consistent context to compare.",
    whatMovesIt:
      "Aerobic capacity, sleep quality, heat adaptation, and sustained recovery practices nudge resting heart rate down over weeks. Stress, illness, alcohol, and undertraining push it up.",
  },
  "hrv-rmssd": {
    whyItMatters:
      "HRV reflects how flexibly your autonomic nervous system responds to demands. Higher RMSSD usually means stronger parasympathetic recovery and better readiness for hard efforts.",
    howItsMeasured:
      "Read overnight by wearables that measure beat-to-beat intervals. Most reliable when context is consistent: same sleep window, no late alcohol, no acute illness.",
    whatMovesIt:
      "Aerobic conditioning, sleep regularity, breathwork, and heat exposure tend to raise HRV. Acute stress, alcohol, late-night training, and illness collapse it temporarily.",
  },
  "estimated-vo2max": {
    whyItMatters:
      "VO₂max is the strongest single longevity correlate Murph tracks. It measures how much oxygen your body can use under maximal effort, capped by heart, lungs, and mitochondria together.",
    howItsMeasured:
      "Wearables estimate it from heart rate response during sustained efforts. Lab tests with a mask are more accurate but rare. Trends matter more than absolute values across devices.",
    whatMovesIt:
      "High-intensity intervals, zone-2 aerobic volume, and consistent training over months. Detraining and inactivity drop it within weeks.",
  },
  "blood-glucose": {
    whyItMatters:
      "Postprandial glucose spikes and fasting baselines together signal how cleanly your metabolism handles fuel. Stable, low-amplitude curves predict better long-term cardiometabolic health.",
    howItsMeasured:
      "Continuous glucose monitors capture full curves; finger-prick meters give point reads. Consistent measurement context matters: time since last meal, time of day, activity.",
    whatMovesIt:
      "Meal composition, timing, sleep, exercise, and heat exposure all shift glucose handling. Fiber, protein, and movement after meals reduce spikes.",
  },
  "blood-oxygen-spo2": {
    whyItMatters:
      "Blood oxygen saturation reflects how well oxygen is being delivered to tissues. Persistent low readings can signal sleep-disordered breathing or pulmonary issues that warrant clinical follow-up.",
    howItsMeasured:
      "Consumer wearables and home pulse oximeters estimate SpO₂ optically. Readings are affected by skin tone, perfusion, motion, and cold extremities. Low single readings need clinical context, not self-diagnosis.",
    whatMovesIt:
      "Altitude, sleep position, breathing patterns, and respiratory health move SpO₂. If overnight averages drop below your usual baseline together with daytime symptoms, talk to a clinician.",
  },
  "deep-sleep-minutes": {
    whyItMatters:
      "Deep (slow-wave) sleep is when the body does most of its physical recovery and growth-hormone work. Too little correlates with worse training adaptation and immune function.",
    howItsMeasured:
      "Wearables stage sleep from heart rate, movement, and temperature. Estimates vary across devices; track trends, not absolute minutes.",
    whatMovesIt:
      "Cool sleep environment, consistent bedtime, daytime aerobic load, and avoiding late alcohol all push deep sleep up. Late screens and warm rooms suppress it.",
  },
};

export function resolveBiomarkerAbout(biomarkerId: string): BiomarkerAboutContent | null {
  return ABOUT_LOOKUP[biomarkerId] ?? null;
}
