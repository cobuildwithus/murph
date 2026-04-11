# Goal (incl. success criteria):
- Apply only the still-applicable changes from the watched ChatGPT artifact `murph-device-sync-webhook-followup-v2.patch`.
- Success means the shared device-sync ingress contract no longer carries raw provider webhook payloads across the accepted/unknown hook boundary, hosted wake consumes the shared narrowed webhook type directly, focused tests cover the narrowed contract, and scoped verification passes or any unrelated blockers are recorded explicitly.

# Constraints/Assumptions:
- Keep the diff scoped to the device-sync webhook ingress and hosted wake seam only.
- Preserve any unrelated repo state; the worktree was clean before this lane started.
- Treat the downloaded patch as behavioral intent, not overwrite authority.

# Key decisions:
- Reuse the already-landed transactional webhook-trace completion flow and hosted body-size cap work rather than reopening those seams.
- Replace shared webhook `payload` hints with a normalized `resourceCategory` only on the accepted/unknown ingress hook boundary; job payloads remain unchanged.
- Add focused device-syncd proof for the narrowed boundary instead of broadening into unrelated webhook storage/schema work.

# State:
- completed

# Done:
- Read the repo workflow, verification, completion, security, reliability, and `work-with-pro` instructions.
- Inspected the watched thread export and downloaded `murph-device-sync-webhook-followup-v2.patch`.
- Compared the patch against current source and confirmed the contract-narrowing changes are still missing while the earlier body-limit/trace-completion follow-up is already landed.
- Landed the narrowed webhook contract changes in `packages/device-syncd` and `apps/web`.
- Added focused ingress-summary coverage and updated provider/hosted-web expectations to the new `resourceCategory` contract.
- Verification:
  `pnpm typecheck` passed.
  `pnpm test:smoke` passed.
  `pnpm --dir packages/device-syncd test:coverage` passed.
  `pnpm --dir apps/web verify` passed.
  Focused scenario proof passed for the new ingress summary test and hosted sparse-hint test.
- Recorded the unrelated `pnpm test:diff packages/device-syncd apps/web` blocker: pre-existing `packages/assistant-engine` typecheck failures on missing `@murphai/contracts` imports and the stale `slug` property in `src/assistant/cron.ts`.
- Required audit passes completed:
  `coverage-write` found no extra test changes needed.
  final review found no issues.

# Now:
- Archive the plan and create the scoped commit.

# Next:
- Report the landed behavior, verification evidence, and unrelated blocker in handoff.

# Open questions (UNCONFIRMED if needed):
- None.

# Working set (files/ids/commands):
- Thread export: `output-packages/chatgpt-watch/69da4aab-5f04-83a0-960d-45387c42c568-2026-04-11T141105Z/thread.json`
- Artifact: `output-packages/chatgpt-watch/69da4aab-5f04-83a0-960d-45387c42c568-2026-04-11T141105Z/downloads/murph-device-sync-webhook-followup-v2.patch`
- Files: `packages/device-syncd/src/{types.ts,public-ingress.ts,providers/whoop.ts,providers/oura.ts}`, `packages/device-syncd/test/public-ingress.test.ts`, `apps/web/src/lib/device-sync/wake-service.ts`, targeted `apps/web/test/**`
- Commands: `git apply --check`, focused `pnpm` typecheck/coverage/verify commands, required audit passes, `scripts/finish-task`
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
