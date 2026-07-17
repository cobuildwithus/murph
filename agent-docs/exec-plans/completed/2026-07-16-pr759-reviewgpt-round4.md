# PR 759 ReviewGPT round 4 remediation

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Resolve the accepted ReviewGPT round-3 authority inversion so editable live status and run-plan windows cannot revoke a valid saved outcome or bypass canonical terminal evidence bounds.

## Success criteria

- The browser query resolves the exact referenced outcome plus stable experiment identity before deriving a saved run's completed/stopped presentation.
- For a referenced outcome, canonical `endedOn` compared with the saved outcome intervention end determines whether the result is finished or stopped; edited live status/windows cannot reverse that decision.
- Canonical `endedOn` bounds every live evidence consumer regardless of later supported status edits.
- Production-faithful tests cover live plan extension, status edits, shortened live plan after a true early stop, and post-stop rolling/anchored/event/adherence/context evidence.
- Required focused/full verification, audits, exact-head CI, and ReviewGPT round 4 are green.

## Scope

- In scope: browser query outcome resolution and run-context derivation, affected web projection, focused runtime/query/web proof, matching durable docs/PR contract.
- Out of scope: outcome persistence changes, lifecycle mutation restrictions, new historical selection, state repair/backfill, compatibility owners, queues, or migrations.

## Constraints

- Preserve direct safe-path, schema, exact-reference, generated-at, and stable experiment identity validation.
- Use existing canonical `endedOn` and saved outcome windows; add no new durable state or lifecycle owner.
- Keep ReviewGPT as the sole cross-cutting gate; do not run local `deep-review`.

## Review finding and decision

- Accept the round-3 High finding as production-reachable: `updateExperiment` can retain `outcomeRef` and `endedOn` while changing live status/runPlan, but query admission currently derives phase and evidence horizon from those mutable fields first.
- Continue the completed retrospective's redesign-by-deletion decision: make saved outcome resolution an input to run-context derivation, remove the downstream live-phase admission gate, and use canonical `endedOn` as the unconditional terminal horizon.

## Tasks

1. Add failing supported-mutation regressions for both false-stop and false-finish directions plus status-edited post-stop evidence.
2. Resolve the exact referenced outcome before run-context phase derivation and derive saved-result stop semantics from saved windows.
3. Route terminal evidence through canonical `endedOn` independent of live status and keep no-saved runs on existing live behavior.
4. Run required coverage/frontend audits, Fable review if the rendered projection changes, focused/full verification, and parent final review.
5. Close the plan with a scoped commit, push, update the PR body, and run ReviewGPT round 4 with CI.

## Verification

- Focused assistant-runtime/query/web mutation-path tests.
- Truthful `pnpm test:diff` for every touched owner.
- Required `coverage-write` and `frontend-review`, plus Fable when applicable.
- Exact-head CI and ReviewGPT correction round 4.
Completed: 2026-07-16
