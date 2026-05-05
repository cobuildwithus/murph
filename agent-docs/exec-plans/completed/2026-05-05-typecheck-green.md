# Typecheck Green

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

Restore `pnpm typecheck` to green on the current checkout.

## Success criteria

- `pnpm typecheck` completes successfully.
- Any code changes are limited to the concrete typecheck failures surfaced by the command.
- Existing unrelated working-tree edits and active plan lanes are preserved.

## Scope

- `scripts/check-hosted-crypto-hardcut.mjs`
- Additional files only if later `pnpm typecheck` output surfaces concrete failures.

## Constraints

- Do not revert or overwrite unrelated edits.
- Do not expose secrets, local paths, local usernames, or personal identifiers in code, docs, logs, or final handoff.
- Avoid speculative cleanup; fix the typed contract or import/export mismatch that actually fails.

## Verification

- First `pnpm typecheck`: failed in hosted crypto hard-cut guard because an ignored generated Cloudflare deploy artifact under `apps/cloudflare/.deploy/` was scanned.
- Passed: `pnpm typecheck`.
- Passed: `node --check scripts/check-hosted-crypto-hardcut.mjs`.
- Passed: `node scripts/check-hosted-crypto-hardcut.mjs`.
- Passed: scoped `git diff --check` for the guard, plan, and ledger files.
- Passed: scoped identifier/privacy scan for the guard and plan files.
- Local final review: passed for tiny repo-internal tooling fast path.

## State

- Now: typecheck is green after the guard skips the ignored generated deploy artifact directory.
- Next: close this plan and attempt the scoped commit if unrelated dirty work does not block it.
Completed: 2026-05-05
