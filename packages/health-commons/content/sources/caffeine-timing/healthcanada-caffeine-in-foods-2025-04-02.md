---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:healthcanada-caffeine-in-foods-2025-04-02
slug: sources/caffeine-timing/healthcanada-caffeine-in-foods-2025-04-02
title: Caffeine in Foods
summary: Health Canada provides a source table for caffeine in coffee, decaf coffee, tea, cola, and chocolate/cocoa products, giving implementation support for all-source caffeine dose logs.
status: draft
quality: usable
aliases:
- Caffeine in Foods
- source_artifact:healthcanada-caffeine-in-foods-2025-04-02
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: guideline
  title: Caffeine in Foods
  authors: Health Canada
  year: 2025
  journal: Canada.ca / Health Canada
  citation: 'Health Canada. Caffeine in Foods. Canada.ca / Health Canada. 2025. URL: https://www.canada.ca/en/health-canada/services/food-nutrition/food-safety/food-additives/caffeine-foods.html.'
  url: https://www.canada.ca/en/health-canada/services/food-nutrition/food-safety/food-additives/caffeine-foods.html
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: b7d7ff75605ec72605a1b0931b4e6525ed05e0d498402dfd08aa55470a31405f
    url: https://www.canada.ca/en/health-canada/services/food-nutrition/food-safety/food-additives/caffeine-foods.html
  canonicalUrl: https://www.canada.ca/en/health-canada/services/food-nutrition/food-safety/food-additives/caffeine-foods.html
researchEvidence:
  designKind: guideline
  designLabel: Health Canada caffeine source and intake guidance
  populationLabel: General consumers, adults, pregnant people, children, and adolescents referenced by Health Canada guidance.
  durationLabel: Guidance page; no follow-up period.
  aggregateRole: primary
  cohortKey: healthcanada-caffeine-foods-table
  notes:
  - 'Intervention or exposure: Caffeine in coffee, decaf coffee, tea, soft drinks, chocolate/cocoa foods, energy products, and natural caffeine-containing botanicals.'
  - 'Comparator or control: Not applicable.'
  - 'Endpoints: Daily caffeine dose, source identification, maximum intake boundaries.'
  - 'Effect or direction: Health Canada lists natural caffeine sources such as tea, coffee, chocolate, kola, guarana, and yerba mate; provides maximum intake guidance; and tabulates caffeine amounts across coffee, decaf, tea, cola, and chocolate/cocoa foods.'
  - 'Adverse events or safety notes: Guidance includes maximum caffeine intake recommendations for adults and other population groups, making it a safety-boundary source rather than a trial.'
  - 'Population mismatch: Source/dose guidance only; no 14-day caffeine-curfew intervention.'
  - 'Limitations: Jurisdiction-specific guidance and approximate food-table values; product-specific labels may differ.'
evidenceBucket: caffeine_source_dose_audit
whyItMatters: The page helps avoid missed caffeine from decaf beverages and cocoa/chocolate products while keeping small-dose foods in proportion.
potentialMurphEndpoints:
- daily caffeine dose
- hidden caffeine source count
- source-fidelity checklist
- adverse caffeine symptoms
protocolTakeaway: Use Health Canada tables as a quick source-estimation aid for coffee, decaf, tea, cola, cocoa, and chocolate when participants cannot identify exact product mg.
murphTakeaway: Decaf and chocolate are not always zero-caffeine; estimate them transparently and distinguish small hidden doses from major beverage doses.
studyDesign: guideline
modality: official-caffeine-foods-table
claimUse: supports-protocol
sourceFindings:
- findingId: finding:healthcanada-caffeine-in-foods-2025-04-02-food-source-table
  sourceKey: source_artifact:healthcanada-caffeine-in-foods-2025-04-02
  extractedFromArtifactId: art_healthcanada_caffeine_in_foods_2025_04_02_html
  findingKind: context
  population: General consumers.
  exposure: Caffeine-containing foods and beverages including decaf, cocoa, chocolate, tea, coffee, and cola.
  outcome: Estimated caffeine source/dose table.
  summary: Health Canada provides a source table for caffeine in coffee, decaf coffee, tea, cola, and chocolate/cocoa products, giving implementation support for all-source caffeine dose logs.
  evidenceUse:
  - measurement
  - context
- findingId: finding:healthcanada-caffeine-in-foods-2025-04-02-max-intake-boundaries
  sourceKey: source_artifact:healthcanada-caffeine-in-foods-2025-04-02
  extractedFromArtifactId: art_healthcanada_caffeine_in_foods_2025_04_02_html
  findingKind: safety
  population: Adults and special populations described in Health Canada guidance.
  exposure: Daily caffeine intake.
  outcome: Maximum intake guidance.
  summary: Health Canada gives maximum caffeine intake recommendations by population group, supporting safety-boundary language rather than direct curfew efficacy claims.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **caffeine_source_dose_audit**.

**Findings:** Health Canada provides a source table for caffeine in coffee, decaf coffee, tea, cola, and chocolate/cocoa products, giving implementation support for all-source caffeine dose logs. Health Canada gives maximum caffeine intake recommendations by population group, supporting safety-boundary language rather than direct curfew efficacy claims.

**Why it matters:** The page helps avoid missed caffeine from decaf beverages and cocoa/chocolate products while keeping small-dose foods in proportion.

**Potential experiment signals:** daily caffeine dose, hidden caffeine source count, source-fidelity checklist, adverse caffeine symptoms.

**Protocol takeaway:** Use Health Canada tables as a quick source-estimation aid for coffee, decaf, tea, cola, cocoa, and chocolate when participants cannot identify exact product mg.

**Claim use:** `supports-protocol`.
