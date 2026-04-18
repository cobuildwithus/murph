## Title

Cut hosted assistant delivery over to the shared outbox mirror and delete the Cloudflare journal seam.

## Goal

Make hosted post-commit assistant delivery recover from the shared portable outbox mirror/local vault state instead of the Cloudflare-only assistant-delivery journal, while preserving idempotent versus non-idempotent correctness.

## Constraints

- Stay within `packages/assistant-runtime/**`, `apps/cloudflare/src/runtime-platform.ts`, `apps/cloudflare/src/runner-outbound/results.ts`, `apps/cloudflare/src/side-effect-journal.ts`, `apps/cloudflare/test/runner-platform.test.ts`, `apps/cloudflare/test/index.test.ts`, `apps/cloudflare/test/side-effect-journal.test.ts`, and directly related Cloudflare README/lifecycle references if needed.
- Do not touch `apps/cloudflare/src/user-runner/**` or unrelated `apps/web/**`.
- Preserve overlapping hosted stateless-executor work and avoid reverting others' edits.
- Keep the result shape compatible where practical; `journalMethod` and `journalStatus` may become inert/null if the journal seam disappears.

## Investigation Questions

1. Which remaining hosted callback branches still require the Cloudflare journal versus the portable outbox mirror?
2. What Cloudflare route/platform surface can be removed immediately without broadening into unrelated runner recovery code?
3. Which tests need to shift from journal-backed expectations to mirror-only semantics for idempotent and non-idempotent sends?

## Planned Verification

- `pnpm typecheck`
- Focused assistant-runtime and Cloudflare Vitest coverage for the touched files, using the smallest truthful slice available

## Notes

- This is the Workstream 2 delivery-ownership flip from `agent-docs/exec-plans/active/2026-04-18-cloudflare-stateless-executor.md`.
- Prefer hard deletion over compatibility scaffolding because the repo is greenfield for hosted execution.
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
