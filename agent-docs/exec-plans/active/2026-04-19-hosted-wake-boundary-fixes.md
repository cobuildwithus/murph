Goal (incl. success criteria):
- Close the remaining hosted-wake hard-cut boundary gaps so the wake/cursor path is safe to call the canonical hosted execution seam.
- Success means:
- quarantine requires proof-bound fetched wake identity before cursor advancement
- helper-level wake/event dereference fails closed on owner mismatch instead of relying on caller scoping alone
- `snapshotRef` is validated and typed as a hosted bundle ref at the web boundary
- stale hosted cipher scope names and architecture/readme cutover wording are reconciled to the current DO-local pending-commit model
- the remaining cutover docs/specs/ledger describe only still-open work rather than already-landed queue-owner and schema-owner changes

Constraints/Assumptions:
- Preserve unrelated in-flight worktree edits.
- Keep the fix scoped to the hosted wake/cursor seam plus the matching storage/doc truthfulness for the same cutover.
- Do not weaken existing cursor CAS or hosted wake event replacement semantics.
- Tests and shared contracts must move with the boundary changes.

Key decisions:
- Treat quarantine as a proof-backed terminal state, not a separate bypass path.
- Keep owner-scoped storage and caller scoping as landed, but still fail closed at the helper dereference boundary.
- Treat web-side materialization from canonical Postgres state as landed; DO hints stay scheduling hints only.
- Validate bundle refs at web ingress instead of letting Cloudflare discover malformed cursor state later.
- Treat `packages/runtime-state/src/hosted-storage.ts` current scope names separately from any legacy decode compatibility that may still need to parse old ciphertext.

State:
- in_progress

Done:
- Reviewed repo workflow/security/reliability/test docs.
- Triaged the six open blockers with local static inspection plus GPT-5.4 subagents.
- Confirmed owner-scoped wake/Linq storage landed in Prisma plus the high-value caller paths.
- Confirmed root `README.md` now names `HostedWake` / `HostedExecutionCursor` instead of `execution_outbox`.
- Confirmed web-side due wake materialization already derives from canonical Postgres state.
- Confirmed the remaining docs drift is the execution-journal/webhook-receipts wording, not the root queue-owner wording.
- Confirmed `packages/runtime-state/src/hosted-storage.ts` still carries stale current-scope names even though the live writers no longer use them.

Now:
- Keep the active plan aligned to the still-open boundary seams only.

Next:
- Land quarantine fetch-proof binding end-to-end.
- Land fail-closed helper-level owner scoping for wake/event dereference.
- Land `snapshotRef` bundle-ref validation at the web boundary.
- Reconcile `packages/runtime-state/src/hosted-storage.ts`, `ARCHITECTURE.md`, `docs/architecture.md`, `apps/web/README.md`, and the active cutover docs/specs/ledger with the actual migration story.
- Run scoped verification, required audit passes, and commit.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether any persisted invalid `snapshotRef` rows already exist in a real environment; repo-only fix can prevent new writes but not repair remote data.
- UNCONFIRMED whether the intended cutover truth is to squash hosted Prisma back to one baseline or to document the current incremental migration chain as intentional until a later reset.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-wake/**`
- `apps/web/app/api/internal/hosted-wake/{commit,materialize,quarantine}/route.ts`
- `apps/web/src/lib/{linq/{control-plane,prisma-store}.ts,hosted-onboarding/webhook-provider-linq.ts}`
- `apps/web/prisma/{schema.prisma,migrations/**}`
- `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `packages/runtime-state/src/hosted-storage.ts`
- `apps/cloudflare/src/{user-runner.ts,web-control-plane.ts}`
- `apps/{web,cloudflare}/test/**`
- `README.md`
- `apps/web/README.md`
- `ARCHITECTURE.md`
- `docs/architecture.md`
- `agent-docs/product-specs/repo.md`
