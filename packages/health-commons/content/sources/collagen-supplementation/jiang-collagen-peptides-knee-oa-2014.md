---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:jiang-collagen-peptides-knee-oa-2014
slug: sources/collagen-supplementation/jiang-collagen-peptides-knee-oa-2014
title: 'Collagen peptides improve knee osteoarthritis in elderly women: a 6-month randomized, double-blind, placebo-controlled study'
summary: A small elderly-women knee-OA trial reports pain and mobility improvements with 8 g/day collagen peptides over six months.
status: draft
quality: usable
aliases:
- Jiang 2014 Peptan knee osteoarthritis
- Peptan B2000 elderly women knee OA trial
categories:
- collagen-supplementation
- joint-osteoarthritis
- direct_protocol
- supports-protocol
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: url
  identifiers:
    url: https://www.teknoscienze.com/tks_article/collagen-peptides-improve-knee-osteoarthritis-in-elderly-womena-6-month-randomized-double-blind-placebo-controlled-study/
  canonicalUrl: https://www.teknoscienze.com/tks_article/collagen-peptides-improve-knee-osteoarthritis-in-elderly-womena-6-month-randomized-double-blind-placebo-controlled-study/
  identityAliases:
  - Jiang 2014 Peptan knee osteoarthritis
  - Peptan B2000 elderly women knee OA trial
  - 'Collagen peptides improve knee osteoarthritis in elderly women: a 6-month randomized, double-blind, placebo-controlled study'
source:
  kind: journal_article
  title: 'Collagen peptides improve knee osteoarthritis in elderly women: a 6-month randomized, double-blind, placebo-controlled study'
  authors: Jiang JX; Yu S; Huang QR; Zhang XL; Zhang CQ; Zhou JL; Prawitt J
  citation: 'Jiang JX, Yu S, Huang QR, et al. Collagen peptides improve knee osteoarthritis in elderly women: a 6-month randomized, double-blind, placebo-controlled study. Agro Food Industry Hi Tech. 2014;25(2):19-23.'
  year: 2014
  journal: Agro Food Industry Hi Tech
  url: https://www.teknoscienze.com/tks_article/collagen-peptides-improve-knee-osteoarthritis-in-elderly-womena-6-month-randomized-double-blind-placebo-controlled-study/
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Prospective randomized, double-blind, placebo-controlled study
  populationLabel: Elderly women with mild-to-moderate knee osteoarthritis; available extracts describe Kellgren-Lawrence grades 0/I to III and exclusion of grade IV.
  durationLabel: 6 months
  cohortKey: collagen-supplementation/jiang-collagen-peptides-knee-oa-2014
  participantCount: 46
  participantCountKind: reported
  aggregateRole: primary
evidenceBucket: joint-osteoarthritis
whyItMatters: It directly matches the protocol ingredient and knee-OA outcome domain, and it fills the 6-month dose-duration evidence slot.
potentialMurphEndpoints:
- WOMAC
- Lysholm score
- joint pain
- physical mobility
- safety
protocolTakeaway: 8 g/day collagen peptides for six months is a direct but small and source-limited knee-OA signal.
murphTakeaway: Track WOMAC/Lysholm-like pain and mobility outcomes if replicating a similar dose-duration pattern.
studyDesign: Prospective randomized, double-blind, placebo-controlled study
modality: oral collagen peptides
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: permission_required
ledgerClassification:
  evidenceBucket: joint-osteoarthritis
  directness: direct_protocol
  claimUse: supports-protocol
  priority: backbone
  batchId: batch-002
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: permission_required
---

This source is included for **joint-osteoarthritis**.

**Findings:**

- **dose — Dose and duration:** Jiang 2014 provides a direct knee-OA dose-duration signal at 8 g/day for six months. Effect/direction: 8 g/day collagen peptides for 6 months.
- **outcome — WOMAC/Lysholm joint pain and mobility:** Elderly women with mild-to-moderate knee OA reportedly improved on WOMAC/Lysholm outcomes. Effect/direction: Positive direction; accessible extracts state significant pain reduction and mobility improvement, without fully extracted effect sizes.
- **safety — Adverse events / side effects:** Safety signal is reassuring but low-detail. Effect/direction: Accessible snippets describe absence of side effects, but AE counts were not extracted.
- **population — Generalizability:** Population fit is direct for knee OA but sex- and age-restricted. Effect/direction: Women-only elderly knee-OA population.

**Why it matters:** It directly matches the protocol ingredient and knee-OA outcome domain, and it fills the 6-month dose-duration evidence slot.

**Potential experiment signals:** WOMAC, Lysholm score, joint pain, physical mobility, safety.

**Protocol takeaway:** 8 g/day collagen peptides for six months is a direct but small and source-limited knee-OA signal.

**Murph takeaway:** Track WOMAC/Lysholm-like pain and mobility outcomes if replicating a similar dose-duration pattern.

**Claim use:** `supports-protocol`.

**Directness and boundary:** `direct_protocol`. Direct knee-OA population, but sex- and age-restricted to elderly women.

**Safety notes:** Accessible publisher/PDF snippets describe absence of side effects, but adverse-event counts were not extractable.

**Limitations:**

- Non-PubMed, industry-adjacent source; exact randomization, attrition, and effect sizes need primary PDF verification.
- Women-only elderly population may not generalize to younger active users or men.

**Artifact rights:** `permission_required`. Do not store copyrighted PDFs in Git unless open-redistribution rights are confirmed.
