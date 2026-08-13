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

## Verification

- Commands to run: focused assistant prompt Vitest, assistant-engine typecheck, synthetic Python CSV transformation followed by JSONL dry-run/apply/replay/readback, exact-head required CI, ReviewGPT specialist and final gates.
- Expected outcomes: unknown CSV guidance is present and bounded; synthetic batch creates only validated workouts, replay skips existing events, and no raw CSV content enters reusable prompt fixtures or public artifacts.
