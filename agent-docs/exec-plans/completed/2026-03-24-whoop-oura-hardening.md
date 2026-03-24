# WHOOP/Oura Hardening Integration Plan

## Goal

Merge the supplied WHOOP/Oura hardening patch series onto the current workspace state while preserving overlapping device-sync work already in progress.

## Scope

- Hosted OAuth callback error redirects in `apps/web`
- Local `device-syncd` OAuth callback/webhook handling
- WHOOP/Oura provider validation semantics
- Focused regression tests and minimal docs/config surfacing for new Oura webhook verification support

## Constraints

- Do not overwrite unrelated dirty worktree edits.
- Keep the change aligned with the supplied patch behavior unless current repo drift requires a minimal adaptation.
- Run the required completion workflow and repo verification commands unless blocked by a credible unrelated issue.

## Planned Steps

1. Inspect current file drift against the supplied patch and merge conflicts manually where needed.
2. Implement callback/webhook/provider/config changes with regression tests.
3. Run simplify, coverage, and finish-review audit passes; then run required verification.
4. Commit only the touched files and remove the active ledger row.
