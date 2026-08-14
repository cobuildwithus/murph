# General Workout CSV Import

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Let Murph safely import an unfamiliar large workout CSV by inspecting and transforming it locally, then committing canonical workout records through the existing atomic bulk event importer.

## Success criteria

- Strong and Hevy exports continue to use the dedicated workout CSV importer.
- An unfamiliar workout CSV is handled locally without placing raw rows in the reusable prompt or making one model/tool call per set.
- Murph reads the exact activity-session JSONL schema, requires explicit consequential mappings and units instead of guessing, dry-runs the complete batch, and applies only after validation succeeds.
- Exact-source retries stop from durable raw-reference history without regenerating or comparing a model-authored transform.
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
