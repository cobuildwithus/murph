# Greenfield repo cleanup and verification baseline

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Clean up stale Greenfield compatibility/process residue called out by review.
- Leave active coordination state trustworthy, with only genuinely live work in
  the active plan directory and ledger.
- Align docs wording and metadata with the current hosted mailbox/workspace and
  bounded runner architecture.
- Run the strongest practical repo verification baseline and document any
  blockers that are unrelated to this lane.

## Success criteria

- Stale completed/no-commit/inactive execution-plan rows are archived or removed
  without disturbing live dirty work owned by other lanes.
- Old hosted-run/hosted-ingress terminology remains only in historical or
  explicit fail-closed contexts.
- `AGENTS.md` is a compact router again, with durable detail routed to
  `agent-docs/**`.
- Cloudflare legacy queue surfaces are absent from the current checkout.
- `pnpm typecheck`, `pnpm test`, `pnpm verify:acceptance`, and
  `pnpm release:check` pass, or precise unrelated blockers are recorded.

## Scope

- In scope:
  - `agent-docs/exec-plans/active/**` and matching completed-plan archives.
  - `agent-docs/index.md`, workflow/verification docs, and concise wording
    updates in architecture-facing docs when needed.
  - `AGENTS.md` router compaction.
  - Verification-only investigation and small fixes needed to restore the root
    baseline when they are clearly caused by stale Greenfield residue.
- Out of scope:
  - Taking ownership of unrelated active code/content lanes already dirty in the
    checkout.
  - Reintroducing compatibility shims for deleted hosted run, cursor, or queue
    surfaces.
  - Changing product behavior beyond making current docs/process/tests match the
    Greenfield architecture.

## Constraints

- Preserve unrelated working-tree edits and active ledger rows.
- Do not write direct personal identifiers, home paths, secrets, or raw
  credentials into repo files, logs, comments, docs, tests, or commit messages.
- Use scoped commits only; if overlapping dirty work blocks a safe commit, close
  or archive the plan with an explicit outcome instead of leaving stale active
  state.

## Risks and mitigations

1. Risk: Archiving a plan that still represents live work.
   Mitigation: Cross-check plan state, ledger status, current dirty files, and
   current source before moving any plan out of active.
2. Risk: Root verification failures are from unrelated active lanes.
   Mitigation: Record the failing command, failing target, and why the current
   cleanup diff did not cause it; avoid broad rewrites to force green.
3. Risk: Shortening root instructions drops important rules.
   Mitigation: Keep non-negotiable rules and route durable detail to the
   workflow docs instead of deleting the policy.

## Tasks

1. Inventory active plans, ledger rows, stale hosted terminology, and Cloudflare
   legacy queue residue.
2. Archive/remove stale plan and ledger state while preserving live lanes.
3. Patch doc metadata/wording drift and compact `AGENTS.md`.
4. Run root verification and fix scoped cleanup-caused failures.
5. Run required close-out review, then finish or close the plan with a scoped
   commit.

## Decisions

- Treat this as Greenfield: remove compatibility/process residue instead of
  preserving old surfaces for hypothetical legacy users.
- Use GPT-5.5 medium subagents for independent stale-plan, docs, and
  verification slices as requested by the user.

## Verification

- `git ls-files apps/cloudflare/src/legacy-runner-wake-queue.ts`: no tracked
  legacy queue file.
- `git grep -n "legacy-runner-wake-queue\\|handleLegacyHostedRunnerWakeQueue\\|murph-hosted-runner-wake" -- . ':(exclude)agent-docs/exec-plans/completed/**' ':(exclude)agent-docs/exec-plans/active/**'`:
  only the Cloudflare negative assertion remains.
- `pnpm docs:drift`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed.
- `pnpm verify:acceptance`: passed.
- `pnpm release:check`: passed.
Completed: 2026-05-02
