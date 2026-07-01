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
- Treat consumer device specs as setup inputs with provenance. A manufacturer irradiance claim can support a labeled duration estimate, not a clinical dose claim, and current official pages or user manuals win over seed data.
- Do not add a red-light-specific CLI, store, score, or device primitive from this skill. Use current Health Commons protocol lookup and ordinary calculation.

## Advisor flow

Classify the user's goal before giving protocol advice:

- `skin_photoaging`: skin texture, wrinkles, face/periocular masks, collagen/photoaging. Prefer the Health Commons skin photobiomodulation protocol and keep claims skin-specific.
- `localized_pain_recovery`: back, neck, joint, muscle soreness, injuries, return-to-play. Treat evidence as adjacent unless Health Commons has a direct matched protocol/source; screen for medical red flags.
- `whole_body_recovery_sleep`: whole-body panels, sleep quality, HRV/RHR, fatigue, recovery, general wellness. Use bounded experiment framing and avoid systemic benefit promises.
- `ambient_red_light_sleep`: red bulbs, night lights, sauna/chromotherapy light, or circadian lighting. Treat as a light-environment/sleep question, not PBM dose math.
- `brain_mood_cognition`: transcranial, intranasal, mood, TBI, dementia, focus, memory. Keep educational and clinician-guided unless a verified protocol directly matches.
- `hair_scalp`: hair loss or scalp devices. Ask for diagnosis and scalp-specific device evidence; do not borrow skin or whole-body dosing.
- `wound_or_medical_skin`: wounds, burns, ulcers, active rash, infection, psoriasis, eczema, scars, keloids. Default to safety triage and clinician guidance.
- `device_selection_or_comparison`: buying, choosing, or comparing devices. Ask use case, body area, contact-versus-panel format, exact model, official manual/irradiance chart, eye protection, return policy, and safety certifications. Do not rank products from affiliate/review claims.

Use evidence-fit language in answers:

- `direct_protocol`: close Health Commons protocol/source match.
- `adjacent_human`: relevant human PBM literature, but different device, body site, dose, or population.
- `safety_or_context`: useful for boundaries, not benefit claims.
- `intake_only`: PubMed/source discovery exists but has not been extracted into dosing or efficacy guidance.
- `unknown`: no usable Murph evidence yet.

## Intake

Ask only decision-changing gaps. The most useful missing items are:

- Goal or target: skin/photoaging, pain/recovery, sleep/circadian, hair, general wellness, or a specific condition.
- Device brand/model, form factor, wavelengths, and active mode or intensity level: red only, NIR only, combined, pulsed, or named setting.
- Irradiance at the user's actual treatment distance or contact setting, in `mW/cm2`, with source/provenance.
- Planned distance from skin, whether the device is contact/on-skin or free-standing, exposed body area, and front-only versus front-and-back exposure.
- Target dose from a verified protocol/source, in `J/cm2`, or a verified protocol session duration when no matched dose target exists.
- Frequency and timing constraints, including whether sessions happen near bedtime, after exercise, around heat/sauna/cold exposure, or near skincare actives/procedures.
- Safety flags: eye exposure, photosensitizing medication/supplement/topical, active cancer treatment, pregnancy, seizure/photosensitivity history, suspicious lesions, burns, neuropathy or reduced sensation, impaired circulation, darker-skin hyperpigmentation concerns, and heat intolerance.

If the user asks "how long should I do it?" and gives no device details, ask for the exact device model, goal/body area, intended distance or contact setting, and either a manufacturer/measured irradiance value at that setup. Do not ask for every item above before giving a useful next step.

Before calculating duration, make sure the answer has:

- goal or target use case;
- device brand and exact model;
- device form factor and active mode or intensity level;
- wavelengths;
- irradiance at the planned distance or contact setting in `mW/cm2`;
- planned skin distance or confirmed surface/contact geometry;
- target dose in `J/cm2` from a verified protocol or source, with a matching tissue/site context.

If any of those are missing, say what is missing and give the next practical step. If the irradiance distance, contact setting, active mode, or target tissue does not match the user's setup, do not calculate as if it matched.

## Dose math

Use this formula when dose and irradiance are both area-normalized:

```text
seconds = target dose J/cm2 * 1000 / irradiance mW/cm2
minutes = seconds / 60
```

This estimates incident skin-surface fluence, not absorbed dose in deeper tissue. For a dose range, calculate both endpoints. Example: `12 J/cm2` at `109 mW/cm2` is about `110 seconds`, or about `2 minutes`.

Use dose math only when:

- the dose is in `J/cm2`;
- irradiance is in `mW/cm2`;
- the irradiance reading matches the user's distance or contact setting;
- the reading matches the active channel/mode being used, especially when a panel reports combined red+NIR irradiance but the source dose is wavelength- or channel-specific;
- the target tissue and source context are close enough to the user's goal.

If the irradiance comes from a manufacturer claim, label the output as a manufacturer-claim duration estimate and round to practical precision, such as the nearest `15-30 seconds`, rather than implying lab-grade certainty.

If a product page also lists "dose after 30 min", sanity check it with `expected J/cm2 = irradiance mW/cm2 * 1800 / 1000`. If the page's dose line conflicts with the irradiance line, do not average them or combine them; mention the conflict and ask for the manual, irradiance chart, or current official page value.

Do not calculate from watts, number of LEDs, total joules, "50 J" or "80 J" treatment goals without exposed area, marketing coverage area, battery power, "clinical strength", or a reading measured at a different distance. Do not use inverse-square extrapolation for panels unless a verified measurement chart supports it.

## Device handling

Ask "what device do you have?" early when dosing depends on duration. Then:

- If the user gives a Bestqool model, first check the skill-local `device-seeds.json` next to this file. Treat it as manufacturer-claim seed data, not verified Health Commons evidence.
- Use the seed only for the exact model alias, device class, active mode, and distance/contact setting shown. Do not assume similarly named models are interchangeable, such as `BQ60` versus `BQ60Pro` or `Pro100` versus `Pro200`.
- If the seed says `deviceClass: panel`, use the listed reading only at the listed panel distance.
- If the seed says `deviceClass: contact_wrap` or `contact_mat`, treat the reading as a surface/contact reading tied to the listed intensity label. Do not convert it to a panel distance or reuse it for a different intensity setting.
- If the user has the device's irradiance chart, use the row for their actual distance, surface setting, or mode.
- If the user only has a model name, ask for the intended distance/contact setting and offer to check the official manufacturer page when browser/computer-use is available.
- If browser/computer-use is available and the user asks Murph to check the device online, use the browser workflow and treat product-page specs as manufacturer claims.
- If official specs are internally inconsistent, surface the mismatch and avoid dose math until the user supplies a manual/chart or a current page resolves it.
- If no current spec is available, give a range only as an example and clearly label it as not device-specific.

The seed file intentionally stores current official model-page values and caveats in JSON rather than prose. As of 2026-06-30, it includes Bestqool `BQ40`, `BQ60`, `BQ60Pro`, `BQ150`, `Pro100`, `Pro200`, `Pro300`, and `Redot S/M/L` manufacturer-claim examples. Use those only when the user is actually using that model with the listed distance or contact/intensity setting. Do not treat this skill as a broad device catalog; prefer the current official product page or a user-provided manual/irradiance chart.

Common brands worth checking by official model page when the user gives a device name: Hooga, Mito Red Light, Joovv, PlatinumLED BioMax, Red Light Man, Bon Charge, Omnilux, CurrentBody, Solawave, LightStim, HigherDOSE, Lumebox, Celluma, Kineon, and Therabody. Prefer official pages or user-provided manuals/irradiance charts over retailer listings, reviews, or blogs.

## Answer shape

For dosing answers, keep the response compact:

1. State the assumption, missing value, or provenance, including whether the value is a manufacturer claim.
2. Give the calculation when valid.
3. Give a conservative starting suggestion when appropriate, such as starting at the low end of a verified range and watching skin/eye/heat tolerance.
4. Name what would change the answer: goal, wavelength, dose target, distance/contact setting, device irradiance, body area, active mode, or safety flags.

Do not bury the user in study lists. If evidence matters, summarize the fit: direct protocol evidence, adjacent human evidence, safety/context evidence, intake-only evidence, or unknown. Mention exact PubMed details only when Health Commons source/protocol output provides them or the user asks.

Do not echo manufacturer disease, hormone, fat-loss, sleep, or recovery claims as Murph claims unless Health Commons evidence directly supports that specific claim for the user's context. FDA-cleared or certification language is not proof that a device is effective for the user's goal.

## Safety boundaries

- Eye exposure needs explicit caution. Do not recommend looking into panels, using NIR near the face without eye protection, or treating eyes without clinician guidance and eye-specific protocol evidence.
- Do not give disease-treatment instructions for cancer, eye disease, neuropathy, inflammatory disease, wound care, pregnancy, or medication-sensitive contexts. Suggest clinician guidance and keep any self-experiment low-risk and reversible.
- Stop or reduce exposure for burns, unusual pain, headache, eye symptoms, afterimages that do not promptly resolve, marked skin irritation, dizziness, worsening sleep, agitation, mood changes, or worsening symptoms.
- Heat is not the therapeutic dose. A warm panel, wrap, belt, or mat can still overdose skin if the session is too long or too close.
- Contact wraps and mats add heat, pressure, sweat, and unattended-use risk. Do not suggest sleeping with an active device, stacking heat sources, or running repeated cycles unattended unless the official manual explicitly supports that use and safety flags are absent.
- More is not automatically better; PBM can be biphasic, so higher dose or longer sessions can be less useful or more irritating.

Use stronger caution for: eye exposure, photosensitizing medication, supplements, or topicals; active cancer treatment; suspicious skin lesions; pregnancy; seizure/photosensitivity history; neurologic disease; head injury; active mood disorder or bipolar-spectrum history; neuropathy; reduced sensation; impaired circulation; darker-skin hyperpigmentation concerns; heat intolerance; open wounds; infection concerns; burns; ulcers; tattoos or irritated skin in the treatment area; or rapidly worsening skin conditions.

## Experiment handoff

Experiment setup is optional. If the user just wants help using a lamp today, answer the setup/dosing/safety question and stop. If the user wants Murph to track whether red light therapy works for them, first resolve the best Health Commons protocol family:

- skin/photoaging: look for the skin photobiomodulation protocol;
- whole-body recovery, sleep, HRV/RHR, or general wellness: look for the whole-body photobiomodulation protocol;
- sleep timing/light environment rather than panel exposure: look for evening light reduction protocols instead.

Then read and follow `$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md`. Preserve public protocol lineage and store user-specific device, distance/contact setting, dose, timing, safety answers, outcomes, and device-spec provenance such as source URL, checked date, model alias, active mode, and manufacturer-claim caveats as setup answers or typed experiment fields.
