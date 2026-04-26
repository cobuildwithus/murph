---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:endotext-dietary-advice-diabetes-2024-04-28
slug: sources/added-sugar-reduction/endotext-dietary-advice-diabetes-2024-04-28
title: Dietary Advice For Individuals with Diabetes
summary: Diabetes guidance anchors medication and hypoglycemia risk language, especially for people using insulin or fixed glucose-lowering regimens.
status: draft
quality: usable
aliases:
- candidate:safety-and-burden:027
categories:
- added-sugar-reduction
relations:
-
  type: related_protocol
  target: protocol_variant:added-sugar-reduction/no-added-sugar-diet
-
  type: parent_family
  target: experiment_family:added-sugar-reduction
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    url: https://www.ncbi.nlm.nih.gov/books/NBK279012/
  canonicalUrl: https://www.ncbi.nlm.nih.gov/books/NBK279012/
source:
  kind: review
  title: Dietary Advice For Individuals with Diabetes
  authors: Reynolds A, Mitri J
  year: 2024
  journal: Endotext / NCBI Bookshelf
  url: https://www.ncbi.nlm.nih.gov/books/NBK279012/
  citation: Reynolds A, Mitri J. Dietary Advice For Individuals with Diabetes. Endotext / NCBI Bookshelf. 2024. https://www.ncbi.nlm.nih.gov/books/NBK279012/.
researchEvidence:
  designKind: narrative_review
  designLabel: Narrative review
  populationLabel: People with diabetes
  durationLabel: 2024 Endotext chapter
  aggregateRole: context
  cohortKey: source:endotext-dietary-advice-diabetes-2024-04-28
evidenceBucket: safety-special-populations
directness: safety_boundary
claimUse: safety-only
murphV1Priority: high
artifactRightsStatusGuess: open_access
whyItMatters: Practical clinical review for hypoglycemia-risk boundary, especially for insulin or fixed medication regimens.
potentialMurphEndpoints:
- safety
- adherence
- burden
protocolTakeaway: For diabetes, especially insulin or sulfonylurea use, added-sugar reduction should be individualized with medication and hypoglycemia planning.
murphTakeaway: Safety prompts should ask about diabetes medications and hypoglycemia before presenting strict food rules.
claimUseBoundary: Safety-only diabetes boundary; not efficacy evidence.
populationMismatch: People with diabetes; not all no-added-sugar users.
limitations:
- No effect size or adverse-event frequency for no-added-sugar was extracted.
- Clinical advice may vary by diabetes type, medication, and glycemic targets.
safetyNotes: Flag hypoglycemia treatment and medication-supervision needs; do not treat emergency glucose as protocol failure.
modality: Clinical diabetes nutrition advice
studyDesign: Narrative review
---

This source is included for **safety-special-populations**.

## Quick read

- **Source type:** Narrative review.
- **People studied or addressed:** People with diabetes.
- **Duration or horizon:** 2024 Endotext chapter.
- **Protocol role:** safety-only; directness: `safety_boundary`.

## What it contributes

For diabetes, especially insulin or sulfonylurea use, added-sugar reduction should be individualized with medication and hypoglycemia planning.

## Potential Murph endpoints

safety, adherence, burden

## Important limits

- Population boundary: People with diabetes; not all no-added-sugar users.
- No effect size or adverse-event frequency for no-added-sugar was extracted.
- Clinical advice may vary by diabetes type, medication, and glycemic targets.
- Safety note: Flag hypoglycemia treatment and medication-supervision needs; do not treat emergency glucose as protocol failure.

## Plain-language takeaway

Safety prompts should ask about diabetes medications and hypoglycemia before presenting strict food rules.
