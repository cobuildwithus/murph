Goal (incl. success criteria):
- Extract a headless `@healthybob/assistant-runtime` package for hosted execution, move Cloudflare onto it, remove the Cloudflare `@ts-nocheck` seam, and stop serializing container jobs only because hosted runs mutate global process env.

Constraints/Assumptions:
- Preserve encrypted hosted bundle restore/snapshot and existing commit/finalize/outbox durability.
- Do not revert unrelated dirty work in `apps/cloudflare`, `packages/cli`, or docs.
- Keep the new package headless and typed; no CLI UI/command graph migration in this turn.
- Assume a pragmatic intermediate shape is acceptable if Cloudflare no longer consumes `healthybob` as its hosted runtime surface and the runtime API is explicit/context-driven.

Key decisions:
- Create `packages/assistant-runtime` as the hosted runtime surface.
- Use explicit runtime context/config objects and per-job isolation instead of container-global env mutation.
- Keep the extraction focused on hosted execution helpers rather than a wholesale assistant-core migration out of CLI internals.

State:
- completed_with_unrelated_repo_blockers

Done:
- Read repo routing/architecture/reliability/security/verification docs and the active coordination ledger.
- Inspected the current Cloudflare hosted runner, tests, and CLI runtime exports.
- Identified that the hosted runner only needs a narrower runtime slice than the full CLI surface.
- Added `packages/assistant-runtime` as the headless hosted execution surface and moved Cloudflare runtime imports onto it.
- Removed the Cloudflare `@ts-nocheck` seam and the app-local typecheck exclusions for the Node runner/container entrypoint path.
- Switched the default hosted execution mode to isolated child-process runs so per-user env overrides no longer require container-wide request serialization.
- Updated focused Cloudflare tests to assert concurrent hosted execution and verified them with direct Vitest runs.
- Updated architecture and verification docs to describe `@healthybob/assistant-runtime` as the hosted runtime boundary.

Now:
- Record unrelated verification blockers and hand off the landed runtime extraction.

Next:
- Follow up separately on the pre-existing `packages/hosted-execution/src/auth.ts` `BufferSource` type errors and the repo hygiene guard failure on tracked `apps/web/postcss.config.mjs`.
- Consider a later extraction of the remaining hosted assistant internals that still compose `healthybob` exports behind `@healthybob/assistant-runtime`.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the final package should remain a hosted-runtime wrapper around current assistant internals or fully subsume those internals in a later follow-up.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-27-assistant-runtime-extraction.md`
- `CONTINUITY_assistant-runtime-extraction.md`
- `apps/cloudflare/src/{index.ts,node-runner.ts,container-entrypoint.ts,runtime-adapter.ts}`
- `packages/assistant-runtime/**`
- `ARCHITECTURE.md`
- `agent-docs/{index.md,operations/verification-and-runtime.md,references/testing-ci-map.md}`
- `apps/cloudflare/README.md`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --maxWorkers 1 --no-coverage apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/container-entrypoint.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
