---
name: red-light-therapy
description: Use for red light therapy or photobiomodulation questions, including dose, duration, distance, wavelengths, device irradiance, Bestqool lamps, safety boundaries, and Health Commons PBM experiment setup.
---

# Red light therapy

## Goal

Help the user make a safe, evidence-bounded red light therapy decision without pretending consumer devices or third-party research summaries are more precise than they are.

## Core stance

- Health Commons is the durable source of truth. This skill is the agent playbook, not the research database.
- External research lists are discovery aids only. Do not treat third-party summaries as verified Murph claims unless the study has been promoted into Health Commons source pages.
- Prefer existing Health Commons evidence before inventing advice. Use `vault-cli commons protocol explore "red light therapy" --format json` when protocol context would improve the answer, then show the exact protocol with `vault-cli commons protocol show <key-or-route> --format json`.
- Help first. When the user wants practical guidance for using a lamp, answer the setup, missing device data, dosing math, safety, and stop-condition questions directly. Do not force an experiment frame or make protocol setup the main answer.
- Existing same-family public protocols matter even when the user's device, dose, metric, or schedule differs. If the user wants to track whether it works, compose with `experiment-onboarding` after this skill resolves setup and safety basics.
- Do not add a red-light-specific CLI, store, score, or device primitive from this skill. Use current Health Commons protocol lookup and ordinary calculation.

## Advisor flow

Classify the user's goal before giving protocol advice:

- `skin_photoaging`: skin texture, wrinkles, face/periocular masks, collagen/photoaging. Prefer the Health Commons skin photobiomodulation protocol and keep claims skin-specific.
- `localized_pain_recovery`: back, neck, joint, muscle soreness, injuries, return-to-play. Treat evidence as adjacent unless Health Commons has a direct matched protocol/source; screen for medical red flags.
- `whole_body_recovery_sleep`: whole-body panels, sleep quality, HRV/RHR, fatigue, recovery, general wellness. Use bounded experiment framing and avoid systemic benefit promises.
- `brain_mood_cognition`: transcranial, intranasal, mood, TBI, dementia, focus, memory. Keep educational and clinician-guided unless a verified protocol directly matches.
- `hair_scalp`: hair loss or scalp devices. Ask for diagnosis and scalp-specific device evidence; do not borrow skin or whole-body dosing.
- `wound_or_medical_skin`: wounds, burns, ulcers, active rash, infection, psoriasis, eczema, scars, keloids. Default to safety triage and clinician guidance.

Use evidence-fit language in answers:

- `direct_protocol`: close Health Commons protocol/source match.
- `adjacent_human`: relevant human PBM literature, but different device, body site, dose, or population.
- `safety_or_context`: useful for boundaries, not benefit claims.
- `intake_only`: PubMed/source discovery exists but has not been extracted into dosing or efficacy guidance.
- `unknown`: no usable Murph evidence yet.

## Intake

Ask only decision-changing gaps. The most useful missing items are:

- Goal or target: skin/photoaging, pain/recovery, sleep/circadian, hair, general wellness, or a specific condition.
- Device brand/model and wavelengths.
- Irradiance at the user's actual treatment distance, in `mW/cm2`.
- Planned distance from skin and exposed body area.
- Target dose from a verified protocol/source, in `J/cm2`.
- Frequency and timing constraints.
- Safety flags: eye exposure, photosensitizing medication or supplement, active cancer treatment, pregnancy, seizure/photosensitivity history, suspicious lesions, burns, neuropathy or reduced sensation, and heat intolerance.

If the user asks "how long should I do it?" and gives no device details, ask for device model and either a manufacturer/measured irradiance value at their intended distance. Do not ask for every item above before giving a useful next step.

Before calculating duration, make sure the answer has:

- goal or target use case;
- device brand and exact model;
- wavelengths;
- irradiance at the planned distance in `mW/cm2`;
- planned skin distance;
- target dose in `J/cm2` from a verified protocol or source.

If any of those are missing, say what is missing and give the next practical step. If the irradiance distance does not match the planned skin distance, do not calculate as if it matched.

## Dose math

Use this formula when dose and irradiance are both area-normalized:

```text
seconds = target dose J/cm2 * 1000 / irradiance mW/cm2
minutes = seconds / 60
```

For a dose range, calculate both endpoints. Example: `12 J/cm2` at `109 mW/cm2` is about `110 seconds`, or about `2 minutes`.

Use dose math only when:

- the dose is in `J/cm2`;
- irradiance is in `mW/cm2`;
- the irradiance reading matches the user's distance;
- the target tissue and source context are close enough to the user's goal.

Do not calculate from watts, number of LEDs, marketing coverage area, battery power, "clinical strength", or a reading measured at a different distance. Do not use inverse-square extrapolation for panels unless a verified measurement chart supports it.

## Device handling

Ask "what device do you have?" early when dosing depends on duration. Then:

- If the user gives a Bestqool model, first check the skill-local `device-seeds.json` next to this file. Treat it as manufacturer-claim seed data, not verified Health Commons evidence.
- If the user has the device's irradiance chart, use the row for their actual distance.
- If the user only has a model name, ask for the intended distance and offer to check the official manufacturer page when browser/computer-use is available.
- If browser/computer-use is available and the user asks Murph to check the device online, use the browser workflow and treat product-page specs as manufacturer claims.
- If no current spec is available, give a range only as an example and clearly label it as not device-specific.

Bestqool manufacturer-claim examples checked from official product pages on 2026-06-30:

- Bestqool BQ60: `660/850 nm`, `95.6 mW/cm2` at `7.62 cm` / `3 in`.
- Bestqool Pro100: `630/660/850/940 nm`, `109 mW/cm2` at `7.62 cm` / `3 in`.
- Bestqool Pro300: `630/660/850/940 nm`, `106 mW/cm2` at `7.62 cm` / `3 in`.

Use those only when the user is actually using that model at about `7.62 cm`. Otherwise ask for the matching row or current page value. Do not treat this skill as a broad device catalog; prefer the current official product page or a user-provided manual/irradiance chart.

Common brands worth checking by official model page when the user gives a device name: Hooga, Mito Red Light, Joovv, PlatinumLED BioMax, Red Light Man, Bon Charge, Omnilux, CurrentBody, and Solawave. Prefer official pages or user-provided manuals/irradiance charts over retailer listings, reviews, or blogs.

## Answer shape

For dosing answers, keep the response compact:

1. State the assumption or missing value.
2. Give the calculation when valid.
3. Give a conservative starting suggestion when appropriate, such as starting at the low end of a verified range and watching skin/eye/heat tolerance.
4. Name what would change the answer: goal, wavelength, dose target, distance, device irradiance, body area, or safety flags.

Do not bury the user in study lists. If evidence matters, summarize the fit: direct protocol evidence, adjacent human evidence, safety/context evidence, intake-only evidence, or unknown. Mention exact PubMed details only when Health Commons source/protocol output provides them or the user asks.

## Safety boundaries

- Eye exposure needs explicit caution. Do not recommend looking into panels or treating eyes without clinician guidance and eye-specific protocol evidence.
- Do not give disease-treatment instructions for cancer, eye disease, neuropathy, inflammatory disease, wound care, pregnancy, or medication-sensitive contexts. Suggest clinician guidance and keep any self-experiment low-risk and reversible.
- Stop or reduce exposure for burns, unusual pain, headache, eye symptoms, marked skin irritation, dizziness, or worsening symptoms.
- Heat is not the therapeutic dose. A warm panel can still overdose skin if the session is too long.
- More is not automatically better; PBM can be biphasic, so higher dose or longer sessions can be less useful or more irritating.

Use stronger caution for: eye exposure, photosensitizing medication or supplements, active cancer treatment, suspicious skin lesions, pregnancy, seizure/photosensitivity history, neurologic disease, head injury, active mood disorder, neuropathy, reduced sensation, impaired circulation, heat intolerance, open wounds, infection concerns, burns, ulcers, or rapidly worsening skin conditions.

## Experiment handoff

Experiment setup is optional. If the user just wants help using a lamp today, answer the setup/dosing/safety question and stop. If the user wants Murph to track whether red light therapy works for them, first resolve the best Health Commons protocol family:

- skin/photoaging: look for the skin photobiomodulation protocol;
- whole-body recovery, sleep, HRV/RHR, or general wellness: look for the whole-body photobiomodulation protocol;
- sleep timing/light environment rather than panel exposure: look for evening light reduction protocols instead.

Then read and follow `$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md`. Preserve public protocol lineage and store user-specific device, distance, dose, timing, safety answers, and outcomes as setup answers or typed experiment fields.
