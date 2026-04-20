## Title

Stop hosted-wake coalescing from mutating rows already handed to a run.

## Goal

Ensure coalescing wake appends only rewrite truly non-acquired wake rows so an active run never sees its in-flight wake mutated underneath it.

## Scope

- `apps/web/src/lib/hosted-wake/store-data.ts`
- `apps/web/test/hosted-wake-store-data.test.ts`
- required verification and audit artifacts for this narrow `apps/web` hosted-wake slice

## Constraints

- Preserve unrelated dirty-tree work across `apps/web`, `apps/cloudflare`, and hosted-runtime lanes.
- Keep the behavioral change minimal: tighten coalescing eligibility rather than redesigning wake scheduling.
- Match the web-owned hosted-wake/cursor contract in `ARCHITECTURE.md` and `agent-docs/references/hosted-run-protocol.md`.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-wake/store-data.ts apps/web/test/hosted-wake-store-data.test.ts`
- planned: direct diff hygiene with `git diff --check`

## Notes

- The intended invariant is that only `state: "pending"` plus `runId: null` rows remain eligible for in-place coalescing replacement.
- If a matching wake is already running, the append path should fall through to creating a new row rather than mutating the active one.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
