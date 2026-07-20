# Shared Verification Capacity

Status: completed

## Goal

Keep many concurrent Codex worktrees from oversubscribing the host without
forcing routine scoped verification to wait behind long acceptance or build
commands.

## Scope

- Reuse the existing shared-host admission helper as one exclusive lane for
  heavyweight finite commands.
- Make Codex-run canonical verification and build entrypoints participate by
  default while preserving an explicit local opt-out.
- Keep `test:diff` outside the heavyweight lane, but cap its package and
  TypeScript fan-out to one owner and one Vitest worker.
- Apply the same conservative Codex/shared-host Vitest default to direct package
  and app test entrypoints, including Cloudflare Workers tests.
- Close the root build admission boundary around cleanup, TypeScript output,
  and importer output when the change remains small and mechanical.
- Update the existing shared-host performance documentation and focused tests.

## Invariants

- There is one heavyweight capacity owner. Do not add a daemon, second pool,
  weighted tokens, queue database, task cache, or dependency.
- `dev`, watch, and other long-lived commands never acquire the finite-command
  host slot.
- Explicit `MURPH_VERIFY_SHARED_HOST=0` remains an escape hatch.
- CI behavior remains explicit and does not inherit Codex-local defaults.
- `test:diff` retains its per-worktree artifact lock even though it does not
  hold the host-wide heavyweight slot.
- App verification reached from `test:diff` still acquires the existing
  heavyweight app-verification slot.
- Existing stale-owner recovery, path redaction, signal forwarding, and
  process-ownership behavior remain unchanged.

## Plan

1. Separate workspace artifact-lock routing from heavyweight host-slot routing.
2. Normalize automatic Codex participation at the existing entrypoints and
   propagate the effective shared-host mode to descendants.
3. Hard-cap scoped and direct Codex Vitest fan-out, including Workers Vitest.
4. Add deterministic helper/orchestration tests and update the durable profile
   documentation.
5. Run scoped verification, required completion audits, parent final review,
   commit, PR, ReviewGPT, and CI.

## Verification

- Focused host-slot helper tests.
- Focused workspace orchestration and Vitest-parallelism tests.
- `pnpm test:diff` for the changed script/config/doc paths.
- Bounded synthetic contention proof that heavyweight work is exclusive while
  capped `test:diff` does not queue behind it.

Updated: 2026-07-19
Completed: 2026-07-19
