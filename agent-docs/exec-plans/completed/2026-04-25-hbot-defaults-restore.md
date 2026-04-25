# Restore HBOT Protocol Defaults

## Goal

Restore structured HBOT default dose/schedule fields that were removed during the HBOT QA hardening pass, while preserving the safety and evidence-classification corrections.

## Scope

- `packages/health-commons/content/protocols/hyperbaric-oxygen-therapy/hyperbaric-oxygen-therapy.md`
- Directly coupled generated Health Commons catalog outputs if the protocol page changes.

## Constraints

- Keep `protocolEvidence` stance/result changes from the QA pass intact.
- Keep the clinician-supervised safety boundary intact.
- Phrase defaults as a tracking template that must be replaced by the actual clinician/facility plan.
- Preserve unrelated dirty work in the shared tree.

## Verification

- Run focused Health Commons typecheck/generation checks.
- Run `git diff --check` on touched Health Commons files.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
