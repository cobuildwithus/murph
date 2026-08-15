# General Workout CSV Import

Status: active
Created: 2026-08-13
Updated: 2026-08-15

## Goal

- Let Murph safely import an unfamiliar large workout CSV by inspecting and transforming it locally, then committing canonical workout records through the existing atomic bulk event importer.

## Success criteria

- Strong and Hevy exports continue to use the dedicated workout CSV importer.
- An unfamiliar workout CSV is handled locally without placing raw rows in the reusable prompt or making one model/tool call per set.
- Murph reads the exact activity-session JSONL schema, requires explicit consequential mappings and units instead of guessing, dry-runs the complete batch, and applies only after validation succeeds.
- Exact-source retries stop from a durable whole-source completion receipt without regenerating or comparing a model-authored transform.
- Focused prompt tests, typecheck, preliminary ReviewGPT specialist review, final ReviewGPT gate, and exact-head CI pass.

## Scope

- In scope: assistant system-prompt guidance, focused prompt tests, durable command-surface wording when needed, direct proof of the Python-to-JSONL-to-vault path, and public changelog treatment.
- Out of scope: a second generic CSV parser framework, a new dependency, automatic semantic guessing for arbitrary columns, or changes to canonical workout/event storage ownership.

## Constraints

- Technical constraints: Python is a local transformation tool only; all canonical writes remain behind `vault-cli event import-jsonl` and `packages/core` batch mutation. Validate the entire JSONL batch before applying it.
- Product/process constraints: preserve private attachment contents, avoid raw-row prompt expansion, ask only for missing choices that materially affect interpretation, and run the repository ReviewGPT workflow on an exact pushed head.

## Risks and mitigations

1. Risk: A model-generated transform silently maps the wrong timestamp, unit, or grouping key.
   Mitigation: require aggregate inspection, explicit consequential choices, exact schema generation, complete dry-run, and a bounded readback sample before claiming success.
2. Risk: Retrying an import duplicates workouts or overwrites a member edit.
   Mitigation: preserve the exact source once, reject model-authored external references, and atomically allow one append-only activity batch per historical source reference.
3. Risk: The prompt suggests Python exists where it does not.
   Mitigation: retain and extend the already-tested Python availability contract and hosted runner smoke proof.

## Tasks

1. Prove the current Python, attachment-path, workout schema, and bulk event importer capabilities.
2. Add the smallest outcome-first assistant guidance and focused regression tests.
3. Run focused verification and a synthetic end-to-end local import proof.
4. Commit, push, open the PR, and run preliminary plus final ReviewGPT gates with CI.
5. Resolve accepted findings, close the plan, and hand off the reviewed PR.
6. Adopt the user-requested latest published ReviewGPT before the final rerun, preserving the existing Murph review configuration and auditing the dependency change.

## Decisions

- Reuse `vault-cli event import-jsonl` as the generalized canonical bulk primitive; do not add a new parser package or Python dependency.
- Keep the dedicated Strong/Hevy importer first because it preserves immutable raw manifests and provider-specific refresh/correction semantics that a generic transform cannot safely infer.

## Review anomaly retrospective

- Original requirement: preserve an unfamiliar workout CSV as durable raw evidence, make an exact-source retry idempotent across turns or runtime replacement, and reject changed workout content without overwriting a member edit.
- First-reviewed shape: model-authored stable workout `externalRef` values used the existing superseding event importer, without generic raw-source ownership. Review correctly found that changed content could overwrite an edited workout.
- Round-two shape: remediation added a new document import on every attempt, attached that attempt-local raw path to each workout, and selected the existing batch owner's new reject policy. The reject policy protects edits, but a second exact-source attempt receives a different raw path, so otherwise identical workouts compare as changed and the rejected retry leaves another durable document behind.
- Repeated mechanism: both failures ask event reconciliation alone to decide whether a source-semantic workout identity represents identical or changed content while its provenance identity changes outside that owner. Another event equality exception would repeat the same design mistake.
- Decision: continue in this PR by making exact-source reuse an explicit option of the existing document-import owner. That owner will hash and verify the source, reuse one prior live document/raw artifact with identical bytes, and otherwise perform the current atomic import. The generic workout skill will select that option before transformation, so exact replays retain the same raw path and ordinary event equality works unchanged. Do not ignore `rawRefs`, add a registry, add another event policy, or make all document imports deduplicate by default.
- Superseded decision: this round-two event-payload equivalence was still insufficient because independent model turns need not reproduce the same payload or external-reference namespace. The round-three source-history decision below replaces it.
- Retained provenance behavior: an identical `--reuse-exact` document import returns the existing live document and creates no raw artifact, document event, or audit row. A different source creates a new document.

## Round 3 replay-contract retrospective

- Remaining failed assumption: stabilizing the raw locator does not make a scratch, model-authored transformer deterministic across turns. A second model can choose a different external-reference namespace, key normalization, or otherwise valid canonical rendering for the same source. Event reconciliation cannot infer that those independently generated batches share one source intent.
- Requirement decision: exact-source recovery does not regenerate or compare a canonical batch. The durable event-to-raw-reference relationship is the completion receipt. Before transformation, the assistant asks the existing event ledger whether any historical `activity_session` has referenced the verified source. A match means the atomic import completed previously, including when the workout was later edited or deleted, so the assistant stops without another transform or write.
- Atomicity decision: the first apply names the source raw reference as a batch precondition. Under the existing canonical write lock, core verifies every incoming row references that source and rejects the batch if a same-kind event has ever referenced it. This closes the concurrent-first-attempt race without a registry, mapping record, replay state machine, or new durable owner.
- Identity decision: remove model-authored `externalRef` from the unfamiliar-layout workflow and remove the generic-only conflict policy introduced to support it. Exact-artifact idempotency belongs to source evidence; refreshed exports with different bytes are not cross-export idempotent and must be disclosed. Strong/Hevy remain the owner for provider refresh/correction semantics.
- Existing owners only: exact bytes remain owned by document import, completion remains derived from immutable event-ledger history, and the canonical event batch remains the sole workout writer. The new status surface is a bounded projection of that ledger relationship, not persisted state.
- Proof boundary: two independent assistant turns share only the durable vault and exact source bytes. The second must stop before Python or JSONL generation. A separate real CLI race/retry test proves source-precondition rejection, member edit/deletion preservation, one retained source document, and unchanged ordinary event-import supersede behavior.

## Verification

- Commands to run: focused assistant prompt Vitest, assistant-engine typecheck, two independent assistant-turn journeys, synthetic Python CSV transformation followed by source-guarded JSONL dry-run/apply/readback, exact-head required CI, ReviewGPT specialist and final gates.
- Expected outcomes: unknown CSV guidance is present and bounded; a synthetic batch creates only validated workouts, a later exact-source turn stops before regenerating a transformer, and no raw CSV content enters reusable prompt fixtures or public artifacts.

## Round 4 exact-reuse lookup correction

- Review finding: the exact-document lookup treated any `manifest.json` or `manifest.*.json` document artifact as internal metadata and allowed its JSON/schema parse failure to abort every later exact-source import.
- Decision: retain the existing filename prefilter, but treat it only as a candidate. Read errors still surface; candidate JSON or manifest-contract mismatch makes that file ineligible and continues the scan. This fixes existing vaults without reserving member filenames or changing manifest storage.
- Proof: a public core-boundary test first imports member-owned JSON documents with both manifest-like basename forms, then creates and reuses a separate workout CSV source, proves stable identities and no extra raw files, and verifies both unrelated member artifacts remain byte-identical.

## Round 5 deleted-source identity correction

- Review finding: exact reuse considered only live document events. Deleting the preserved source left its raw artifact and workouts intact, but a later replay silently minted a new document/raw identity whose source guard had no history, admitting a duplicate full batch.
- Decision: when verified exact bytes exist only behind a tombstoned document, `--reuse-exact` returns a typed no-write conflict. It never creates a replacement identity; ordinary document import without the replay-safe option remains the explicit create-new path.
- Proof: a real CLI test applies two source-guarded workouts, deletes the source through the public document command, proves exact reuse conflicts with unchanged vault paths and workout count, then proves ordinary import still creates. A real App Server replacement-workspace turn surfaces the deleted-source state and performs no Python or event command.

## Round 6 exact-alias precedence correction

- Review finding: after a source was deleted, explicit ordinary document import could create a live byte-identical alias. Exact reuse returned that alias before honoring the deleted identity, resetting the raw-reference-scoped completion guard and admitting a duplicate batch.
- Decision: a verified tombstone fences the entire exact-byte equivalence set. Exact reuse examines every latest document identity before selecting a live candidate and returns the existing typed no-write conflict when any matching identity is deleted; ordinary import remains an explicit create-new operation but cannot silently reset replay-safe workout identity.
- Proof: the public core and CLI regressions now continue through the supported A-deleted/B-live state, then prove another exact reuse conflicts without changing vault paths or the two-workout history. The replacement-workspace App Server fixture requires that same coexisting state and performs no Python or event command.

## Round 7 apply-authority and timezone corrections

- Review finding: a source could be deleted after preservation and dry-run but before apply. Raw bytes remained, so the source guard admitted the irreversible workout append without revalidating the live document owner.
- Decision: while holding the existing canonical write lock, source-guarded apply now requires a current live document event whose exact source attachment still owns the guarded path and verified bytes. This reuses document lifecycle, attachment metadata, and the event/raw-reference resolver; it adds no lease, registry, or import state.
- Proof: public core and real CLI regressions preserve and dry-run a source, delete it, then prove apply returns a typed conflict with no activity session or event-import audit append. Existing first-apply, retry, edit/delete-history, and concurrent source-guard proofs remain green.
- Review finding: the skill's four-module Python allowlist excluded standard-library `zoneinfo`, so an offsetless wall time plus an IANA timezone could not be converted truthfully across daylight-saving transitions.
- Decision: allow the Python standard library and require `zoneinfo.ZoneInfo` for known IANA wall times. Ambiguous or nonexistent local times fail before write and require one targeted clarification.
- Proof: the real App Server success journey now transforms Chicago winter and summer workouts to distinct `-06:00` and `-05:00` canonical instants with the expected local day keys. A separate spring-forward-gap journey stops before event import and asks for the intended time without exposing the private row.

## Round-cap retrospective

- Original requirement: preserve a large unfamiliar workout CSV, transform it locally without raw-row prompt expansion, apply one validated canonical batch, and make exact-source recovery safe across independent turns.
- First-reviewed versus current shape: the first head relied on model-authored workout identity and kept detailed mechanics resident. Review moved the mechanics on demand, made source evidence and immutable workout-to-raw history authoritative, and exposed deletion/alias/apply-boundary cases in that composed ownership model. Review growth is concentrated in production-boundary and real App Server regressions; production state remains the existing document event, raw manifest, event ledger, and canonical write lock.
- Concepts retained: explicit exact document reuse, derived source-completion status, and one source-guarded append precondition. Concepts removed or rejected: model-authored external references, generic event conflict policy, equality exceptions, registries, replay state machines, leases, and compatibility machinery.
- Cap decision: the user's explicit request to repair and merge the PR authorized one fresh full audit of the corrected head. Round eight ran against the integrated current-base head.

## Round 8 whole-source receipt correction

- Review finding: any historical activity session mentioning the selected raw path was treated as proof that the whole atomic import completed. An ordinary event import or an observable prefix of the multi-file commit could therefore report `imported: true`; exact-byte document aliases could also split status and apply authority across different raw paths.
- Decision: the source-guarded batch now appends a distinct content-derived completion target in its existing audit row, after the event shards in the same canonical batch. Status and apply use one resolver under the canonical write lock and return `completed`, `partial_conflict`, or `not_imported` across every live exact-byte document alias. No registry, lease, or new persisted owner was added.
- Recovery behavior: only the guarded batch audit proves `completed`. Historical workout references without that receipt are `partial_conflict` and fail closed with an explicit recovery error; edits and deletions after a completed batch do not erase its receipt.
- Proof: focused core regressions cover a completion audit backed by source-referencing target events, rejection of a marker-only audit, status waiting behind an active canonical write, durable completion after workout edits/deletion, an unguarded partial import, exact-byte aliases, deleted-source authority, and exact-reuse/status locking. Real CLI tests exercise all three statuses, while the App Server journeys retain completed and not-imported stop/proceed behavior.

## Round 9 ordinary-document lock correction

- Review finding: the round-eight correction unnecessarily placed every ordinary create-new document import under the outer canonical write lock, holding the vault-wide owner through unbounded source copy and hashing even though `WriteBatch.commit` already serializes canonical effects.
- Decision: restore the exact-reuse-only outer lock. Exact reuse still serializes inspect-before-create identity selection; workout status and guarded apply remain locked. Ordinary imports keep fresh generated identities and stage outside the outer lock, while their commit remains canonical-lock protected. The alias-wide content receipt makes either ordinary-alias ordering resolve the same completion state.
- Proof: the public boundary regression now proves ordinary import bypasses the outer scope while exact reuse and status enter it. One core test covers an ordinary alias committed before guarded apply. A deterministic cross-process test holds the canonical lock, lets an ordinary same-byte import finish all four staging actions and block before commit, then reuses and applies through the existing alias before releasing the ordinary commit; both aliases report `completed`, exactly one guarded receipt exists, and retries through either alias reject.

## Round 10 same-turn apply resolution

- Review finding: after a source-guarded apply process returned without a trusted receipt, the assistant stopped until a later turn even though it still held the raw reference and unchanged JSONL needed to resolve the outcome immediately.
- Decision: a definitely exited child triggers an immediate digest verification and exact-source status check. `completed` confirms the original commit without another apply, `partial_conflict` stops, and `not_imported` permits one recovery apply of the same verified bytes. Unknown termination, changed bytes, unavailable status, or an untrusted lock remains fail-closed.
- Proof: production-shaped App Server journeys cover both a committed apply whose receipt was lost and a pre-commit process failure. The first performs one apply plus bounded readback; the second proves `not_imported`, performs one same-byte recovery apply, and confirms canonical state. No path permits more than one successful canonical apply.

## Round 11 damaged-source evidence correction

- Review finding: exact-source discovery started from manifest-like filenames and silently discarded malformed manifests plus missing or drifted artifacts. A canonical document whose mandatory evidence was damaged could therefore look absent, allowing a replacement identity and duplicate workout history.
- Decision: canonical document event history now identifies owners claiming the incoming digest. Each owner derives and verifies its one expected manifest and raw artifact; missing, malformed, owner-mismatched, or digest-drifted evidence returns an existing integrity or missing-evidence failure without writing. Only the complete absence of a claiming canonical document may create a new identity. Deleted-alias precedence and the shared status/apply resolver remain unchanged.
- Complexity collapse: delete vault-wide manifest-basename discovery and its parse-failure candidate exception. Member documents named like manifests are irrelevant unless their canonical attachment actually claims the incoming digest; no registry, repair state, or compatibility reader is added.
- Proof: core regressions cover missing/malformed/owner-mismatched sidecars, missing artifacts, digest drift, status/apply failure, unchanged completion receipt count, and one retained workout. A real CLI journey proves no replacement document or replay, and a replacement-workspace App Server journey stops before Python or event import with an explicit evidence-recovery explanation.

## Round 12 orphaned-source evidence correction

- Review finding: event-only discovery still treated an absent or contract-invalid source-document event as true source absence even when the valid owner-bound manifest, verified raw artifact, workout history, and completion receipt survived. Exact reuse could mint identity B and admit a duplicate full history.
- Decision: the existing resolver now reconciles valid event-derived claims with schema-valid, self-consistent manifest/artifact claims for the incoming receipt. Either side without its matching owner fails with the existing damaged-evidence conflict; only absence from both roots may create a document. Manifest-like member files remain irrelevant unless they satisfy the full internal schema, derived path, owner-bound directory, single-source, and verified-byte proof.
- Complexity collapse: reuse the existing manifest parser, path resolver, owner matcher, artifact hasher, event lifecycle collapse, canonical lock, and typed errors. The correction adds no registry, repair state, compatibility reader, queue, or new durable owner, and each stored artifact is hashed once per lookup.
- Proof: core tests remove the source event or make it JSON-readable but contract-invalid after a successful guarded import, then prove reuse/status/apply fail closed with one workout and one receipt retained. Real CLI cases snapshot every vault file before all rejected attempts and prove byte-for-byte no-write behavior. Sequential replacement-workspace App Server cases stop before Python or event import for both missing-manifest and orphaned-event evidence.

## Round 13 source-authority retrospective

- Repeated failure mechanism: source recreation accumulated separate event-ledger, manifest-tree, raw-artifact, workout-reference, and completion-audit discovery paths. Every new corruption permutation could erase both currently consulted roots while leaving another durable signal that made true absence unsafe. Adding another scan would preserve the same incomplete-closure architecture.
- Single owner and key: the existing successful `core.importDocument` audit row now owns recreation identity through one content-derived `raw-source-v1:sha256:<digest>:bytes:<length>` target followed by exactly one document id and event id. Ordinary and exact-reuse document creation both write that receipt. The document event owns lifecycle and selects the derived manifest/raw projection; the existing guarded-batch audit reuses the same receipt and names its committed activity-event ids.
- Decision closure: no matching source receipt and no authenticated guarded completion means the source is absent and may be created. A source receipt requires its selected canonical event, lifecycle, manifest, and artifact to agree and verify; any missing or invalid projection is damaged. A guarded completion counts only when one of its named activity events survives. If authenticated completion survives without the source receipt owner, the evidence is damaged and creation is forbidden. A verified source with no completion is either `not_imported` or `partial_conflict` from its historical activity references; a verified source plus authenticated completion is `completed` even after workout edits or deletion.
- Explicit corruption boundary: deleting every canonical source and completion audit receipt destroys the recreation owner itself. Raw files, manifests, and events are verified projections, not alternate authorities, and do not reconstruct a deleted owner. Supporting owner deletion would require a separate registry or a second discovery owner and is outside this import contract.
- Complexity collapse: remove vault-wide manifest discovery plus the separate completion-audit scan and raw-reference event scan. One audit pass selects source/completion owners; one event pass resolves only those owners and indexes activity provenance; the existing manifest resolver and artifact hasher verify the selected projection. No registry, compatibility reader, repair state, queue, or new ledger is introduced.
- Proof matrix: focused core and real CLI regressions cover absent source; valid live source; tombstoned source; live exact aliases; completion with edits/deletion; partial activity history; missing/malformed/mismatched manifest; missing/drifted raw bytes; missing/contract-invalid selected source event; and surviving workout plus completion evidence after the source event, manifest, and source-owner audit are removed. Replacement-workspace App Server cases prove each damaged class stops before Python or event import.

## User-directed ReviewGPT update

- Before round 14 completed, the user requested the latest ReviewGPT. The npm `latest` tag, registry metadata, provenance attestation, signature, and matching GitHub release identify `@cobuild/review-gpt` 0.5.131.
- Update the root dependency range, minimum-release-age exception, installed package, and committed lockfile together. Keep the existing Murph presets, browser lanes, packaging, and review process unchanged.
- Run the dependency guards/audit, ignored-build inspection, installed-version proof, focused review-control coverage, and exact-head CI before rerunning round 14 with 0.5.131.
- Local proof: frozen install, dependency-policy tests, the package-backed runner contract, ReviewGPT preflight/concurrency tests, CLI typecheck, and `pnpm deps:guard` pass; the installed binary reports 0.5.131. The lockfile changes only the direct ReviewGPT package from 0.5.127 to 0.5.131 and leaves its transitive graph unchanged.
- Audit boundary: `pnpm deps:audit` still reports the repository's existing advisory set, including transitive paths through the unchanged `repomix@1.16.0` graph. This direct-version update introduces no new transitive versions; resolving that broader pre-existing advisory inventory is outside this PR.
- Base reconciliation: current `main` independently landed the same ReviewGPT 0.5.131 package, lockfile, and runner-contract update. Delete the now-redundant dependency/test delta from this PR, retain the installed-version and focused proof, and review the workout-import patch with the latest runner.

## Round 14 hosted-scratch ownership correction

- Review finding: the unfamiliar-layout workflow created its helper, transformed JSONL, digest, and command receipts at the hosted vault root. Because ordinary root files are included in workspace snapshots, a successful or interrupted import could persist duplicate private workout data and noncanonical recovery receipts outside the document/import-audit owners.
- Decision: create one private attempt directory beneath the existing `.runtime/tmp/workout-csv-import/` scratch owner. Keep every helper, inspection/schema receipt, JSONL, digest, apply/status/readback receipt, error, and summary there; remove the directory after success, clarification, or handled failure. An interruption remains safe because `.runtime/tmp/**` is already excluded from hosted snapshots, and later-turn recovery continues to derive only from canonical source/import-audit state.
- Complexity collapse: reuse the existing hosted scratch namespace, snapshot exclusion, and canonical recovery owners. Add no durable receipt, registry, cleanup service, lifecycle state, or dependency.
- Proof: the real App Server journeys now create and consume the helper within the same private attempt, clean the directory across success, exact-source replay, pre-commit retry, lost apply receipt, daylight-saving clarification, deleted source, and damaged source evidence, and inspect a real hosted snapshot after each. A simulated interrupted attempt retains private scratch files on disk while the hosted bundle proves that no `.runtime/tmp/workout-csv-import/**` path is included.
- Focused verification: the success/replay plus pre-commit group passes (2 tests), the lost-receipt case passes (1 test), the clarification/deleted/damaged-source group passes (5 tests), `@murphai/assistant-engine` typecheck passes, and `git diff --check` passes. One earlier combined local run saturated the warm App Server after a timed-out two-cell scripted sequence; collapsing each journey to one bounded skill-read-plus-import cell removed that harness contention, and the final focused groups pass with the production behavior unchanged.
