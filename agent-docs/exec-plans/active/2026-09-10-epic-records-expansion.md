# Expand connected clinical record coverage and lifetime history

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and invariants

Acquire the available lifetime record through the member's authorized provider connection and make the retained evidence useful to Murph. Cover structured clinical history, document bodies, historical acquisition, common measurements/report results, and additional patient-facing record variants. Provider-side release/access limits remain explicit; a bounded job finishing does not prove complete source coverage.

Preserve patient binding, source provenance, revision ordering, consent/disconnect fencing, bounded provider work, and foreground preemption. No provider credentials or private clinical values enter orchestration, logs, or source artifacts.

## Existing owners and proven gaps

Web owns Epic policy, registration, credentials, provider egress and run admission. Clinical-records owns pure manifests/plans; importers owns normalization; vault-usecases and core own raw/canonical persistence; assistant-runtime owns resumable maintenance. Extend those boundaries rather than introduce a second integration platform.

Source inspection proves missing height/BMI and common-code mappings; unimplemented clinical families; inline-only note import without dependency reads; frozen recent windows; whole-slice/batch and eight-generation limits. Revalidate each affected path against the implementation base before editing.

## PR sequence

1. Common clinical measurement mappings and canonical readback.
2. Source-versioned clinical history, including diagnoses, medications and positive allergies.
3. Authorized document/reference acquisition and report content.
4. Lifetime acquisition with durable bounded continuation and truthful incomplete coverage.
5. Additional verified patient-facing clinical document/data variants.

Keep each PR independently reviewable where possible; use explicit dependencies when shared contracts require ordered delivery. This plan follows the series until all requested areas have concrete PRs and required evidence.

## Product UX

- Entry: an existing private provider connection and consent flow.
- Promise: relevant records across available history become usable without a new date-range selection.
- Journeys: old versus recent records, large versus sparse charts, linked versus inline documents, narrowed grants, corrections/retractions, failed pages, preemption, revoked access.
- Proof: synthetic provider-shaped acquisition through canonical readback; focused assistant proof when usability depends on model behavior.
- Exclusions: no production registration mutation, provider contract/spend, population bulk authorization, or deployment in this task.
- Done when: scoped PRs implement the five areas, tests and typechecks pass, exact-head CI and required ReviewGPT are resolved, and external prerequisites are identified.

## State, failure and evolution

Canonical evidence and clinical facts stay in the vault. Operational continuation stays with current run/checkpoint owners, with schema/version seams and bounded storage. Do not remove safety bounds to simulate completeness. Preserve completed batches and source identity across continuation. Distinguish missing provider data from unavailable/unfinished acquisition; never infer deletion from search absence.

New wire shapes require consumer-first rollout and mixed-version proof. Each PR states its own deploy and rollback boundary. Resume and token failures must retain progress without restoring revoked authorization.

## Verification and completion

For every PR: focused regressions, relevant package/app typecheck, canonical readback for new facts, authored-TypeScript complexity diff, privacy review, affected owner documentation and changelog. Draft-first PR; start exact-head ReviewGPT concurrently with required CI once ready. Keep open-PR worktrees.

## Progress

- Repository/documentation audit and independent advisory review completed before implementation.
- Dedicated implementation checkout created from current origin/main.
- Implementation and verification pending.
