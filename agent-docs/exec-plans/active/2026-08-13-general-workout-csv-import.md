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
- Stable external references make a repeated transformed import idempotent when the source provides stable workout identity.
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
2. Risk: Retrying an import duplicates workouts.
   Mitigation: derive stable privacy-safe external references from source identity when available; otherwise disclose append-only behavior before apply.
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
- Replay equivalence: the source boundary is exact file bytes; the event boundary is the current canonical workout payload, including the stable reused raw locator. A source-backed workout key owns the cross-turn `externalRef`; row position and refreshed-export coincidence do not.
- Provenance side effects: an identical `--reuse-exact` document import returns the existing live document and creates no raw artifact, document event, or audit row. A different source creates a new document. A changed workout under the same stable source identity still rejects the complete event batch and leaves the previously imported workout untouched.
- Proof boundary: use two independent real CLI invocations over the real document importer and core event batch owner to prove exact-source document reuse, unchanged replay skip, changed-content rejection, one retained source document, and unchanged default supersede behavior. The App Server scenarios remain model-routing proof only; they do not claim to emulate document-store identity.

## Verification

- Commands to run: focused assistant prompt Vitest, assistant-engine typecheck, synthetic Python CSV transformation followed by JSONL dry-run/apply/replay/readback, exact-head required CI, ReviewGPT specialist and final gates.
- Expected outcomes: unknown CSV guidance is present and bounded; synthetic batch creates only validated workouts, replay skips existing events, and no raw CSV content enters reusable prompt fixtures or public artifacts.
