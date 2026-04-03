# Land hosted email public sender routing patch

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Land the supplied hosted-email public-sender patch on top of the current hosted-email dirty tree without disturbing unrelated work.
- Allow direct mail to the fixed public sender only when a synced verified owner email maps to that user, while keeping the existing owner re-authorization check before persistence and dispatch.

## Success criteria

- Hosted email ingress resolves direct mail to the fixed public sender through an encrypted verified-owner index instead of route headers or raw alias ownership.
- Mail addressed to the fixed public sender ignores sender-controlled `X-Murph-Route` overrides.
- Hosted user-env updates maintain, move, clear, and conflict-check the verified-owner index.
- Focused hosted-email and runner env-sync tests pass.
- Required completion review runs, findings are addressed, and the task lands with a scoped commit.

## Scope

- In scope:
  - `apps/cloudflare` hosted-email routing, ingress, runner env-sync, tests, and hosted docs
  - durable security/architecture wording for the new public-sender behavior
- Out of scope:
  - unrelated hosted assistant/runtime changes already in flight in the worktree
  - new deploy mechanics or broader email product changes beyond the supplied patch intent

## Constraints

- Technical constraints:
  - Preserve adjacent dirty-tree edits and port the supplied patch intent onto current files instead of applying it blindly.
  - Do not weaken the existing owner-only authorization gate before raw `.eml` persistence and dispatch.
  - Keep the verified-owner lookup keyed by a secret-derived sender hash, not raw verified email addresses.
- Product/process constraints:
  - High-risk hosted trust-boundary change: keep docs aligned and capture focused proof.
  - Use the repo completion workflow, including the required final review subagent and scoped commit helper.

## Risks and mitigations

1. Risk: Direct-public routing could bypass the existing sender authorization gate.
   Mitigation: Keep route lookup and sender authorization separate, and preserve the current authorization check after route resolution.
2. Risk: The supplied patch overlaps active hosted-email dirty-tree edits.
   Mitigation: Port only the new public-sender/index delta and avoid reverting adjacent stable-alias changes already in progress.
3. Risk: Verified-owner index updates could drift from hosted user-env state.
   Mitigation: Hook index conflict checks and reconcile logic directly into `RunnerBundleSync.updateUserEnv`, with focused regression tests.

## Tasks

1. Register the task in the coordination ledger and keep the active plan current.
2. Implement the verified-owner route index and direct-public ingress lookup in `apps/cloudflare/src/hosted-email/**`.
3. Wire direct-public lookup into worker ingress and sync the verified-owner index from runner user-env updates.
4. Add focused hosted-email and runner env-sync regression tests.
5. Run targeted verification, complete the required review pass, and finish with a scoped commit.

## Decisions

- Use the existing owner-only authorization check unchanged after route lookup so the new direct-public path cannot persist or dispatch mail on lookup alone.
- Keep the verified-owner index in encrypted R2 route records keyed by a secret-derived sender hash rather than raw verified email addresses.
- Keep the rollout note explicit: users whose verified email was already synced before this patch still need one more verified-email sync, or any hosted user-env update, to populate the new public-inbox index.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/hosted-email.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-bundle-helpers.test.ts`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - All commands passed.
  - Final review found one real move-ordering bug; fixed by writing the new verified-owner record before deleting the previous one, then reran the hosted-email unit test plus `pnpm typecheck`.
Completed: 2026-04-03
