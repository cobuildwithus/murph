---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:acc-sport-supplements-rosuvastatin-2022-11-06"
slug: "sources/red-yeast-rice/acc-sport-supplements-rosuvastatin-2022-11-06"
title: "Commonly Used Dietary Supplements Not Effective at Reducing Cholesterol Compared to Placebo"
summary: "ACC coverage of the SPORT randomized trial reported that low-dose rosuvastatin lowered LDL-C compared with placebo while commonly used supplements, including a red yeast rice arm, did not significantly lower LDL-C versus placebo over 28 days."
status: "draft"
quality: "usable"
aliases:
  - "SPORT ACC press release; supplements vs rosuvastatin"
  - "SPORT trial ACC coverage"
categories:
  - "red-yeast-rice"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "web_page"
  title: "Commonly Used Dietary Supplements Not Effective at Reducing Cholesterol Compared to Placebo"
  authors: "American College of Cardiology"
  year: 2022
  journal: "American College of Cardiology press release"
  citation: "American College of Cardiology. Commonly Used Dietary Supplements Not Effective at Reducing Cholesterol Compared to Placebo. Published November 6, 2022."
  url: "https://www.acc.org/about-acc/press-releases/2022/11/06/14/16/commonly-used-dietary-supplements-not-effective-at-reducing-cholesterol-compared-to-placebo"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "9b6fa42a8bb33c7465b03cfa9dd8ac421297b9770281a973293bbac7b0d06d2d"
    url: "https://www.acc.org/about-acc/press-releases/2022/11/06/14/16/commonly-used-dietary-supplements-not-effective-at-reducing-cholesterol-compared-to-placebo"
  canonicalUrl: "https://www.acc.org/about-acc/press-releases/2022/11/06/14/16/commonly-used-dietary-supplements-not-effective-at-reducing-cholesterol-compared-to-placebo"
researchEvidence:
  designKind: "other"
  designLabel: "Press coverage of a randomized trial comparing rosuvastatin, placebo, and six supplement arms"
  participantCount: 190
  participantCountKind: "reported"
  populationLabel: "Adults without known ASCVD, with LDL-C 70-189 mg/dL and increased 10-year ASCVD risk, as described for the SPORT trial."
  durationLabel: "28 days in the underlying SPORT trial"
  aggregateRole: "primary"
  cohortKey: "sport-rct-web-coverage"
evidenceBucket: "Adjacent combinations and special-population evidence"
whyItMatters: "This is a modern supervised comparator context showing that a commercial red yeast rice supplement arm did not outperform placebo in a short lipid-marker trial, while the statin arm did."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "triglycerides"
  - "HDL-C"
  - "adverse events"
protocolTakeaway: "Use only as context for a supervised SPORT trial and not as a direct claim about all red yeast rice products; it is press coverage and duplicates the primary SPORT publication context."
murphTakeaway: "For Murph, this is a cautionary comparator signal: a specific marketed red yeast rice supplement arm in SPORT did not show a placebo advantage over 28 days."
studyDesign: "web_page_about_randomized_trial"
modality: "clinical_supervised nutraceutical comparator context"
claimUse: "context-only"
sourceFindings:
  -
    findingId: "finding:acc-sport-supplements-rosuvastatin-2022-11-06-sport-null-comparator"
    sourceKey: "source_artifact:acc-sport-supplements-rosuvastatin-2022-11-06"
    findingKind: "context"
    population: "Adults in the SPORT randomized trial without known ASCVD, with LDL-C 70-189 mg/dL and increased 10-year ASCVD risk."
    exposure: "Red yeast rice dietary supplement arm and other supplement arms compared with placebo and rosuvastatin 5 mg."
    outcome: "LDL-C change and adverse event context after 28 days."
    summary: "ACC coverage reported that no tested dietary supplement, including red yeast rice, significantly lowered LDL-C compared with placebo, whereas rosuvastatin produced a substantially greater LDL-C reduction; adverse event rates were reported as similar."
    evidenceUse:
      - "context"
      - "measurement"
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---
This source is included for **Adjacent combinations and special-population evidence**.

**Findings:** ACC coverage of the SPORT randomized trial reported that low-dose rosuvastatin lowered LDL-C compared with placebo while commonly used supplements, including a red yeast rice arm, did not significantly lower LDL-C versus placebo over 28 days.

**Why it matters:** This is a modern supervised comparator context showing that a commercial red yeast rice supplement arm did not outperform placebo in a short lipid-marker trial, while the statin arm did.

**Potential experiment signals:** LDL-C, total cholesterol, triglycerides, HDL-C, adverse events.

**Protocol takeaway:** Use only as context for a supervised SPORT trial and not as a direct claim about all red yeast rice products; it is press coverage and duplicates the primary SPORT publication context.

**Claim use:** `context-only`.

**Limitations and mismatch:** Web coverage rather than a full trial report; short duration; supplement product composition and monacolin content are not described on the page; findings do not generalize to all red yeast rice preparations. Adults at elevated ASCVD risk in a supervised trial; not an individual OTC self-experiment and not monacolin-standardized red yeast rice use.
