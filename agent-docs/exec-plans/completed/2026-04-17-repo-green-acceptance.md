## Goal

Get the repository back to a fully green canonical verification state on current `main`.

## Scope

- acceptance and owner-level verification failures surfaced by `pnpm verify:acceptance`
- the smallest production or test fixes required to make the failing lane pass
- any focused follow-up verification needed to prove each fix before rerunning the full lane

## Constraints

- Preserve unrelated in-flight work already registered in `COORDINATION_LEDGER.md`.
- Leave the pre-existing audit-bundle tooling edits untouched unless they are directly responsible for a failing required check.
- Prefer the smallest truthful fix per failure instead of broad cleanup or opportunistic refactors.

## Verification

- `pnpm verify:acceptance`
- focused reruns for any failing owner/package/app while iterating
- rerun `pnpm verify:acceptance` after fixes land
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
