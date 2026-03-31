# Clean remaining dirty worktree and land coherent pending changes

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Land the remaining dirty worktree changes as coherent, verified repo history so the checkout is clean and passing again.

## Success criteria

- The pending hosted device-sync browser-surface changes, assistantd client-surface export, contract/core cleanup, lockfile/tooling updates, and related docs/tests are committed without losing adjacent edits.
- `git status --short` is clean after the landing.
- Required verification for the touched app/package/config surface passes.
- The required `task-finish-review` audit pass reports no unresolved findings.

## Scope

- In scope:
  - `apps/web/**` hosted device-sync browser-facing connection/callback changes plus tests/docs
  - `packages/assistantd/**` client subpath packaging/docs/source alias wiring
  - `packages/contracts/**` registry-helper cleanup
  - `packages/core/**` atomic-write cleanup plus focused tests
  - `package.json`, `pnpm-lock.yaml`, and generated doc inventory updates needed to leave the repo coherent
  - The pending completed plan artifact already sitting in the worktree
- Out of scope:
  - New product behavior outside the already dirty worktree
  - Reverting or rewriting unrelated committed history

## Constraints

- Technical constraints:
  - Preserve overlapping dirty edits and only integrate what is already in the worktree.
  - Keep assistantd loopback-only and keep hosted browser device-sync responses free of raw hosted connection identifiers and `externalAccountId`.
- Product/process constraints:
  - Use the coordination ledger.
  - Run full required verification and the required final audit pass before handoff.
  - Close this plan with `scripts/finish-task` if the final landing stays on a single commit path.

## Risks and mitigations

1. Risk: The remaining dirty files may actually represent multiple overlapping unfinished lanes.
   Mitigation: Inspect the diffs up front, keep the scope explicit, and stage only the coherent landing set.
2. Risk: Hosted device-sync browser changes could accidentally leak raw connection identifiers or break callback/disconnect flows.
   Mitigation: Keep the opaque-id mapping centralized, preserve existing ownership checks, and verify with focused tests plus repo-wide checks.
3. Risk: Lockfile and generated-doc updates can drift from the final committed file set.
   Mitigation: Re-run verification/doc-generation paths after the implementation is stable and inspect the final staged diff before commit.

## Tasks

1. Inspect the remaining dirty and untracked files and group them into one coherent landing set.
2. Apply any follow-up fixes needed so the dirty worktree changes are internally consistent.
3. Re-run required verification and capture one direct proof note for the hosted device-sync browser-id boundary.
4. Run the required `task-finish-review` audit pass and resolve any findings.
5. Close the plan and commit the exact remaining paths so the worktree ends clean.

## Decisions

- Treat the remaining dirty changes as one cleanup lane because the assistantd client-surface, hosted device-sync browser-surface, contracts/core cleanup, lockfile, and generated-doc artifacts already coexist in the worktree and all need to land to restore a clean checkout.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Direct proof:
  - Focused tests around hosted device-sync opaque browser connection ids and callback redirects.
- Expected outcomes:
  - All required commands pass and the final audit reports no unresolved findings.
Completed: 2026-04-01
