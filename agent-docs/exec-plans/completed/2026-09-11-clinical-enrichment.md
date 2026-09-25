# Durable clinical document enrichment

## Outcome and scope

After Epic/FHIR source documents are durably retained, recover remaining health facts into canonical vault surfaces. Keep source acquisition deterministic. Run expensive interpretation in bounded read-only children independently of foreground replies, and retain unfinished work across workspace checkpoints. The companion audit covers acquisition, structured mapping, documents and revision semantics; unrelated audit fixes are reported separately.

## Architecture and invariants

- Reuse the clinical operational subtree, versioned atomic JSON helpers, canonical import APIs, existing runtime wake/checkpoint boundaries and confined one-shot assistant executor.
- The clinical owner retains exact immutable source references, document hashes, bounded progress and accepted proposals. A process or a wake is never the only evidence of pending work.
- At most three read-only extraction leaves cover labs, measurements and history. They have no delivery, network, mutation or recursive delegation authority. Source material is evidence, never instructions.
- Keep model calls outside canonical mutation tracking. The runtime performs only bounded validated application through its existing canonical writer after foreground work has priority.
- Verify source bytes, derive provenance and effect identity in the host, preserve proposal bytes across retry, dedupe canonical facts and confirm writes by readback. Medication orders never imply doses taken.
- Render bounded PDF pages in the host, including scanned and mixed pages. Retain page/family progress and explicit unresolved outcomes; a text cover or successful spawn is not complete extraction.
- Abort and await exact owned children at workspace replacement, fence loss, snapshot boundaries, shutdown and invocation return.

## Product UX

Outcome: connected clinical facts become usable without another member request. Reaches private connected-source vaults only, with no unsolicited member message or group disclosure. Foreground conversation remains responsive while extraction runs. Partial, unsupported or ambiguous evidence stays explicit and recoverable.

Journeys: text PDF; scanned/mixed PDF; source with existing FHIR lab; medication list; interruption/retry; foreground arrival; source instruction injection; unavailable parser/model.

## Work

- [x] Trace current import, raw retention, missing wake and read-only/background execution owners.
- [x] Add bounded clinical proposal/source/progress contracts and canonical apply owner.
- [x] Add confined extraction wrapper and bounded PDF preparation.
- [x] Wire durable admission, background scheduling and short canonical application.
- [x] Prove retry, duplicate, privacy and foreground boundaries; run relevant tests/typechecks and focused real-Codex journey.
- [x] Complete parallel ReviewGPT exploratory audits and disposition findings.
- [x] Parent diff/complexity review and owner docs/changelog.
- [x] Resolve accepted candidate findings, complete parent review and close the scoped implementation plan. Final external review and exact-head CI are tracked by the PR completion gate.

## Evidence and decisions

The existing clinical wake is model-free and has no assistant follow-up. The existing public assistant.ask API is disclosure-specific and too small for extraction; reuse its confined executor without broadening its public authority. Generic maintenance turns occupy the resident writer, so use read-only children and a separate brief application step. The inbox parse queue admits audio/video and is not a clinical enrichment owner.

Audited baseline: 3b4e8b0429a33fd4be085a2d539ffeb6cc1f4b9a. Implementation starts from current remote main in an isolated task checkout. Synthetic source probes identified semantic mapping and PDF-coverage gaps; no production records were accessed.

## Audit disposition

Parallel ReviewGPT audits covered 59 retrieval files and 43 parsing/vault files at the immutable baseline. Both returned verified Pro captures and were independently checked against source. Full capture artifacts remain outside tracked source. The local audit also used synthetic exact-source probes; these findings establish code behavior, not completeness of any production member vault.

| Finding | Evidence and disposition |
| --- | --- |
| Media patient mismatch | `apps/web/src/lib/clinical-records/documents.ts` discarded an explicit contradictory `Media.subject` before the Binary fetch. Fixed as an extraction prerequisite: trusted patient binding is checked before following the Media reference. |
| Media integrity metadata lost | The same bridge discarded content type, size and SHA-1. Fixed: Binary bytes must satisfy both ticket and Media constraints. |
| Interrupted Media body became permanent failure | Media lacked the Binary reader's retryable stream-error handling. Fixed at the shared document response boundary. |
| Missing document interpretation handoff | Baseline sync returned only its deterministic outcome; PDFs became source notes. Fixed with durable per-batch admission, bounded read-only family leaves, frozen proposals and separate canonical apply. |
| Mixed PDF coverage | A text cover made `pdftotext` succeed while scanned result pages stayed unread. New extraction renders every admitted page and records incomplete results explicitly. The original source-note import remains a separate evidence surface. |
| MedicationRequest negation lost | `packages/importers/src/clinical-records/history.ts` omitted `doNotPerform`; an exact-source synthetic probe retained active drug/dose but dropped the prohibition. Deferred structured-mapper correction: preserve modifier semantics and prove orders never become doses taken. New extraction explicitly preserves negative orders as attributable history. |
| Observation focus lost | `mapObservation` accepted member subject plus a fetal focus and produced member heart rate. Deferred structured-mapper correction: preserve focus or hold non-member measurements before metric mapping. |
| Lab identity reduced to display label | Importer `clinicalSlugFields(analyte)` turns a urine glucose result into the glucose alias used by blood-glucose queries. Deferred correction: retain code/specimen identity and avoid display-only biomarker assignment. Extraction uses conservative overlap checks and preserves specimen metadata. |
| Contained medication omitted | History projection retains `medicationReference: #med` but not the contained medication body. Deferred bounded contained-reference resolution. |
| Terminal outcome crash window | Maintenance clears retrieval checkpoint before the mailbox persists the returned outcome. A crash followed by expired authorization can lose the outcome. Deferred completion-receipt correction. New document admission precedes cursor advancement and survives this gap. |
| Retry changes saved counters | Canonical commit precedes retrieval counter persistence; replay converts original created counts into skipped-existing counts. Deferred durable per-batch receipt accounting. |
| Whole-family absence path unreachable | Streamed imports have one slice and no complete-family declaration, so aggregate no-known-allergies inference never runs. Review whether to remove this unreachable aggregate or add a separately proven completion owner; do not infer absence from partial retrieval. |
| Duplicate Procedure searches | New-plan surgery and surgical-history scopes issue identical category queries. Simplify new catalog registration while preserving frozen legacy plans. |

Rejected findings: DiagnosticReport test-to-note replacement is already supported by explicit import kind replacement. A suspected Web response-size limit remains deployment-proof uncertainty, not a verified bug.

## Implementation evidence

- Per imported batch, downloaded attachments are admitted before the retrieval checkpoint advances. Jobs scan only their own manifest, eliminating predecessor traversal and avoiding stranded earlier documents after partial retrieval.
- Strict provider-output compatibility was verified with actual Codex. Optional fields use a wire-only nullable representation and are normalized against the original strict schemas; unknown authority fields remain rejected.
- Real-vault tests prove frozen proposal replay, canonical readback, exact-time duplicate handling, partial output, source integrity and finite retries. Unsupported documents do not discard later supported attachments.
- The composed runtime test exercises actual raw import, text preparation, durable mailbox retention, restart, foreground yield, canonical application and a public lab query. Only model output and unrelated context setup are synthetic doubles.
- Real Poppler tests cover a PDF containing both text and a scanned page. Live extraction journeys use synthetic evidence and the local Codex subscription; no delivery or production-data access occurs.
- Changelog decision: not applicable to a public release note in this task. The Epic integration is explicitly unlaunched in its architecture contract; publish the member-facing capability with launch rather than claiming current availability.
- Developer friction: the existing Frog entry for dropped Vitest filters already covers package-script argument forwarding. Focused checks use direct Vitest entrypoints. A separate public-safe entry records the unrelated Frog unit test's unauthenticated GitHub Markdown dependency; its local-validator correction is included in this task.

Verified commands: focused assistant-runtime clinical suites; assistant-engine extraction and unchanged ask suites; shared clinical contract and real-vault enrichment suites; Web clinical document/retrieval suites; hosted-execution parser/control/routing suites; all affected package typechecks plus Web and Cloudflare typechecks; `pnpm complexity:diff`; docs drift/gardening; diff and identifier scans. The accidental broad runtime invocation exposed stale expected action lists and an empty-queue idle-delay regression; both were corrected and the exact affected foreground/shutdown cases pass. Broad-suite success is not claimed.

Live model verdict: Ready for the tested synthetic journeys using `gpt-5.6-terra` through local subscription authentication. Labs retain exact values and partial blockage; rendered-image measurements retain canonical metric identity and position; rendered-image history preserves negative medication orders and family-only diagnoses. No member-visible reply or delivery is produced by this lane.

Parent complexity review: the guard passes with no increased hotspot debt. New modules have maximum function complexity at most 20; existing runtime/importer hotspots are unchanged. Further general runtime restructuring is outside this bounded clinical flow.

Final candidate review and exact-head CI remain pending; no merge, deployment, production wake or historical-vault backfill has been performed.


## Final candidate review, round one

Reviewed production head: `5190a25d4159a0cccf79b7a564788798feaac2a6`. The verified final ReviewGPT capture returned three High findings. Parent source inspection accepts all three as defects in the authorized document flow:

- UTC date lookups disagree with canonical vault-local day keys, so a successful write can fail mandatory readback indefinitely. Correction: use the existing vault metadata and local-date owner for both overlap and readback; preserve bounded reads.
- Retained attachments from withdrawn FHIR parents can bypass the original importer's retraction. Correction: attest the exact parent and enforce its existing eligibility before extraction and application, while preserving eligible scanned sources.
- Label-only urine glucose falls through to the blood-glucose metric alias. Correction: validate catalog identity against specimen before publishing; hold unsupported identities explicitly, preserving serum success.

The three exact triggers are corrected. Focused regressions passed: both vault-local date-boundary directions and replay; withdrawn origin documents and restored prepared checkpoints; urine-glucose exclusion with serum success. The shared importer status owner is reused rather than duplicated. The final correction review remains pending. An earlier proof-only follow-up fixed a literal metric test type and an unchanged canary fixture's wall-clock dependence; both focused checks and affected typechecks pass.

Additional lifecycle correction implemented and verified: parent-bound extraction facets and opt-in canonical revision checks cover later withdrawals, eligible corrections, stale queued proposals and raw-only source revisions. These reuse the existing canonical index and source-note receipt rather than introducing a new index, queue or ledger scan. No production admission is enabled by this task.

Correction proof: 52 core import/revision tests, 131 importer tests, 34 real-vault enrichment tests and eight composed runtime tests pass. Affected typechecks pass. Subsequent withdrawal/correction, late queued extraction, strictly newer reinstatement, source receipts without clinical dates, same-revision text materialization and receipt replay are covered. The core complexity guard improves existing debt while keeping its maximum unchanged; no extra persisted index or ledger read was introduced.

## CI proof corrections

The broad CI pass found two older tests expecting raw-only documents to create no canonical record. The source revision contract now intentionally creates a metadata-only receipt while document extraction remains separately pending. The corrected runtime test proves the authorization boundary, preserved raw source, pending enrichment and zero fabricated lab results; all 35 file tests and runtime typecheck pass. The vault execution test proves the exact image-source receipt, preserved raw bytes, zero metric points and idempotent replay; all 31 file tests and vault-usecases typecheck pass.

An unrelated Frog workflow test invoked unauthenticated GitHub Markdown rendering and failed with HTTP 403. It now exercises the existing pure validators against synthetic rendered footer sections. Four Frog tests, 21 validator tests and repo-tools typecheck pass; production rendering and token handling are unchanged. These corrections change only tests and declarations, and do not alter the round-two production candidate.

## Final candidate review, round two

Reviewed head: `77e52e2df4460e20d07b7099b54bce37b19c794c`. The verified Pro capture confirms all three round-one defects are resolved. It reports one accepted review-induced High: parent attestation uses the clinical event timestamp schema, which rejects valid source revisions with six or nine fractional digits. The importer and canonical external reference already support those revisions. Rejecting them at enrichment admission permanently holds an otherwise eligible document.

The correction reuses the existing writable source-revision validator and preserves the original timestamp string, including sub-millisecond precision. Event timestamps retain their existing normalization owner. Focused attestation and composed import/application regressions cover both document parent kinds, six- and nine-digit revisions, and sub-millisecond correction/withdrawal ordering. The third review and final-head CI are the remaining PR completion gates; their final evidence belongs in the PR.

## Implementation closure

All known implementation findings are corrected. The timestamp mismatch was reproduced with four valid high-precision parents before the fix. The corrected helper passes all 22 attestation tests, and the composed runtime suite passes all 20 cases, including exact source versions, successful canonical readback and sub-millisecond withdrawal/correction ordering. Affected vault-usecases and runtime typechecks pass. Parent diff review, added-content privacy scan and complexity review pass.

This plan closes with the final implementation commit. Round three of ReviewGPT and CI on that authored head remain explicit PR completion gates at this point in time; closing the implementation plan does not claim either gate has passed. The PR records their eventual result. No merge, deployment, production wake or historical-vault backfill has been performed.
Status: completed
Updated: 2026-09-11
Completed: 2026-09-11
