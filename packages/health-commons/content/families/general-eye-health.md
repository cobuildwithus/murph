---
schemaVersion: murph.commons.page.v1
entityType: experiment_family
key: experiment_family:general-eye-health
slug: families/general-eye-health
title: General Eye Health
summary: Source-backed guidance for common eye-health questions, symptom urgency, contact-lens safety, screen discomfort, and refractive misconceptions.
status: reviewed
quality: usable
aliases:
  - eye health
  - eye symptoms
  - eye pain
  - red eye
  - vision changes
  - flashes and floaters
  - screen eye strain
  - dry eyes
  - contact lens safety
  - contact lens problem
  - chemical eye
  - chemical eye exposure
  - eye injury
  - eye trauma
  - myopia
  - nearsightedness
categories:
  - eye-health
  - vision
  - symptom-triage
  - contact-lenses
familyKind: modality
relations:
  - type: cites
    target: source_artifact:pmid-37062428
  - type: cites
    target: source_artifact:nei-dry-eye
  - type: cites
    target: source_artifact:cochrane-blue-light-filtering-lenses
  - type: cites
    target: source_artifact:pmid-35597519
  - type: cites
    target: source_artifact:nei-myopia
  - type: cites
    target: source_artifact:imi-myopia-interventions
  - type: cites
    target: source_artifact:cdc-contact-lens-prevention
  - type: cites
    target: source_artifact:cdc-contact-lens-infection-symptoms
  - type: cites
    target: source_artifact:nei-retinal-detachment
  - type: cites
    target: source_artifact:cdc-stroke-signs
  - type: cites
    target: source_artifact:medlineplus-eye-emergencies
  - type: cites
    target: source_artifact:nei-angle-closure-glaucoma
  - type: cites
    target: source_artifact:fda-eye-drops
claims:
  - claimId: digital-eye-strain-context
    type: evidence_scope
    text: Tired, dry, burning, gritty, watery, or intermittently blurry eyes after sustained near work can fit digital eye strain. Blinking, tear-film, refractive, binocular, glare, airflow, and workstation factors can contribute, so chat cannot establish one cause.
    strength: high
    sourceKeys:
      - source_artifact:pmid-37062428
      - source_artifact:nei-dry-eye
  - claimId: ordinary-screen-use-boundary
    type: evidence_scope
    text: Ordinary screen use can cause temporary fatigue or dryness, but these symptoms do not show permanent eye damage or prove that screens caused a refractive prescription.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-37062428
      - source_artifact:nei-healthy-vision
  - claimId: low-burden-screen-comfort
    type: design_guardrail
    text: For mild bilateral screen-linked discomfort without warning signs, use readable text, reduce glare, redirect direct airflow, keep a comfortable screen position, take brief symptom-led distance breaks, and make complete blinks. The exact 20-20-20 formula is a memory cue, not a proven treatment dose.
    strength: moderate
    sourceKeys:
      - source_artifact:nei-healthy-vision
      - source_artifact:osha-computer-monitors
      - source_artifact:pmid-36473088
  - claimId: artificial-tears-boundary
    type: design_guardrail
    text: Plain lubricating or artificial tears can be a cautious option for mild dryness, but no one over-the-counter formula is best for everyone. Contact-lens users should use only products labeled or clinician-recommended for their lenses, or remove the lenses first.
    strength: moderate
    sourceKeys:
      - source_artifact:nei-dry-eye
      - source_artifact:pmc-9840372
  - claimId: blue-light-filtering-lenses
    type: mixed_evidence
    text: Blue-light-filtering lenses are not established as a treatment for digital eye strain or as protection against retinal damage. A tint can remain a comfort preference without a therapeutic claim.
    strength: high
    sourceKeys:
      - source_artifact:cochrane-blue-light-filtering-lenses
      - source_artifact:pmid-35597519
  - claimId: eye-supplement-boundary
    type: evidence_scope
    text: Omega-3 and generic eye-vitamin products should not be routine advice for screen strain or ordinary eye health. AREDS2 has a narrow role for specific stages of clinician-diagnosed age-related macular degeneration.
    strength: high
    sourceKeys:
      - source_artifact:nih-dream-omega3-dry-eye
      - source_artifact:nei-areds2-faq
  - claimId: refractive-number-boundary
    type: evidence_scope
    text: A lens value such as -2.75 describes correction, not eye health, urgency, retinal condition, or the cause of symptoms. Chat cannot safely change lens power, brand, fit, base curve, or diameter.
    strength: high
    sourceKeys:
      - source_artifact:nei-myopia
      - source_artifact:fda-buying-contact-lenses
  - claimId: myopia-reversal-boundary
    type: mixed_evidence
    text: Eye exercises, intentional under-correction, and ordinary distance breaks are not established methods to reverse adult myopia. Pediatric myopia control is a separate clinician-led question.
    strength: high
    sourceKeys:
      - source_artifact:imi-myopia-interventions
  - claimId: sudden-vision-emergency
    type: safety
    text: Sudden partial or complete vision loss, a new field defect or dark curtain, new flashes, or a sudden increase in floaters needs emergency eye assessment now. Do not drive when vision is affected.
    strength: high
    sourceKeys:
      - source_artifact:nei-retinal-detachment
    caveats:
      - Stable, longstanding occasional floaters do not meet this emergency rule by themselves, but a new or suddenly increased pattern does.
  - claimId: severe-eye-pain-emergency
    type: safety
    text: Sudden severe or intense eye pain needs emergency assessment, including when it occurs with a red eye, blurred vision, halos, nausea, or vomiting.
    strength: high
    sourceKeys:
      - source_artifact:medlineplus-eye-pain
      - source_artifact:nei-angle-closure-glaucoma
  - claimId: neurologic-vision-emergency
    type: safety
    text: A sudden vision symptom with facial droop, one-sided weakness or numbness, trouble speaking, severe unexplained headache, marked dizziness, or loss of balance needs emergency services now.
    strength: high
    sourceKeys:
      - source_artifact:cdc-stroke-signs
  - claimId: chemical-and-penetrating-injury-first-aid
    type: safety
    text: For a corrosive, industrial, or unknown chemical splash or exposure, start gentle continuous irrigation with clean lukewarm water and arrange emergency help. For a penetrating injury or embedded object, do not rinse, rub, press, or remove it; protect the eye without pressure and get emergency care.
    strength: high
    sourceKeys:
      - source_artifact:medlineplus-eye-emergencies
  - claimId: blunt-trauma-and-procedure-action
    type: safety
    text: A significant direct blow to the eye needs prompt same-day eye care, even when initial pain and vision seem normal. New symptoms after eye surgery, an eye injection, or another recent eye procedure also need immediate contact with the treating team or same-day eye care.
    strength: high
    sourceKeys:
      - source_artifact:medlineplus-eye-emergencies
  - claimId: contact-lens-symptom-action
    type: safety
    text: A contact-lens wearer with pain, redness, light sensitivity, a new vision change, marked tearing, discharge, or persistent foreign-body sensation should remove the lenses, use backup glasses, and get prompt same-day eye care. Do not reinsert the lenses until an eye clinician says it is safe.
    strength: high
    sourceKeys:
      - source_artifact:cdc-contact-lens-infection-symptoms
      - source_artifact:nei-contact-lenses
  - claimId: contact-lens-water-and-sleep
    type: safety
    text: Do not sleep in contact lenses unless the prescribing clinician directed it, and do not expose lenses to shower, swimming, hot-tub, tap, bottled, or distilled water. Never use saliva, homemade saline, reused solution, or topped-off solution.
    strength: high
    sourceKeys:
      - source_artifact:cdc-contact-lens-prevention
      - source_artifact:nei-contact-lenses
    caveats:
      - After water exposure, remove lenses as soon as possible. Discard daily disposables; clean and disinfect reusable lenses exactly as their instructions require.
  - claimId: persistent-eye-symptom-review
    type: safety
    text: Persistent, recurring, worsening, one-sided, function-limiting, or non-screen-linked eye symptoms need an eye examination. Pain, marked redness, light sensitivity, discharge, trauma, or a new persistent vision change lowers the threshold to same-day care.
    strength: high
    sourceKeys:
      - source_artifact:medlineplus-eye-pain
      - source_artifact:nei-contact-lenses
  - claimId: eye-exam-destination
    type: design_guardrail
    text: Active symptoms or known medical risk call for a medical eye visit. Asymptomatic general vision or prevention usually calls for a routine comprehensive eye or vision examination; current contact-lens wear adds contact-lens evaluation to that same service.
    strength: moderate
    sourceKeys:
      - source_artifact:nei-healthy-vision
      - source_artifact:nei-contact-lenses
  - claimId: medicated-eye-drop-boundary
    type: safety
    text: Do not use borrowed, leftover, or unprescribed antibiotic, steroid, anesthetic, glaucoma, redness-relief, or other medicated eye drops. Pain, redness, discharge, light sensitivity, or a vision change needs assessment rather than more drops.
    strength: high
    sourceKeys:
      - source_artifact:fda-eye-drops
---

This page is public eye-health knowledge. It is not a diagnosis and does not require a protocol or experiment.

Murph should match the member's complete question to the most relevant evidence or safety item. Urgent safety guidance takes priority over comfort advice.
