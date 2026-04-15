# Greenfield Canonicalization

## Goal

Remove repo-local naming and compatibility residue that still treats the current system as multi-version (`v2`, `v3`, later cutover labels) or migration-oriented when the repo should present a single canonical greenfield baseline on current `v1` contracts.

## Why

- The product is still greenfield and has no live deployments to preserve.
- Version-suffixed naming and compatibility shims create avoidable maintenance branches and misleading public semantics.
- The repo policy already says compatibility shims should be temporary; this pass hard-cuts the ones that are now obsolete.

## Scope

- Repo code, tests, docs, and config that still expose non-canonical version labels or backward-compatibility seams for superseded paths/schemas/routes.
- Focus on files not already owned by active ledger rows unless overlap is unavoidable and safe.

## Constraints

- Preserve unrelated in-flight worktree edits.
- Avoid files already under active ledger work unless the change is clearly disjoint.
- Keep Cloudflare/Workers migration metadata valid; do not rename platform-required fields blindly.
- Remove compatibility logic only where the greenfield assumption makes the cutover safe inside this repo.

## Verification

- `pnpm typecheck`
- `pnpm test:diff <touched paths...>` when truthful for the touched owners; otherwise use the owner-level verification command from `agent-docs/operations/verification-and-runtime.md`

## Notes

- Discovery uses 5 parallel `gpt-5.4` high subagents plus local repo scans.
- Treat vendored/generated outputs and third-party licenses as out of scope unless the task clearly requires otherwise.

Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
