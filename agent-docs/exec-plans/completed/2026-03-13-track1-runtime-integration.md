# Track 1 Runtime Integration

## Goal

Land the follow-up runtime integration so inbox ingestion can auto-drain attachment parse jobs through parser-owned wrappers instead of requiring separate manual worker wiring.

## Scope

- `packages/inboxd`: add filtered parse-job claims plus replay/reset support for attachment parse jobs.
- `packages/parsers`: add parser-service helpers, parsed inbox pipeline wrappers, and worker filter support.
- Focused runtime tests only if current coverage does not already protect the new behavior.

## Constraints

- Preserve unrelated in-flight work in the dirty tree.
- Do not touch parser adapter behavior in this track.
- Keep queue state rebuildable from runtime/canonical evidence.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Prefer targeted package tests during implementation before the full required pass.

## Notes

- Based on the user-provided track 1 patch and landing plan.
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
