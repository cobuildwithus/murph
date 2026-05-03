{{SHARED_HEADER}}

TASK: Build the Health Commons protocol package.

Inputs:
- Charter from: {{CHARTER_SOURCE}}
- Canonical source ledger from: {{CANONICAL_LEDGER_SOURCE}}
- All source page drafts from: {{SOURCE_PAGE_DRAFTS_SOURCE}}
- Section synthesis outputs from: {{SECTION_SYNTHESIS_SOURCE}}
- Artifact candidates from: {{ARTIFACT_CANDIDATES_SOURCE}}
- SOURCE_FINDINGS_V1 and EVIDENCE_APPRAISALS_V1 outputs from extraction
- Generated source index: packages/health-commons/generated/source-index.json
- Existing Health Commons examples

Goal:
Draft the actual Health Commons files for {{PROTOCOL_NAME}}. Produce a landing-ready package, but do not skip citation, safety, or schema checks.

Files to draft:
1. packages/health-commons/content/families/{{FAMILY_SLUG}}.md, if missing
2. packages/health-commons/content/protocols/{{FAMILY_SLUG}}/{{PROTOCOL_SLUG}}.md
3. packages/health-commons/content/sources/{{FAMILY_SLUG}}/*.md
4. packages/health-commons/content/artifacts/{{FAMILY_SLUG}}/research-artifacts.json
5. packages/health-commons/content/evidence-appraisals/source-protocol-evidence/{{FAMILY_SLUG}}.jsonl
6. redirects or disambiguation page updates, if needed
7. missing biomarker pages only if genuinely absent and necessary
8. experimentOnboarding block if this protocol is intended to power Murph experiment creation

Protocol page requirements:
- one-sentence frontmatter `summary:` directly below `title:`
- aliases
- categories
- parent family relation
- biomarker relations
- minimal foundational relations; claims, researchLandscape groups, and evidence appraisal edges carry source references
- lineage
- attribution
- protocol block:
  - doseSignature
  - target
  - frequency
  - duration or intensity or temperature where relevant
  - intervention session minimum or target
  - human-readable steps
  - tips
  - keepInMind
  - logFields
  - stopConditions
- expectedSignalDescriptions with `expectedDirection` on every signal that has a numeric `estimatedChange` (see shared-header for direction-matching rules)
- at least one testPlan
- experimentOnboarding when the protocol should be runnable in Murph
- whyItWorks (see copy guidelines below)
- mechanismChain (see copy guidelines below)
- claims
- researchLandscape
- safety

whyItWorks copy guidelines:
- Each item is a markdown string starting with an `## H2` header followed by a body paragraph.
- Headers are direct claims, not cautious observations. Drop leading "The" when possible. Drop hedge words like "can" or "may" — state the mechanism. Good: `## Recovery keeps the next rep useful`. Bad: `## The recovery can keep the next rep useful`.
- Use numerals (4, 3) instead of spelling out numbers.
- Body paragraphs use plain, consistent prose — no mixed fonts or special first-paragraph treatment.
- Keep paragraphs short (2–4 sentences). Each paragraph should explain one link in the causal chain.
- The section should read as a top-to-bottom explanation: what the dose is → what happens acutely → why repeating it matters → what adapts over time.

mechanismChain copy guidelines:
- The mechanism chain renders as a numbered vertical stepper under the heading "How the Body Adapts" on the protocol page.
- Each step has a `label` (rendered as an uppercase section label) and a `content` string (rendered as body text).
- Use 3–4 steps. Prefer 3 when the causal chain is simple. The typical shape is: Session → Acute physiology → Adaptation. Add a middle step only when there is a distinct bridging mechanism worth calling out.
- Do NOT include an "Outcome" step — outcomes are already shown in the expected signals section.
- Labels should be short noun phrases: "Session", "Acute physiology", "Heat load", "Adaptation". Not full sentences.
- Content should be scannable fragments separated by middot (·) or semicolons, not full prose sentences. Good: `Heart pumps near capacity; working muscle pulls hard on oxygen`. Bad: `The heart pumps near its maximum capacity while the working muscles pull hard on available oxygen supplies.`
- Capitalize the first word of each content string.
- Use numerals and symbols for density: `4 × (4′ hard · 3′ easy)`, `HR 85–95% HRmax`, `3×/week`.
- The adaptation step should say what physically changes, not just list body parts. Good: `heart pumps more per beat · more capillaries · muscles build more and stronger mitochondria`. Bad: `stroke volume · capillaries · mitochondria`.

Tips copy guidelines (protocol.tips):
- Tips is the "Good Practices" section. It is execution advice — what to do so the protocol goes smoothly. It is not evidence summary, safety screening, or generic experiment hygiene.
- Write up to 6 tips. Not every protocol needs 6; write only as many as the protocol warrants.
- Every tip must be protocol-specific. If the sentence works for sauna, fasting, creatine, meditation, and sleep, rewrite it.
- Write for the moment of action. Cover the main phases relevant to the protocol: before → first dose/session → during → exit/recovery → common trap → measurement/logging. Skip phases that add nothing.
- Keep each tip under 21 words. Short enough to scan, concrete enough to act.
- Aim for: action + specific examples + boundary. Example: `Break with a small meal: soup, eggs, yogurt, tofu, fish, rice, oats, potatoes, or cooked vegetables.`
- Prefer concrete examples over concepts. Users remember objects and situations, not abstractions. Bad: `Choose a gentle refeed.` Good: `Break with soup, eggs, yogurt, tofu, fish, rice, oats, potatoes, or cooked vegetables.`
- Do not restate the safety section. No contraindications, clinician routing, red flags, or full stop rules here.
- Do not restate the evidence section. No efficacy claims, mechanistic claims, or study caveats unless they directly change behavior. Bad: `Ketones rise as glycogen falls.` Good: `Do not extend for ketones, scale drops, or willpower.`
- Name the common failure modes for this protocol. The best tips prevent predictable mistakes.
- Use clean command language: eat, skip, start, stop, log, avoid, break, keep, choose. No soft filler: "try to," "consider," "it may be helpful," "in general," "where possible," "be mindful of."
- Make "don't stack" advice protocol-specific. Bad: `Avoid other experiments.` Good: `Skip sauna, hard workouts, alcohol, and long travel during the fast.`
- Include one measurement trap when users are likely to misinterpret a signal. Example: `Do not extend for ketones, scale drops, or willpower.` or `Expect scale weight to rise after creatine; log strength, not just weight.`
- Do not moralize. No discipline, willpower, detox, punishment, earning, cheating, or "pushing through" framing.
- Quality check before shipping: (1) Could this exact tip appear on five unrelated protocols? If yes, rewrite. (2) Can a user act on this after reading it once? If no, make it more concrete.

Safety section formatting:
- `safety.cautionLevel`: use `low`, `high`, or omit (defaults to moderate).
- `safety.avoidOrGetClinicianGuidance`: a list of short unquoted snake_case tokens, one condition per item. Each token renders as a compact pill in the UI, so it must fit on a single line (~3-6 words, under 50 characters). Never write long prose sentences or comma-separated condition lists here. Split compound conditions into separate tokens.
  Good: `pregnancy_or_early_postpartum`, `heart_failure`, `diabetes`, `seizure_disorder`
  Bad: `"pregnancy, possible pregnancy, trying to become pregnant, early postpartum, or active fertility concerns"`
  Bad: `unstable_cardiovascular_disease_recent_cardiac_event_unexplained_chest_pain_serious_arrhythmia_heart_failure` (compound — split into separate tokens)
- `safety.stopIf`: same format as avoidOrGetClinicianGuidance — short unquoted snake_case tokens, one symptom per item. Each renders as its own "Stop if:" precaution line with an icon.
  Good: `chest_pain_or_pressure`, `faintness`, `severe_dizziness`, `confusion`
  Bad: `"chest pain, faintness, severe dizziness, confusion, or palpitations"` (these must be separate items)
- `safety.notes`: short, action-first precaution bullets. Each note renders as a single line with an icon in the Precautions card. Aim for ~50-80 characters (8-15 words). Lead with the action or key fact. Cut hedging language ("may need", "if X is a concern", "people who"). Use em dashes (—) to connect related clauses. Do not include source artifact keys or citation references in notes.
  Good: `Wellness experiment, not a treatment plan.`
  Good: `Skip sessions when ill, febrile, or recovering from infection.`
  Good: `HR-limiting meds can distort zone targets — get clinician guidance on intensity.`
  Bad: `This is a bounded wellness self-experiment, not a treatment plan for any medical condition.`
  Bad: `People on heart-rate-limiting medication may need clinician-guided intensity targets because HR zones can be misleading.`

User-facing prose hygiene:
- User-facing Health Commons Markdown prose must not contain raw `source_artifact:*` tokens, `sourceKeys`, source-key labels, or source-ID footnotes.
- This applies to protocol, family, and biomarker pages, including any missing biomarker pages drafted for the package.
- This includes summaries, steps, tips, keepInMind, whyItWorks, safety, family overview, non-claims, and explanatory paragraphs.
- Never write visible labels such as `Source keys:`, `Source key:`, `Citation key:`, `Citation keys:`, `Source artifact:`, or backticked `source_artifact:*` references in user-facing copy.
- Do not include `Source basis:`, `Sources: source_artifact:...`, `Safety basis: source_artifact:...`, or similar internal source-key footnotes in user-facing protocol copy, biomarker descriptions, safety notes, or explanatory prose.
- Preserve source keys in structured frontmatter/JSONL fields only: relations, `claims.sourceKeys`, `researchLandscape.groups.sourceKeys`, source findings, evidence appraisals, and artifact manifests.
- If prose needs attribution, use readable source-card/study references rather than internal keys.
- Before returning the draft, scan every generated Markdown prose field and rewrite any source-key spillover into plain user-facing wording while keeping provenance in structured fields.
- Protocol frontmatter `summary:` is the field immediately below `title:` and is shown as the `/experiments` card description. Generate it using `agent-docs/product-specs/protocol-summary-copy.md` as the source of truth.

Output:

## File manifest
Table with path, create or update, and purpose.

## Draft protocol page
Complete Markdown.

## Draft family page
Complete Markdown or "no change needed."

## Source pages
List all source pages and whether each is:
- new
- update existing
- skip or already present

## Evidence appraisals
Complete JSONL records for standalone protocol-specific appraisal edges.

## Artifact manifest
Complete JSON draft with rights-safe defaults.

## Non-claims
List tempting claims that should not be made.

Rules:
- No claim without source keys in structured source-key fields.
- Do not emit `protocolEvidence`; write standalone evidence-appraisal records for protocol-specific interpretation.
- Reuse existing sourceKeys from the generated source index instead of creating duplicate source pages.
- Keep external named protocols separate from Murph canonical protocols.
- Keep adjacent variants separate or clearly labeled.
- Make the steps human-actionable, not metadata repeated in prose.
- Do not make the protocol frontmatter `summary:` below `title:` duplicate card metadata such as experiment length, session frequency, or dose timing.
- Keep safety stronger than efficacy when evidence is uncertain.
