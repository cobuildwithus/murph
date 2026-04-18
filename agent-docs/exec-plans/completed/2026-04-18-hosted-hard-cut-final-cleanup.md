## Goal (incl. success criteria)

Land the final wake-first hosted hard-cut cleanup so the live hosted path matches the canonical hosted wake cutover shape: explicit wake lanes in runtime, web-owned cron materialization, thinner Cloudflare ownership, wake-native shared contracts/status naming, and durable docs aligned with the actual model.

Success criteria:
- `packages/assistant-runtime` no longer routes hosted wake execution through generic dispatch/maintenance semantics on the hot path.
- cron wake materialization is web-owned and Cloudflare alarm behavior is reduced to nudge/refetch behavior.
- `packages/hosted-execution` no longer exposes the legacy provider message event compatibility surface as a live shared contract.
- web/cloudflare shared status naming is wake-native rather than dispatch-native.
- docs/tests are updated to the final architecture without widening into unrelated product work.

## Constraints/Assumptions

- Preserve unrelated dirty worktree edits.
- Avoid touching active homepage/pricing/onboarding auth lanes unless a hosted-hard-cut dependency forces a merge-aware test update.
- Treat hosted webhook receipts as allowed receipt-local journals; do not widen into deleting that persistence unless required by the live runtime cut.
- Keep new edits ASCII-only unless a file already requires otherwise.

## Key decisions

- Prioritize real architecture gaps over broad harness/test-only cleanup.
- Use parallel worker ownership by seam: runtime, shared contracts, web, Cloudflare, docs/tests.
- Keep Cloudflare cleanup scoped to the still-live thin-shim gap and stale staged-dispatch residue rather than rewriting unrelated runner coordination.

## State

in_progress

## Done

- Read the canonical hosted wake cutover guide and audited the live tree with five parallel review workers.
- Deduped stale audit claims from still-real remaining architecture gaps.

## Now

- Registering the coordination row and splitting the final cleanup into disjoint worker-owned slices.

## Next

- Spawn workers for runtime, shared contracts, web cron/status, Cloudflare thin-shim cleanup, and docs/test alignment.
- Integrate the slices locally and resolve any cross-lane fallout.
- Run scoped verification plus required audit passes before commit.

## Open questions (UNCONFIRMED if needed)

- UNCONFIRMED: whether `parser.drain` should land as an explicit hosted wake in this pass or whether parser follow-up should instead be removed from the hosted contract surface entirely.
- UNCONFIRMED: how much of the remaining dispatch-named test harness can be cleaned safely without colliding with the separate active hosted-web test-fallout lane.

## Working set (files/ids/commands)

- Plan: `agent-docs/exec-plans/active/2026-04-18-hosted-hard-cut-final-cleanup.md`
- Shared contracts: `packages/hosted-execution/src/{contracts,builders,parsers}.ts`
- Runtime: `packages/assistant-runtime/src/hosted-runtime/{events,execution,maintenance,models,summary}.ts`
- Web: `apps/web/src/lib/hosted-{execution,wake}/**`, `apps/web/app/api/internal/hosted-wake/status/route.ts`
- Cloudflare: `apps/cloudflare/src/{user-runner.ts,dispatch-payload-store.ts,storage-paths.ts,user-runner/**}`
- Docs: `docs/cloudflare-hosted-idempotency-followup.md`, related hosted hard-cut docs
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
