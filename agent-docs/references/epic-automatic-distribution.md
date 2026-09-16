# Epic automatic distribution and hospital-approved imports

Last verified: 2026-09-15

## Launch contract

The default app is patient-facing, read-only, R4, non-confidential with S256
PKCE and no refresh/offline access. Select USCDI v3 automatic distribution in
Epic and register only the 44 default APIs below. Provision that app's production
and non-production IDs in `EPIC_SMART_CLIENT_ID` and
`EPIC_SMART_NON_PRODUCTION_CLIENT_ID`. A code feature flag does not change an
Epic registration. An existing broad, manually distributed app cannot become
automatic merely by requesting fewer OAuth scopes. Epic documents released
app records as immutable; register a replacement when necessary.

Epic distributes eligible clients to participating customer environments on a
rolling cycle that can take up to 12 hours. Hospital licensing, Epic version,
auto-download settings and patient authorization still apply. This is not a
guarantee of every hospital, every historical record or every document body.

## Sources and eligibility checks

1. [Patient-app distribution rules and appendix](https://fhir.epic.com/Documentation?docId=patientfacingfhirapps&section=AutomaticClientDistribution):
   USCDI-v3 distribution requires only eligible APIs, patient-facing read access,
   an activated app, the automatic option and eligible customer configuration.
2. [Current public API catalog](https://fhir.epic.com/Specifications/Selections):
   the same public metadata that populates Epic's Specifications page gives
   stable API IDs, current names and `IsUSCDI`. All 70 current Murph registrations
   were checked; the catalog classification is informational and does not determine the
   automatic-distribution version. Explicit registration metadata takes precedence.
3. [Epic app registration](https://fhir.epic.com/Developer/Create) publishes
   `autodownload-types` for each selectable API. All 70 APIs were checked against
   the explicit `USCDIv3` value. This resolves the two catalog discrepancies below.
4. Each default API's linked specification was checked for patient-facing read/search
   access. Two read APIs omit the HTTP-method metadata field; their descriptions
   and resource-by-ID templates describe reads. The lab-document search advertises
   GET and POST search, and Murph uses GET. [Client registration](https://fhir.epic.com/Documentation?docId=epiconfhirrequestprocess&section=custreq)
   explains manual client-record provisioning and production-ready app changes.

The checked-in `apps/web/src/lib/clinical-records/epic-registration.v1.json`
contains catalog facts and generic registration eligibility metadata, without
app identifiers or account data. Runtime performs no catalog request.
The full existing policy remains the query/fingerprint reader; new plans filter
its registration keys through this reviewed evidence. Unknown APIs default to
gated until reviewed. Tests require evidence for every full-catalog API and
preserve eligible lab and report dependencies.

## Registration eligibility and catalog discrepancies

- Outside-record clinical notes (10999 and 10996) explicitly allow `USCDIv3`
  in registration metadata and appear in the published appendix. Both are
  enabled. Their public catalog `IsUSCDI: false` flag is not an eligibility veto.
- Advance Directive APIs (40299 and 40293) allow only `None` in registration
  metadata. Both remain gated despite their catalog `IsUSCDI: true` flag.
- FamilyMemberHistory, patient-reported surgical history, radiology documents,
  external CCDAs, questionnaires, correspondence, handoff, stored document
  information, clinical references and MDS/HIS/OASIS/IRF-PAI document APIs lack
  the required matching registration eligibility and remain gated.
- DiagnosticReport results remain enabled even though the separate radiology
  DocumentReference query is gated. Ordinary procedure/surgery searches remain
  enabled even though patient-reported surgical history is gated.

## Default-empty feature flag

`EPIC_SMART_HOSPITAL_APPROVED_PROVIDER_IDS` is an exact comma-separated list of
server-owned directory IDs. Empty/unset means no hospital-approved imports.
There is no wildcard, global `true`, client-supplied override or UI toggle.
Only add an organization after it has provisioned the broad app's client record.

An opted-in organization uses `EPIC_SMART_HOSPITAL_APPROVED_CLIENT_ID` or, for
sandbox, `EPIC_SMART_HOSPITAL_APPROVED_NON_PRODUCTION_CLIENT_ID`. These must be
separate from the corresponding automatic app ID. Missing/identical IDs fail
before OAuth discovery; production and sandbox never fall back to each other.
Unlisted providers retain the automatic client and 25-query/16-family default.
Listed providers can use the full 40-query/17-family catalog and 70 registrations.

The callback rechecks the selected client against the client frozen at OAuth
start. Changing clients or switching modes during authorization requires a new
connection attempt. Actual partial grants still bound the new frozen plan.
Page and document egress check the current provider flag, including old frozen
plans and issued document tickets. Disabling the flag makes gated work explicitly
unavailable and preserves the existing partial-result behavior and saved records.
Already completed provider requests and saved records are not undone.

## Registration matrix

`Default` means verified for the default USCDI-v3 app. `Gated` means excluded
from that registration and those default queries. The appendix column reconciles
older names against Epic's current exact catalog names and identifiers.

| Current registration / specification | Mode | Appendix name |
| --- | --- | --- |
| [AllergyIntolerance.Search (Patient Chart) (R4)](https://fhir.epic.com/Specifications?api=947) | Default | AllergyIntolerance.Search (R4) |
| [Binary.Read (Clinical Notes) (R4)](https://fhir.epic.com/Specifications?api=1044) | Default | Binary.Read (Clinical Notes) (R4) |
| [CarePlan.Search (Longitudinal) (R4)](https://fhir.epic.com/Specifications?api=1065) | Default | CarePlan.Search (Longitudinal) (R4) |
| [CareTeam.Search (Longitudinal CareTeam) (R4)](https://fhir.epic.com/Specifications?api=1069) | Default | CareTeam.Search (Longitudinal) (R4) |
| [Condition.Search (Encounter Diagnosis) (R4)](https://fhir.epic.com/Specifications?api=952) | Default | Condition.Search (Encounter Diagnosis) (R4) |
| [Condition.Search (Problems) (R4)](https://fhir.epic.com/Specifications?api=953) | Default | Condition.Search (Problems) (R4) |
| [Device.Search (Implants) (R4)](https://fhir.epic.com/Specifications?api=1013) | Default | Device.Search (Implants) (R4) |
| [DiagnosticReport.Search (Results) (R4)](https://fhir.epic.com/Specifications?api=989) | Default | DiagnosticReport.Search (Results) (R4) |
| [DocumentReference.Search (Clinical Notes) (R4)](https://fhir.epic.com/Specifications?api=1048) | Default | DocumentReference.Search (Clinical Notes) (R4) |
| [Encounter.Read (Patient Chart) (R4)](https://fhir.epic.com/Specifications?api=908) | Default | Encounter.Read (Patient Chart) (R4) |
| [Encounter.Search (Patient Chart) (R4)](https://fhir.epic.com/Specifications?api=909) | Default | Encounter.Search (Patient Chart) (R4) |
| [FamilyMemberHistory.Search (R4)](https://fhir.epic.com/Specifications?api=10159) | Gated | Not verified |
| [Goal.Search (Patient) (R4)](https://fhir.epic.com/Specifications?api=960) | Default | Goal.Search (Patient) (R4) |
| [Immunization.Search (Patient Chart) (R4)](https://fhir.epic.com/Specifications?api=1071) | Default | Immunization.Search (R4) |
| [Location.Read (Organizational Directory) (R4)](https://fhir.epic.com/Specifications?api=928) | Default | Location.Read (R4) |
| [MedicationDispense.Search (Fill Status) (R4)](https://fhir.epic.com/Specifications?api=10646) | Default | MedicationDispense.Search (Fill Status) (R4) |
| [Medication.Read (Organization Med List) (R4)](https://fhir.epic.com/Specifications?api=995) | Default | Medication.Read (R4) |
| [MedicationRequest.Read (Signed Medication Order) (R4)](https://fhir.epic.com/Specifications?api=996) | Default | MedicationRequest.Read (Orders) (R4) |
| [MedicationRequest.Search (Signed Medication Order) (R4)](https://fhir.epic.com/Specifications?api=997) | Default | MedicationRequest.Search (Orders) (R4) |
| [Observation.Read (Assessments) (R4)](https://fhir.epic.com/Specifications?api=11053) | Default | Observation.Read (Assessments) (R4) |
| [Observation.Read (Labs) (R4)](https://fhir.epic.com/Specifications?api=998) | Default | Observation.Read (Labs) (R4) |
| [Observation.Search (Assessments) (R4)](https://fhir.epic.com/Specifications?api=11052) | Default | Observation.Search (Assessments) (R4) |
| [Observation.Search (Labs) (R4)](https://fhir.epic.com/Specifications?api=999) | Default | Observation.Search (Labs) (R4) |
| [Observation.Search (SDOH Assessments) (R4)](https://fhir.epic.com/Specifications?api=11104) | Default | Observation.Search (SDOH Assessments) (R4) |
| [Observation.Search (Social History) (R4)](https://fhir.epic.com/Specifications?api=972) | Default | Observation.Search (Social History) (R4) |
| [Observation.Search (Vital Signs) (R4)](https://fhir.epic.com/Specifications?api=973) | Default | Observation.Search (Vitals) (R4) |
| [Organization.Read (Organizational Directory) (R4)](https://fhir.epic.com/Specifications?api=929) | Default | Organization.Read (R4) |
| [Patient.Read (Demographics) (R4)](https://fhir.epic.com/Specifications?api=931) | Default | Patient.Read (R4) |
| [Practitioner.Read (Organizational Directory) (R4)](https://fhir.epic.com/Specifications?api=935) | Default | Practitioner.Read (R4) |
| [PractitionerRole.Read (Organizational Directory) (R4)](https://fhir.epic.com/Specifications?api=937) | Default | PractitionerRole.Read (R4) |
| [Procedure.Search (Orders) (R4)](https://fhir.epic.com/Specifications?api=976) | Default | Procedure.Search (Orders) (R4) |
| [Procedure.Search (Surgeries) (R4)](https://fhir.epic.com/Specifications?api=10042) | Default | Procedure.Search (Surgeries) (R4) |
| [Procedure.Search (Patient-Reported Surgical History) (R4)](https://fhir.epic.com/Specifications?api=10030) | Gated | Not verified |
| [Provenance.Read (R4)](https://fhir.epic.com/Specifications?api=10180) | Default | Provenance.Read (R4) |
| [ServiceRequest.Read (Orders) (R4)](https://fhir.epic.com/Specifications?api=1053) | Default | ServiceRequest.Read (Order Procedure) (R4) |
| [ServiceRequest.Search (Orders) (R4)](https://fhir.epic.com/Specifications?api=1054) | Default | ServiceRequest.Search (Order Procedure) (R4) |
| [Specimen.Read (Patient Chart) (R4)](https://fhir.epic.com/Specifications?api=10014) | Default | Specimen.Read (R4) |
| [DocumentReference.Search (Radiology Results) (R4)](https://fhir.epic.com/Specifications?api=10235) | Gated | Not verified |
| [DocumentReference.Search (External CCDA) (R4)](https://fhir.epic.com/Specifications?api=10135) | Gated | Not verified |
| [DocumentReference.Search (Outside Record - Clinical Notes) (R4)](https://fhir.epic.com/Specifications?api=10999) | Default | DocumentReference.Search (Outside Record Clinical Notes) (R4) |
| [Observation.Search (Outside Record Vital Signs) (R4)](https://fhir.epic.com/Specifications?api=11422) | Default | Observation.Search (Outside Record Vital Sign) (R4) |
| [Binary.Read (External CCDA) (R4)](https://fhir.epic.com/Specifications?api=10183) | Gated | Not verified |
| [Binary.Read (Outside Record - Clinical Notes) (R4)](https://fhir.epic.com/Specifications?api=10996) | Default | Binary.Read (Outside Record Clinical Notes) (R4) |
| [Binary.Read (Radiology Results) (R4)](https://fhir.epic.com/Specifications?api=10230) | Gated | Not verified |
| [Binary.Read (Labs) (R4)](https://fhir.epic.com/Specifications?api=10139) | Default | Binary.Read (Labs) (R4) |
| [Binary.Read (Generated CDAs) (R4)](https://fhir.epic.com/Specifications?api=10501) | Default | Binary.Read (Generated CCDA) (R4) |
| [Binary.Read (Patient-Entered Questionnaires) (R4)](https://fhir.epic.com/Specifications?api=10438) | Gated | Not verified |
| [Binary.Read (Correspondences) (R4)](https://fhir.epic.com/Specifications?api=10231) | Gated | Not verified |
| [Binary.Read (Handoff) (R4)](https://fhir.epic.com/Specifications?api=10138) | Gated | Not verified |
| [Binary.Read (Minimum Data Set) (R4)](https://fhir.epic.com/Specifications?api=10290) | Gated | Not verified |
| [DocumentReference.Search (Labs) (R4)](https://fhir.epic.com/Specifications?api=10133) | Default | DocumentReference.Search (Labs) (R4) |
| [DocumentReference.Search (Generated CDAs) (R4)](https://fhir.epic.com/Specifications?api=10506) | Default | DocumentReference.Search (Generated CCDA) (R4) |
| [DocumentReference.Search (Patient-Entered Questionnaires) (R4)](https://fhir.epic.com/Specifications?api=10436) | Gated | Not verified |
| [DocumentReference.Search (Correspondences) (R4)](https://fhir.epic.com/Specifications?api=10244) | Gated | Not verified |
| [DocumentReference.Search (Handoff) (R4)](https://fhir.epic.com/Specifications?api=10131) | Gated | Not verified |
| [DocumentReference.Search (Minimum Data Set) (R4)](https://fhir.epic.com/Specifications?api=10284) | Gated | Not verified |
| [Binary.Read (Document Information) (R4)](https://fhir.epic.com/Specifications?api=10013) | Gated | Not verified |
| [DocumentReference.Search (Document Information) (R4)](https://fhir.epic.com/Specifications?api=10310) | Gated | Not verified |
| [Binary.Read (Clinical References) (R4)](https://fhir.epic.com/Specifications?api=10308) | Gated | Not verified |
| [DocumentReference.Search (Clinical References) (R4)](https://fhir.epic.com/Specifications?api=10318) | Gated | Not verified |
| [Binary.Read (HIS) (R4)](https://fhir.epic.com/Specifications?api=10137) | Gated | Not verified |
| [DocumentReference.Search (HIS) (R4)](https://fhir.epic.com/Specifications?api=10129) | Gated | Not verified |
| [Binary.Read (OASIS) (R4)](https://fhir.epic.com/Specifications?api=10136) | Gated | Not verified |
| [DocumentReference.Search (OASIS) (R4)](https://fhir.epic.com/Specifications?api=10127) | Gated | Not verified |
| [Binary.Read (IRF-PAI) (R4)](https://fhir.epic.com/Specifications?api=10285) | Gated | Not verified |
| [DocumentReference.Search (IRF-PAI) (R4)](https://fhir.epic.com/Specifications?api=10287) | Gated | Not verified |
| [Binary.Read (Advance Directive) (R4)](https://fhir.epic.com/Specifications?api=40293) | Gated | Not verified |
| [DocumentReference.Search (Advance Directive) (R4)](https://fhir.epic.com/Specifications?api=40299) | Gated | Not verified |
| [Media.Read (Study) (R4)](https://fhir.epic.com/Specifications?api=10989) | Default | Media.Read (Study) (R4) |
| [Binary.Read (Study) (R4)](https://fhir.epic.com/Specifications?api=11002) | Default | Binary.Read (Study) (R4) |

## Verification and deployment

Deploy the Web policy before exposing the existing connection entry points.
No Prisma migration or runner wire change is needed: existing runners already
consume arbitrary valid subsets of frozen query slices. Test a default labs
import, a partial grant, opted-in broad import, OAuth mode change, and flag
removal before page/document continuation. Perform a real Epic authorization and
canonical lab readback before announcing availability.

Keep existing broad client IDs out of default configuration. Flag removal is
reversible for future provider requests. An older Web artifact does not enforce
this restriction; disable new admission and drain active imports before any
rollback below this policy. Registration updates and deployments are separate
operator actions, not effects of opening or merging this PR.
