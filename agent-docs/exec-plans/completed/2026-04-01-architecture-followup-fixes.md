# Port architecture follow-up fixes patch across current tree

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Port the supplied architecture follow-up patch onto the current worktree without overwriting unrelated in-flight edits, preserving the intended device-sync control-plane split, hosted onboarding service split, and hosted runner job-envelope unification.

## Success criteria

- The intended refactors and focused regressions from the supplied patch are landed on the current tree.
- Existing unrelated dirty-tree edits remain intact.
- Required repo verification passes, or any blocker is documented and shown to be unrelated.
- The task is closed through the repo's scoped commit workflow.

## Scope

- In scope:
  - Port the device-sync control-plane/service split in `apps/web/src/lib/device-sync/**` plus any route updates needed to match current signatures.
  - Port the hosted onboarding member-service split into focused modules and keep the compatibility barrel current.
  - Unify the hosted runner job envelope across `packages/assistant-runtime` and `apps/cloudflare`.
  - Land the focused regression tests that belong to the patch and adapt them to the current tree where needed.
- Out of scope:
  - Behavior changes beyond the supplied patch intent.
  - Unrelated hosted onboarding or Privy-client-id edits already in flight on this branch.
  - New dependency changes.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree edits and manually merge around current branch drift.
  - Respect existing package boundaries and current repo architecture docs.
- Product/process constraints:
  - Run the repo-required verification for this high-risk cross-cutting change.
  - Use scoped commit helpers rather than a hand-rolled commit flow.

## Risks and mitigations

1. Risk: The supplied patch overlaps already-dirty hosted onboarding and device-sync files.
   Mitigation: Read current file state first, port only the intended behavioral delta, and avoid reverting adjacent edits.
2. Risk: Runtime entrypoint and auth-surface changes could introduce type or contract regressions across `apps/web`, `apps/cloudflare`, and `packages/assistant-runtime`.
   Mitigation: Run the full required repo verification baseline after the port lands.

## Tasks

1. Register the patch port in the coordination ledger and inspect the supplied diff against current files.
2. Port the device-sync control-plane split onto the current `apps/web` state.
3. Port the hosted onboarding service split and associated tests onto the current `apps/web` state.
4. Port the shared hosted runner job-envelope changes across `packages/assistant-runtime` and `apps/cloudflare`.
5. Run required verification, fix any regressions, then finish with a scoped commit.

## Decisions

- This patch port is plan-bearing because the supplied diff no longer applies cleanly and overlaps active dirty-tree changes in multiple high-risk areas.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm --dir packages/assistant-runtime test`
  - `pnpm --dir apps/cloudflare test:workers`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/{container-entrypoint,node-runner,runner-container,user-runner,index}.test.ts --reporter=dot`
  - `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/{hosted-onboarding-member-service,hosted-onboarding-privy-service,hosted-onboarding-routes,hosted-onboarding-billing-service,hosted-share-service,join-page,agent-route,hosted-device-sync-internal-routes,device-sync-hosted-wake-dispatch,linq-control-plane}.test.ts --reporter=dot`
- Expected outcomes:
  - Typecheck passes and all patch-relevant test suites pass after the manual patch port.

## Verification notes

- The user explicitly requested that no `next dev` process be started during finish-up.
- `pnpm test` and `pnpm test:coverage` were therefore not used as final verification commands because the repo scripts spawn hosted-web smoke/dev flows that violate that constraint.
- A prior exploratory `pnpm test` / `pnpm test:coverage` attempt also collided on concurrent Next processes, so final verification was rerun as the targeted non-dev suite set listed above.
Completed: 2026-04-01
