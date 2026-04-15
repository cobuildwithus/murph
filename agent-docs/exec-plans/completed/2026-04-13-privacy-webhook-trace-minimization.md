# Goal (incl. success criteria):
- Land the watched privacy patch only where it still applies: device-sync webhook trace minimization and hosted Linq redirect side-effect payload minimization.
- Success means the touched owners preserve behavior, reduce retained operational data in the targeted seams, pass truthful verification, and are ready for the required same-thread follow-up review.

# Constraints/Assumptions:
- Keep the change scoped to the downloaded artifact intent; do not revive the broader privacy row's earlier candidate edits.
- Preserve overlapping dirty-tree work in `apps/cloudflare/**`, `packages/assistant-runtime/**`, `packages/cloudflare-hosted-control/**`, `packages/messaging-ingress/**`, and other active `apps/web/**` lanes.
- Older stored webhook and webhook-receipt rows must remain readable; only new writes should become narrower where compatibility matters.

# Key decisions:
- Treat the downloaded patch as behavioral intent and adapt only the still-applicable hunks to the current branch.
- Use retention pruning only for processed webhook dedupe traces, leaving active processing rows untouched.
- Keep legacy `homeRecipientPhone` receipt reads for backward compatibility while switching new redirect side effects to `memberId`-backed lookup.

# State:
- completed

# Done:
- Read the required repo workflow docs, thread export, downloaded patch, and current target files.
- Confirmed the patch scope is narrower than the existing privacy row description and limited to device-sync webhook traces plus hosted Linq redirect payload handling.
- Landed the production changes and focused tests for local/hosted webhook-trace pruning plus member-backed Linq redirect payload persistence.
- Ran `pnpm typecheck`, `pnpm --dir packages/device-syncd test:coverage -- test/store.test.ts`, the focused `apps/web` Vitest lane for the touched files, and direct sqlite/Linq runtime proof.
- Ran the required `coverage-write` and final review audit passes; both returned no actionable changes.
- Sent the same-thread file-attached review request. Browser automation reported `commit-timeout`, but the thread state recorded a new matching user-turn signature for `repo.repomix 122` / `repo.snapshot 125`.
- Armed the detached final wake hop at `output-packages/chatgpt-watch/69dc1c7b-56ec-83a1-a986-8e97bbb3f3f0-2026-04-12T233151Z/`.

# Now:
- Close the active plan with the scoped commit path.

# Next:
- None.

# Open questions (UNCONFIRMED if needed):
- `pnpm test:diff packages/device-syncd apps/web` still fails for an unrelated reverse-dependent `packages/assistant-engine` typecheck blocker (`@murphai/contracts` resolution plus existing `cron.ts` type drift), so the lane used scoped verification after recording that blocker.

# Working set (files/ids/commands):
- Files: `packages/device-syncd/src/store/webhook-traces.ts`, `packages/device-syncd/test/{store.test.ts,service.test.ts}`, `apps/web/src/lib/device-sync/prisma-store/webhook-traces.ts`, `apps/web/src/lib/hosted-onboarding/{webhook-provider-linq.ts,webhook-receipt-codec.ts,webhook-receipt-types.ts,webhook-transport.ts}`, targeted `apps/web/test/**`, this plan, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Commands: `pnpm typecheck`, `pnpm test:diff packages/device-syncd apps/web`, `pnpm --dir packages/device-syncd test:coverage -- test/store.test.ts`, `pnpm --dir apps/web test -- --run test/prisma-store-device-sync-signal.test.ts test/hosted-onboarding-webhook-receipt-codec.test.ts test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-webhook-idempotency.test.ts`, direct `pnpm exec tsx --eval ...` proof, audit passes, `pnpm review:gpt --send ...`, `pnpm exec cobuild-review-gpt thread wake ...`

Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
