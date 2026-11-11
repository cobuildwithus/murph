# Complete canonical type composition at downstream callers

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Resolve the downstream contract mismatches exposed when the canonical simplification candidate replaced its shadow core API with the actual owner type. Keep existing writers and output shapes unchanged.

## Scope and decisions

- Add the two group-room audit actions already emitted by existing canonical writers to the canonical audit enum. Reusing a different action would change meaning and leave historic rows invalid. No new writer, state or migration is introduced.
- Express the existing assessment proposal object as a closed type alias, preserving every field. Remove the redundant intake service interface and cast so the CLI uses the declared owner result with its existing output schema.
- Preserve completed implementation records. This follow-up is driven by exact-head Ready CI at 3038e8baaf9b.
- Root owns final review, Ready, CI completion and merge; this lane cannot merge or deploy.

## Product UX

- Effort: Not applicable: internal contract acceptance and TypeScript composition; existing room-model writes and CLI output are unchanged.
- Result: Ready for the scoped correction; root owns the new exact-head CI and external review.

## Verification

- Reproduced the audit bug with real room-model replacement/deletion: canonical audit parsing rejects the persisted action before the enum correction.
- Passed: actual intake-project CLI roundtrip (1 test), group-room suite including real audit parsing (8 tests), contract schema catalog (13 tests), regenerated artifact verification, and typechecks for contracts, core, CLI and assistant-engine.
- `pnpm complexity:diff --base 3038e8baaf9be7f7dd0946b71ba3a0a77761b7fd` passed with no increased debt. Only the audit-record generated schema changed after contract regeneration.
- The first external review passed on the immutable original candidate. The audit parser accepts existing persisted values after this fix, so root should route a substantive follow-up review for this newly changed contract surface.

## Handoff

Root approved the minimal correction diff. Preserve the first reviewed head and its PASS result; keep the PR Draft during push. Root marks Ready and runs the full-snapshot second review for the new accepted-value parser contract. Existing writers still emit exactly the same room-model audit actions; no migration or deployment was performed.
Completed: 2026-11-10
