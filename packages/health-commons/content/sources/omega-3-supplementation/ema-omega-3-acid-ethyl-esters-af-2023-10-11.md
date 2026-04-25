---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:ema-omega-3-acid-ethyl-esters-af-2023-10-11
slug: sources/omega-3-supplementation/ema-omega-3-acid-ethyl-esters-af-2023-10-11
title: 'Omega-3-acid ethyl ester medicines: dose-dependent increased risk of atrial fibrillation in patients with established cardiovascular diseases or cardiovascular risk factors'
summary: EMA direct healthcare professional communication recommending product-information updates for omega-3-acid ethyl ester medicines because randomized-trial meta-analyses showed dose-dependent increased AF risk, highest at 4 g/day.
status: draft
quality: usable
aliases:
- 'Omega-3-acid ethyl ester medicines: dose-dependent increased risk of atrial fibrillation in patients with established cardiovascular diseases or cardiovascular risk factors'
categories:
- omega-3-supplementation
relations:
-
  type: related_protocol
  target: protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation
-
  type: parent_family
  target: experiment_family:omega-3-supplementation
source:
  kind: other
  title: 'Omega-3-acid ethyl ester medicines: dose-dependent increased risk of atrial fibrillation in patients with established cardiovascular diseases or cardiovascular risk factors'
  authors: European Medicines Agency and marketing authorisation holders
  year: 2023
  journal: European Medicines Agency
  citation: 'European Medicines Agency. Omega-3-acid ethyl ester medicines: dose-dependent increased risk of atrial fibrillation in patients with established cardiovascular diseases or cardiovascular risk factors. Direct Healthcare Professional Communication. 2023-10-11.'
  url: https://www.ema.europa.eu/system/files/documents/dhpc/direct-healthcare-professional-communication-dhpc-omega-3-acid-ethyl-ester-medicines-dose-dependent_en.pdf
researchEvidence:
  designKind: other
  designLabel: Regulatory safety communication / direct healthcare professional communication
  populationLabel: Patients with established cardiovascular disease or cardiovascular risk factors treated with omega-3-acid ethyl ester medicines; supporting meta-analyses enrolled more than 80,000 mostly cardiovascular-risk patients.
  durationLabel: Regulatory review of randomized trials/meta-analyses; treatment durations varied.
  aggregateRole: primary
  cohortKey: batch-012:ema-omega-3-acid-ethyl-esters-af-2023-10-11
evidenceBucket: safety_adverse_events
whyItMatters: Regulatory safety boundary for high-dose prescription omega-3 ethyl esters in cardiovascular-risk patients.
potentialMurphEndpoints:
- adverse_event:atrial-fibrillation
- dose:omega-3-ethyl-esters-4g
protocolTakeaway: 'Use as safety-only evidence only: EMA summarized a dose-dependent increased AF risk compared with placebo, with highest observed risk at 4 g/day. The communication cited Lombardi IRR 1.37, Gencer HR 1.25 with >1 g/day HR 1.49, and Yan RR 1.32; EMA recommended labeling AF as a common adverse reaction and advising discontinuation if AF develops.'
murphTakeaway: Regulatory safety boundary for high-dose prescription omega-3 ethyl esters in cardiovascular-risk patients.
studyDesign: other
modality: oral EPA/DHA supplementation or adjacent omega-3 fatty-acid product
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **safety_adverse_events**.

**Findings:** EMA summarized a dose-dependent increased AF risk compared with placebo, with highest observed risk at 4 g/day. The communication cited Lombardi IRR 1.37, Gencer HR 1.25 with >1 g/day HR 1.49, and Yan RR 1.32; EMA recommended labeling AF as a common adverse reaction and advising discontinuation if AF develops.

**Why it matters:** Regulatory safety boundary for high-dose prescription omega-3 ethyl esters in cardiovascular-risk patients.

**Potential experiment signals:** adverse_event:atrial-fibrillation, dose:omega-3-ethyl-esters-4g.

**Protocol takeaway:** Use as safety-only evidence only: EMA summarized a dose-dependent increased AF risk compared with placebo, with highest observed risk at 4 g/day. The communication cited Lombardi IRR 1.37, Gencer HR 1.25 with >1 g/day HR 1.49, and Yan RR 1.32; EMA recommended labeling AF as a common adverse reaction and advising discontinuation if AF develops.

**Claim use:** `safety-only`.

**Population mismatch:** Medicinal ethyl ester products at therapeutic doses; not over-the-counter nutrition protocols.

**Limitations:** Regulatory synthesis, not a new trial; focused on medicinal omega-3 ethyl esters and CVD-risk patients.
