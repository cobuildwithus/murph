// Educational content for the environment fact drawer. Keyed by catalog
// indicator id. Tone: practical, evidence-informed, specific; no medical
// claims, no diagnosis language. Density: one-sentence insight (keyPoints),
// then 3-5 short actionable items across at most two sections.

export type GuideSection = {
  title: string;
  items: string[];
};

export type IndicatorGuide = {
  keyPoints: string[];
  sections: GuideSection[];
};

export const INDICATOR_GUIDES: Readonly<Record<string, IndicatorGuide>> = {
  night_temp_c: {
    keyPoints: [
      "Sleep starts with a drop in core temperature — a room near 18-22 °C makes that easy, an overheated one fights it all night.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Start near 20 °C; adjust 1 °C every three nights.",
          "Pre-cool the room 30-60 minutes before bed.",
          "Cool room, warm feet — light socks beat heating.",
          "Waking sweaty? Fix the duvet before the thermostat.",
        ],
      },
    ],
  },
  temp_control: {
    keyPoints: [
      "Stability beats a perfect number — a controllable room stays right through the seasons, an uncontrolled one tracks the weather.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "A timer turns heating or cooling into a bedtime tool.",
          "Block afternoon sun before it stores heat for the night.",
          "A fan cools skin even without lowering room temperature.",
          "Seal winter drafts — but keep a separate fresh-air plan.",
        ],
      },
    ],
  },
  window_at_night: {
    keyPoints: [
      "A 1-2 cm gap can change overnight CO₂ more than you'd expect — the real question is which option gives the better night.",
    ],
    sections: [
      {
        title: "Getting it right",
        items: [
          "Quiet street, clean air? Open wins by default.",
          "Compare three open and three closed nights: CO₂, temperature, noise.",
          "Smoke, heavy pollen, or waking noise? Keep it closed.",
          "Wide opening a safety risk? Use a restrictor.",
        ],
      },
    ],
  },
  co2_typical_ppm: {
    keyPoints: [
      "CO₂ is your ventilation gauge — a closed bedroom climbs fast, and two sleepers raise it roughly twice as quickly.",
    ],
    sections: [
      {
        title: "Measure it well",
        items: [
          "Use an NDIR meter with an overnight graph.",
          "Read the wake-time peak, not a daytime spot check.",
        ],
      },
      {
        title: "What helps",
        items: [
          "Crack the door or window; compare three nights.",
          "Still above 1000 ppm? Widen the gap before buying gear.",
        ],
      },
    ],
  },
  darkness: {
    keyPoints: [
      "Light reaches the brain through closed eyelids — true blackout means no visible room details after five minutes of adjustment.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Seal curtain edges — most light leaks above and beside the fabric.",
          "Cover or remove charging LEDs.",
          "A soft sleep mask beats re-engineering a rental.",
          "Need night safety? Low amber light at floor level.",
        ],
      },
    ],
  },
  night_noise: {
    keyPoints: [
      "The sleeping brain still reacts to sound — noise fragments sleep without a remembered wake-up; WHO's quiet-room reference is under 30 dBA.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Sudden peaks hurt more than steady background — mask them with a fan.",
          "Move the bed off the shared wall before buying acoustics.",
          "Seal window gaps; add a solid door sweep.",
          "Phone dB readings show trends, not precision.",
        ],
      },
    ],
  },
  noise_countermeasures: {
    keyPoints: [
      "A 10 dB drop sounds half as loud — and sealing one air gap often beats a wall of soft decor.",
    ],
    sections: [
      {
        title: "Start simple",
        items: [
          "Properly inserted foam earplugs, three nights, then judge.",
          "Masking sound just loud enough to blur the peaks.",
          "Earplugs in? Switch to a vibrating or light alarm.",
        ],
      },
    ],
  },
  humidity_known: {
    keyPoints: [
      "The 40-60% RH band keeps airways comfortable and starves dust mites and mold — above 60%, condensation and growth take over.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "A cheap hygrometer tells you which side you're on.",
          "Too damp? Extract while cooking and showering; dry laundry elsewhere.",
          "Too dry? Ease the heating before adding a humidifier.",
          "Clean humidifiers on schedule — standing water spreads microbes.",
        ],
      },
    ],
  },
  mattress_satisfaction: {
    keyPoints: [
      "Ten showroom minutes can't predict eight hours — comfort after a full night is the only test that counts.",
    ],
    sections: [
      {
        title: "Buying guide",
        items: [
          "Medium-firm suits back and stomach sleepers; side sleepers want softer shoulders.",
          "Foam hugs, latex springs and cools, hybrids breathe.",
          "Insist on a real 30-100 night home trial.",
        ],
      },
      {
        title: "Check yourself",
        items: ["Morning stiffness that fades elsewhere points at the mattress."],
      },
    ],
  },
  mattress_age_years: {
    keyPoints: [
      "Support fades too slowly to notice — your body adapts before you register the sag. Treat 7-10 years as a review point, not an expiry date.",
    ],
    sections: [
      {
        title: "Check yourself",
        items: [
          "Inspect the empty bed: sagging, soft edges, lasting body impressions.",
          "Compare three nights away with three at home.",
          "Check the frame — a weak base sags a sound mattress.",
        ],
      },
    ],
  },
  bedding_overheating: {
    keyPoints: [
      "The bed runs several degrees warmer than the room — overheating usually strikes in the second half of the night, when deep sleep gives way to lighter stages.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Light sheet plus removable layers instead of one warm duvet.",
          "Breathable fills — down, wool, linen — over polyester.",
          "Two sleepers with different heat levels: separate covers.",
        ],
      },
      {
        title: "Check yourself",
        items: ["Waking sweaty? Remove one layer for three nights."],
      },
    ],
  },
  co_sleepers: {
    keyPoints: [
      "A partner, kid, or pet adds heat, movement, and sound your tracker can't explain — that's context, not a problem to optimize away.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Separate duvets decouple movement and temperature.",
          "Pet waking you? Give it a stable spot beside the bed.",
          "Compare shared and solo nights before blaming the mattress.",
          "Infants: follow age-specific safe-sleep guidance.",
        ],
      },
    ],
  },
  phone_by_bed: {
    keyPoints: [
      "A phone within reach turns a brief wake-up into 30 minutes of scrolling — distance is the only fix that survives 3 a.m. willpower.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Charge it outside the bedroom; try a basic alarm clock for a week.",
          "Park it in the same spot 30-60 minutes before bed.",
          "Must stay? Across the room, face down, hard do-not-disturb.",
        ],
      },
    ],
  },
  tv_in_bedroom: {
    keyPoints: [
      "A bedroom TV pairs bright light with content built to delay your stopping point — removing it decides once what restraint must decide nightly.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Move it out; keep the ritual with audio on a timer.",
          "Too big a step? Unplug it for seven nights and compare.",
          "If it stays: 20-30 minute sleep timer, autoplay off.",
        ],
      },
    ],
  },
  ventilation: {
    keyPoints: [
      "Ventilation is the home's exhale — CO₂, moisture, and cooking fumes leave through it, and no filter does that job.",
    ],
    sections: [
      {
        title: "Start cheap",
        items: [
          "Cross-ventilate 5-10 minutes after waking, cooking, showering, and before bed.",
          "Run kitchen and bathroom extractors 15-20 minutes past the event.",
          "Keep trickle vents clear; leave the bedroom door ajar.",
          "Renovating anyway? That's the moment to ask about heat recovery.",
        ],
      },
    ],
  },
  damp_or_mold: {
    keyPoints: [
      "Mold is a moisture signal — cleaned surfaces regrow unless the water stops, and wet materials need drying within 24-48 hours.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Find the leak or cold-wall condensation before redecorating.",
          "Pull furniture a few centimeters off cold external walls.",
          "Musty smell, no visible mold? Check behind furniture and floors.",
          "Large areas, hidden damp, or lasting symptoms: bring in professionals.",
        ],
      },
    ],
  },
  air_purifier: {
    keyPoints: [
      "HEPA removes particles — smoke, pollen, PM2.5 — but not CO₂; airflow (CADR) decides how much air actually gets cleaned.",
    ],
    sections: [
      {
        title: "Buying guide",
        items: [
          "Match smoke CADR to the room; a bigger unit runs quieter.",
          "Price the filters first — years of refills can cost more than the machine.",
        ],
      },
      {
        title: "Getting it right",
        items: [
          "Run it continuously on a tolerable speed; boost during smoke events.",
          "Skip ionizers and plasma modes — ozone risk, no upside.",
        ],
      },
    ],
  },
  air_quality_meter: {
    keyPoints: [
      "A meter earns its place when every number maps to an action: ventilate for CO₂, filter for particles, dry for humidity.",
    ],
    sections: [
      {
        title: "Buying guide",
        items: [
          "NDIR for CO₂, optical for PM2.5, separate numbers over one score.",
          "A 24-hour graph connects spikes to cooking, sleep, or smoke.",
          "Place it at breathing height, away from windows and your breath.",
        ],
      },
    ],
  },
  stove: {
    keyPoints: [
      "A gas flame adds NO₂, CO, and particles straight to the kitchen — induction skips combustion entirely, though searing still makes particles.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Replacing anyway? Induction first, electric second.",
          "Cook on back burners; run the hood 10-15 minutes past the steam.",
          "Gas with a weak hood? Crack a window while cooking.",
          "Keep a working CO alarm; never heat the room with burners.",
        ],
      },
    ],
  },
  smoke_sources: {
    keyPoints: [
      "Indoor smoke is concentrated PM2.5 that hangs in the air long after the flame dies, then settles into fabric and dust.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "All smoking fully outdoors, away from windows and intakes.",
          "Make candles and incense occasional, ventilated rituals.",
          "Fireplace spilling smoke? Stop using it until serviced.",
          "Watch a PM2.5 meter through one candle evening — it teaches fast.",
        ],
      },
    ],
  },
  radon_tested: {
    keyPoints: [
      "Radon is odorless, radioactive, and varies house to house — one cheap multi-week test answers the question for years.",
    ],
    sections: [
      {
        title: "How to test",
        items: [
          "Test the lowest lived-in level, windows closed per instructions.",
          "Elevated? Confirm with a longer test before mitigating.",
          "High result: certified radon professional, then retest.",
          "Purifiers don't touch radon — it's a gas.",
        ],
      },
    ],
  },
  drinking_water: {
    keyPoints: [
      "The utility report describes the supply — lead sneaks in later, from the service line and your own plumbing.",
    ],
    sections: [
      {
        title: "Getting it right",
        items: [
          "Read the utility report; check for a lead service line.",
          "Real concern? Use an accredited lab, not a strip kit.",
          "Buy filters certified for the named contaminant, not for taste.",
          "Replace cartridges on schedule — exhausted filters fail silently.",
        ],
      },
    ],
  },
  evening_light: {
    keyPoints: [
      "It's light at the eye that counts — one bright ceiling fixture outweighs several warm lamps; aim for 10-50 lux in the last hour.",
    ],
    sections: [
      {
        title: "Getting it right",
        items: [
          "Lamps below eye level after sunset, ceiling lights off.",
          "Dimmable 2200-2700 K bulbs where your evenings happen.",
          "Screens: brightness down until white stops glowing.",
          "Keep the bathroom route dim — one bright visit resets the wind-down.",
        ],
      },
    ],
  },
  morning_light_access: {
    keyPoints: [
      "Outdoor shade delivers thousands of lux, a bright room barely a few hundred — that gap is why stepping outside anchors the body clock.",
    ],
    sections: [
      {
        title: "How to use it",
        items: [
          "10-30 minutes outside within an hour of waking.",
          "Attach it to coffee, the dog, or the commute.",
          "Face the sky, never the sun.",
          "Dark winters: a 10,000-lux box at its rated distance.",
        ],
      },
    ],
  },
  daytime_light: {
    keyPoints: [
      "Offices run 300-500 lux; outdoors starts in the thousands — bright days are what make dim evenings a real signal.",
    ],
    sections: [
      {
        title: "What helps",
        items: [
          "Claim the brightest window; measure at eye level, not the desk.",
          "Two 10-20 minute outdoor breaks beat hours near a fixture.",
          "Dark workday? Bright task light by day, dim by evening.",
        ],
      },
    ],
  },
  high_cri_bulbs: {
    keyPoints: [
      "CRI is color fidelity, not brightness — 90+ makes skin, food, and wood look right; R9 above 50 covers the deep reds.",
    ],
    sections: [
      {
        title: "Buying guide",
        items: [
          "CRI 90+ where color matters: kitchen, bathroom, desk.",
          "Pick color temperature separately: 2700 K evenings, 3000-4000 K work.",
          "Check flicker and dimmer compatibility before buying a batch.",
        ],
      },
    ],
  },
  light_therapy_lamp: {
    keyPoints: [
      "10,000 lux is real only at the rated distance, often 30-50 cm — morning use shifts the clock earlier, evening use pushes it later.",
    ],
    sections: [
      {
        title: "How to use it",
        items: [
          "20-30 minutes within an hour of waking, at the exact distance.",
          "Eyes open, gaze past the lamp — never into it.",
          "Same time daily for 1-2 weeks before judging.",
          "Bipolar disorder or eye disease? Ask a clinician first.",
        ],
      },
    ],
  },
  sauna_access: {
    keyPoints: [
      "Finnish cohorts tie 4-7 weekly sessions to lower mortality — observational, not proof, but the habit pattern is the interesting part.",
    ],
    sections: [
      {
        title: "How to use it",
        items: [
          "70-100 °C, 10-20 minutes, comfort over endurance.",
          "Two short rounds with a cooling break beat one long one.",
          "Rehydrate after; add electrolytes on heavy-sweat days.",
          "Finish 1-2 hours before bed for the sleep effect.",
          "Ill, pregnant, or a heart condition? Check with a clinician.",
        ],
      },
    ],
  },
  cold_exposure: {
    keyPoints: [
      "Water under 15 °C triggers gasping within seconds — evidence backs short-term soreness relief; metabolism and longevity claims stay mixed.",
    ],
    sections: [
      {
        title: "Start simple",
        items: [
          "30-60 second cold shower finishes before buying a plunge.",
          "Never plunge alone in open water; exit before numbness.",
          "Chasing muscle growth? Keep cold hours away from lifting.",
          "Heart or blood-pressure condition? Clinician first.",
        ],
      },
    ],
  },
  red_light: {
    keyPoints: [
      "Photobiomodulation is real but narrow — dose, wavelength, and tissue decide everything, and more is not better.",
    ],
    sections: [
      {
        title: "Getting it right",
        items: [
          "Pick one outcome; follow a studied wavelength and session length.",
          "Judge with photos over 4-8 weeks, not post-session glow.",
          "Use the eye protection the device specifies.",
          "It replaces nothing — daylight, sleep, and rehab still do the work.",
        ],
      },
    ],
  },
  red_light_model: {
    keyPoints: [
      "The model number reveals what marketing hides: wavelengths, irradiance at your distance, and the safety instructions.",
    ],
    sections: [
      {
        title: "Buying guide",
        items: [
          "Demand irradiance at a stated distance, not at the panel surface.",
          "Typical panels: 630-670 nm red, 810-850 nm near-infrared, $200-1500.",
          "No wavelength or distance data published? Walk away.",
        ],
      },
    ],
  },
  scale: {
    keyPoints: [
      "Day-to-day weight swings 0.5-2 kg on water and salt alone — the 7-day average is the only number worth reading.",
    ],
    sections: [
      {
        title: "How to use it",
        items: [
          "Same conditions: after waking, before breakfast, hard floor.",
          "Three readings a week make a trend.",
          "Body-fat %: watch the trend, ignore the absolute number.",
          "Weighing feeds anxiety? Hide the display or pause.",
        ],
      },
    ],
  },
  bp_cuff: {
    keyPoints: [
      "Home readings often beat clinic ones — white coats raise pressure, and cuff size alone can shift a reading a full category.",
    ],
    sections: [
      {
        title: "How to measure",
        items: [
          "Validated upper-arm cuff, matched to your arm size.",
          "Five quiet minutes first; back supported, arm at heart level.",
          "Two readings one minute apart, same times daily.",
          "Above 180/120? Seek urgent care.",
        ],
      },
    ],
  },
  thermometer: {
    keyPoints: [
      "Oral, ear, and forehead readings live on different scales — and time of day alone moves temperature about 0.5 °C.",
    ],
    sections: [
      {
        title: "How to use it",
        items: [
          "Same device, same site, every time.",
          "Wait after hot drinks, exercise, or coming indoors.",
          "Log number, method, and time — a reading alone says little.",
          "Know your healthy baseline before you need it.",
        ],
      },
    ],
  },
  pulse_oximeter: {
    keyPoints: [
      "A fingertip oximeter estimates oxygen — cold hands, polish, and motion all skew it; the healthy sea-level range is 95-100%.",
    ],
    sections: [
      {
        title: "How to use it",
        items: [
          "Warm hand, no polish, sit still for a stable number.",
          "Odd value? Repeat on another warm finger.",
          "Repeated lows or worsening symptoms: call a clinician.",
          "Blue lips, confusion, severe breathlessness: emergency services, whatever the number.",
        ],
      },
    ],
  },
  work_mode: {
    keyPoints: [
      "Remote work deletes the commute — and with it the built-in walking, daylight, and hard stop your day used to include.",
    ],
    sections: [
      {
        title: "Design the week",
        items: [
          "Give each work mode one movement anchor and one light anchor.",
          "Remote days: a 10-20 minute fake commute outdoors.",
          "Hybrid: duplicate cheap gear instead of hauling it daily.",
          "End with a 5-minute shutdown ritual — the desk never leaves.",
        ],
      },
    ],
  },
  desk_hours: {
    keyPoints: [
      "Eight interrupted hours and eight frozen ones are different exposures — and a workout doesn't cancel the stillness between.",
    ],
    sections: [
      {
        title: "Build the routine",
        items: [
          "Stand or walk 2-5 minutes every 30-60.",
          "Park water, calls, and thinking tasks away from the desk.",
          "Count real seated time for three days — memory lies.",
        ],
      },
    ],
  },
  standing_desk: {
    keyPoints: [
      "A standing desk you never raise is a regular desk — the win is variation, not standing itself.",
    ],
    sections: [
      {
        title: "How to use it",
        items: [
          "10-15 standing minutes per hour; raise it for calls.",
          "Surface at elbow height in both positions; save the presets.",
          "Follow a standing block with a 2-minute walk.",
        ],
      },
    ],
  },
  screen_setup: {
    keyPoints: [
      "A laptop chains the screen to the keyboard — neck or wrists always lose; separating them ends the conflict.",
    ],
    sections: [
      {
        title: "Start simple",
        items: [
          "Raise the laptop on books; add any external keyboard.",
          "External monitor as the primary screen for real work.",
          "Center the main screen; enlarge text before leaning in.",
          "Angle screens away from windows to kill glare.",
        ],
      },
    ],
  },
  screen_at_eye_level: {
    keyPoints: [
      "Top of the screen at eye level keeps the gaze comfortably downward — from about 50-75 cm away, with text sized to match.",
    ],
    sections: [
      {
        title: "How to set it",
        items: [
          "Sit tall, look ahead — the top edge belongs at that height.",
          "Books work exactly as well as a fancy riser.",
          "Leaning in? Enlarge text, don't move closer.",
          "Progressive lenses? Set it lower.",
        ],
      },
    ],
  },
  chair: {
    keyPoints: [
      "Ergonomic means adjustable to you — height, depth, lumbar, armrests — not a label; no chair fixes eight motionless hours.",
    ],
    sections: [
      {
        title: "Getting it right",
        items: [
          "Feet flat, knees near 90-110°.",
          "Lumbar pad into the lower-back curve, not the belt line.",
          "Armrests low enough that your shoulders drop.",
          "Buying? Test 20-30 minutes at your real desk height.",
        ],
      },
    ],
  },
  external_keyboard: {
    keyPoints: [
      "A separate keyboard frees the screen to rise while hands stay at elbow height — neutral wrists matter more than switch marketing.",
    ],
    sections: [
      {
        title: "How to set it",
        items: [
          "Center the letter keys with your body, not the shell.",
          "Wrists straight, elbows 90-120°, shoulders loose.",
          "Rarely type numbers? A compact layout brings the mouse 10-15 cm closer.",
        ],
      },
    ],
  },
  wrist_complaints: {
    keyPoints: [
      "Tingling and aching are load signals — cheap to fix early at the setup stage, expensive to ignore into an injury.",
    ],
    sections: [
      {
        title: "What helps now",
        items: [
          "Ease the triggering task for a few days; vary inputs.",
          "Mouse close, keyboard low, grip loose, wrists straight.",
          "No hard desk edges under moving wrists.",
          "Symptoms past 1-2 weeks, night numbness, or weakness: see a clinician.",
        ],
      },
    ],
  },
  breaks: {
    keyPoints: [
      "NIOSH found hourly 5-minute breaks cut discomfort and eyestrain — systematic cues work; waiting for pain doesn't.",
    ],
    sections: [
      {
        title: "Build the routine",
        items: [
          "2-5 minutes away from chair and screen every 30-60.",
          "Hook breaks to calls, water, or the top of the hour.",
          "Walk or stretch — not a phone screen.",
          "Eyes tired? 20 seconds on something 6 meters away.",
        ],
      },
    ],
  },
};
