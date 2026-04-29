---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:facebook-bryan-johnson-sweat-electrolytes-2025-05-14
slug: sources/dry-sauna/facebook-bryan-johnson-sweat-electrolytes-2025-05-14
title: My body sweats 18 oz during a 20 min sauna at 200°F
summary: Facebook post/snippet reporting Johnson’s self-measured sweat output and sodium loss during a 20-minute 200°F sauna; full post text was not available in the provided snapshot, so use is limited to hydration/electrolyte context.
status: draft
quality: usable
aliases:
- Bryan Johnson sweat electrolytes Facebook
- 20 min sauna 18 oz sweat 200°F
categories:
- dry-sauna
- bryan-johnson-blueprint
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: web_page
  title: My body sweats 18 oz during a 20 min sauna at 200°F
  authors: Bryan Johnson
  year: 2025
  journal: Facebook
  citation: Johnson B. My body sweats 18 oz during a 20 min sauna at 200°F. Facebook post. Posted May 14, 2025.
  url: https://facebook.com/bryanjohnsonblueprint/posts/664697209872038
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 532959734d181c3ac1563b400d464b4236c528a5bdf843e802d3372675976edc
    url: https://facebook.com/bryanjohnsonblueprint/posts/664697209872038
  canonicalUrl: https://facebook.com/bryanjohnsonblueprint/posts/664697209872038
researchEvidence:
  designKind: single_person_report
  designLabel: Social-post single-person hydration/electrolyte report
  populationLabel: Bryan Johnson; adult male self-tracker
  durationLabel: One or more 20-minute 200°F sauna sessions; exact sampling schedule not available
  aggregateRole: primary
  cohortKey: facebook-bryan-johnson-sweat-electrolytes-2025-05-14
  participantCount: 1
  participantCountKind: reported
evidenceBucket: Direct external-protocol provenance and self-experiment claims
whyItMatters: Adds source-owned context for mineral-supplemented rehydration without turning a social snippet into validated sweat science.
potentialMurphEndpoints:
- fluid replacement
- electrolyte replacement
- headache/dizziness symptoms
- body mass change
protocolTakeaway: Use as context for hydration tracking; do not claim a general sodium-loss amount for users.
murphTakeaway: Useful for prompting hydration and electrolyte logging, but not for dosing claims.
studyDesign: Snippet-limited n=1 social-post report
modality: Dry sauna hydration/electrolyte context
claimUse: context-only
sourceFindings:
- findingId: finding:facebook-bryan-johnson-sweat-electrolytes-2025-05-14-sweat-sodium
  sourceKey: source_artifact:facebook-bryan-johnson-sweat-electrolytes-2025-05-14
  extractedFromArtifactId: art_facebook_bryan_johnson_sweat_electrolytes_2025_05_14_web
  findingKind: context
  population: Bryan Johnson; adult male self-tracker.
  exposure: 20-minute sauna at 200°F with reported sweat output and sodium concentration.
  outcome: Hydration/electrolyte context; reported sweat loss 18 oz and sodium concentration 25–39 mg/oz, implying about 450–700 mg sodium loss.
  summary: The Facebook-source snippet reports that Johnson’s body sweats 18 oz during a 20-minute 200°F sauna, with sodium concentration of 25–39 mg/oz and 450–700 mg sodium loss per session. Full post text was not available in the snapshot, so extraction is snippet-limited.
  evidenceUse:
  - context
  - safety
murphV1Priority: Low
pdfRightsStatus: unknown
sourceIndexResolution:
  sourceIndexStatus: absent_from_uploaded_repo_snapshot
  identityResolutionStatus: new_source
  canonicalSourceKey: null
  ledgerNotes: 'Generated source-index.json was absent from repo.snapshot; resolved against available source pages/artifact manifests and candidate identities only. Candidate shards: 02-discovery-direct-external-protocol.'
---

This source is included for **Direct external-protocol provenance and self-experiment claims**.

**Findings:** The available snippet reports sweat volume and sodium concentration/loss during a 20-minute 200°F sauna.

**Why it matters:** It supports hydration/electrolyte logging as an implementation concern.

**Potential experiment signals:** body-mass change, fluid intake, electrolyte intake, dizziness, headache, cramps, and thirst.

**Protocol takeaway:** Keep as context only; do not generalize Johnson’s sodium-loss amount to other users.

**Claim use:** `context-only`.
