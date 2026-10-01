# Improve literal evidence selection for clinical extraction

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Outcome and invariant

Recover supported clinical facts with exact source excerpts. Preserve strict host admission, source identity, read-only extraction, dates, and replay safety.

## Owner and evidence

The existing assistant-engine structured extraction instructions own model guidance. The vault-usecases validator requires contiguous literal excerpts. Inspection confirms a quoting failure can hold an otherwise supported proposal. Improve instructions at their existing owner; no fuzzy matching, new state, retries, dependencies, or schema changes. Source auditing also exposed a substituted terminology namespace despite an exact excerpt. The existing host evidence gate now requires assertion code/system pairs to occur together in the selected source.

## Scope and UX

Patch: clearer exact-copy guidance and context preservation for structured resources only. Narrative and JSON-field evidence must work, missing units must remain blocked, adjacent records must remain excluded. Original source files and existing canonical facts must remain unchanged. Attachment extraction and foreground replies are unchanged. Correct code/system pairs remain accepted; fabricated codes, shortened systems, mixed pairs, and missing namespaces remain held.

## Tasks

1. Clarify evidence selection and cover the assembled instructions.
2. Extend the synthetic live journey with JSON-field evidence; run focused tests and typecheck.
3. Run subscription-backed extraction in a disposable isolated vault, audit results, and verify unchanged originals and replay safety. Keep all private inputs and outputs outside tracked artifacts.
4. Review the diff, close the plan, and commit the scoped change. Follow applicable PR completion gates.

## Verification

- Engine extraction tests: 23 passed; composed runtime tests: 15 passed; vault enrichment tests: 32 passed.
- Engine, runtime, and vault typechecks passed.
- Synthetic Luna live narrative and JSON-field journeys passed using local subscription auth, one provider call each, exact result/date quotes, no writes, and missing-unit/adjacent-source exclusions. The JSON-field test also requires the quoted value and unit after catching an initially truncated excerpt.
- Consented private source comparison and unchanged-original/replay checks passed. Private evidence stays outside repository artifacts. A namespace mismatch prompted an additional deterministic guard. Production-path replay blocks that frozen proposal while preserving supported siblings and replay idempotency. A fresh subscription-backed call on the affected source also passed host validation and unchanged-original checks.
- Scenario-manifest coverage and docs drift passed. Complexity passed against the pre-follow-up head with no increased debt. Parent review confirmed strict literal matching, exact coding pairs, unchanged attachment behavior, no new persisted state or extra model calls, and source-bounded iterative indexing.
- Changelog: existing clinical-structured-recovery entry already covers this same unshipped PR outcome; no separate release claim.

## Deployment and failure

Prompt-only change to the existing structured leaf; failures stay held by unchanged host validation. No persisted schema or rollback compatibility change. No production mutation authorized.

## Completion

Local implementation and proof complete, with Product UX Ready for the covered source-recovery and held-evidence journeys. Existing PR completion gates track the pushed candidate; no merge or deployment is included.
Completed: 2026-09-29
