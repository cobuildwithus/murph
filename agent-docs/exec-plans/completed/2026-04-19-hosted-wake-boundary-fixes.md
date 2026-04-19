Goal (incl. success criteria):
- Close the remaining hosted-wake hard-cut boundary gaps so the wake/cursor path is safe to call the canonical hosted execution seam.
- Success means:
- quarantine requires proof-bound fetched wake identity before cursor advancement
- `snapshotRef` is validated and typed as a hosted bundle ref at the web boundary
- stale hosted execution journal/webhook-receipts wording is reconciled to the current DO-local pending-commit model
- the remaining cutover docs/specs/ledger describe only still-open work rather than already-landed queue-owner and schema-owner changes

Constraints/Assumptions:
- Preserve unrelated in-flight worktree edits.
- Keep the fix scoped to the hosted wake/cursor seam plus the matching doc/spec truthfulness.
- Do not weaken existing cursor CAS or hosted wake event replacement semantics.
- Tests and shared contracts must move with the boundary changes.

Key decisions:
- Treat quarantine as a proof-backed terminal state, not a separate bypass path.
- Treat owner-scoped schema work, helper-level owner scoping, and web-side materialization from canonical Postgres state as already landed or separately owned.
- Validate bundle refs at web ingress instead of letting Cloudflare discover malformed cursor state later.
- Treat the current incremental hosted Prisma migration chain as repo truth until a later explicit reset lands.

State:
- in_progress

Done:
- Reviewed repo workflow/security/reliability/test docs.
- Triaged the remaining blockers with local static inspection plus GPT-5.4 subagents.
- Confirmed owner-scoped wake/Linq storage landed in Prisma plus the high-value caller paths.
- Confirmed root `README.md` now names `HostedWake` / `HostedExecutionCursor` instead of `execution_outbox`.
- Confirmed web-side due wake materialization already derives from canonical Postgres state.
- Confirmed the remaining docs drift is the execution-journal/webhook-receipts wording, not the root queue-owner wording.

Now:
- Keep the active plan aligned to the still-open quarantine/snapshot/doc seams only.

Next:
- Land quarantine fetch-proof binding end-to-end.
- Land `snapshotRef` bundle-ref validation at the web boundary.
- Reconcile `README.md`, `apps/web/README.md`, `ARCHITECTURE.md`, `docs/architecture.md`, and `agent-docs/product-specs/repo.md` with the actual hosted cutover story.
- Run scoped verification, required audit passes, and commit.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether any persisted invalid `snapshotRef` rows already exist in a real environment; repo-only validation can prevent new writes but not repair remote data.

Working set (files/ids/commands):
- `apps/web/app/api/internal/hosted-wake/{commit,quarantine}/route.ts`
- `apps/web/src/lib/hosted-wake/{materialize,store}.ts`
- `apps/web/prisma/{schema.prisma,migrations/**}`
- `apps/web/test/{hosted-wake-routes,hosted-wake-store,hosted-onboarding-privacy-foundation-migration}.test.ts`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `apps/cloudflare/src/{user-runner.ts,web-control-plane.ts}`
- focused `apps/cloudflare/test/{user-runner-hosted-wake,web-control-plane}.test.ts`
- `README.md`
- `apps/web/README.md`
- `ARCHITECTURE.md`
- `docs/architecture.md`
- `agent-docs/product-specs/repo.md`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
