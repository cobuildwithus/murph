# Route lasting corrections to their canonical owner

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Goal

- Lasting corrections update the state consumed by future behavior, at the intended scope, before confirmation.

## Success criteria

- Shared direct/group guidance owns the rule without report-specific instructions.
- Deterministic scope and authorization proof passes.
- Real Codex preserves a task-scoped correction across fresh reports, saves a broad reply preference, and keeps a one-off revision local.
- Relevant tests, typecheck, parent review, and exact-head CI pass.

## Scope and constraints

- Replace the automation-only correction rule with one shared instruction at the existing delegated-initiative owner.
- Keep the original group report as regression evidence; make row presentation guidance evidence-based rather than tied to one name format.
- Reuse canonical automation and personalization tools. No new state, storage, effect authority, or production mutations.
- Preserve the completed original plan as historical evidence.

## Risks and mitigations

- Overbroad persistence: distinguish task scope, broader preference scope, and one-off revisions; preserve unrelated state and consent.
- False success: confirm only authoritative results and state when the future change was not saved.
- Identity inference: presentation may use only current-row evidence and preserve distinctions and unknowns.

## Tasks

1. Add failing shared-rule assertions, then replace the automation-only guidance.
2. Replay report persistence and broader preference versus one-off correction with real Codex.
3. Review, update the existing PR, and verify its final head.

## Decisions

- Product UX effort: Patch. Affected journeys are lasting task corrections, broad preferences, one-off revisions, and unavailable owners.
- Prompt-primary change; canonical state and authorization mechanisms are unchanged. Parent candidate review owns the final review route.

## Verification

- New direct/group assertions failed before the change.
- Focused five-file Assistant Engine slice: 45 tests passed. Assistant Engine typecheck passed.
- Real Codex broader preference and one-off scenarios passed: exactly one scoped preference update versus no tools or writes.
- Diagnostic report replays exposed saved worked examples and collapsed distinct labels; the shared rule now requires reusable instructions over fresh inputs, and generic presentation guidance forbids collapsing distinct source labels. The final report replay passed: one inspect, one canonical patch, and one shared read in each of two fresh sessions, with current-row attribution, collisions, and unknowns preserved. All synthetic replies reviewed Ready.
- Complete first provider input measured for identical private and group fixtures; exact tokenizer unavailable, so only bytes are claimed.
- Changelog production-render slice: 10 tests passed. Complexity and docs-drift guards passed.

- Parent review: prompt-primary change with unchanged canonical owners, protocols, and authorization; no final ReviewGPT required by the completion route. No new repository-actionable Frog entry.
- PR #3697 will record required CI on the final pushed head. No production changes.
Completed: 2026-09-24
