# Avoid unchanged and obsolete device container starts

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Outcome and invariant

Keep hourly device polling and prompt changed-data imports while avoiding
container admission for unchanged provider content or already-satisfied
scheduled work. Preserve manual refresh, dirty payloads, retained jobs, source
epochs, daily repair, consent, and foreground priority.

## Scope and ownership

Investigate the existing Web scheduled preflight and mailbox admission, plus
provider-owned content proofs and runtime-owned continuation publication.
Fix only reproduced gaps at those owners. No polling-frequency changes,
standby changes, new scheduler, dependency, or production mutation.

## Evidence and design

Aggregate operational evidence identifies unchanged polls and zero-job passes;
neither alone proves an obsolete obligation. Trace the specific eligibility or
ordering defect and reproduce it with synthetic fixtures before implementation.
Prefer deleting a redundant condition or correcting existing publication and
admission over adding a retirement mechanism or second source of truth.

## Tasks

1. Identify preflight exclusions and the provenance of empty scheduled work.
2. Add failing regressions for proven causes and protected success paths.
3. Correct existing owners; document any changed contract and deployment skew.
4. Run focused tests, typechecks, complexity and privacy review, then commit.

## Product UX

- Outcome: lower execution overhead with unchanged data freshness.
- Reaches: unchanged and changed polls, webhook arrivals, manual refresh,
  retained retries/history, connection replacement, and foreground messages.
- Proof: synthetic composed owner tests must distinguish no-work from accepted
  pending work and retain repair and recovery deadlines.

## Verification

Select provider preflight, Web admission/PostgreSQL, and runtime publication
tests according to the proven defect; run relevant package typechecks and the
complexity guard. External review and production proof remain separate from
local regression evidence.

## Implementation and decisions

- Reproduced a queued old-cadence hint surviving successful completion and
  scheduling an unnecessary follow-up. Two synthetic completion regressions
  failed before the fix because a due wake remained instead of no wake or the
  independent maintenance deadline.
- Reuse the existing retained-owner coverage projection during conditional
  completed-item removal. Retire only covered scheduled hints in that same
  state update after accepted checkpoint publication. No new persisted state,
  scheduler, dependency, provider request, or polling interval.
- Hourly Web preflight already compares full content and advances cadence without
  runtime admission when unchanged. Missing/expired proof, changed content,
  incomplete reads, dirty work, and due recovery must still run. A no-op import
  after such a fallback does not establish that suppressing it was safe.
  Investigation did not justify deleting those guards or changing frequency.
- Scope limit: cleanup covers already-imported local hints. It does not retire
  unimported Web mailbox rows, eliminate all zero-import passes, or establish a
  production cost saving before rollout and measurement.

## Verification results

- Runtime build and runtime typecheck passed.
- Runtime mailbox notification and empty-work suites: 175 tests passed,
  including stale schedules with and without independent maintenance, webhooks,
  manual refresh, newer/equal cadence, replacement epochs, other connections,
  unknown work, and an intervening webhook barrier.
- Web scheduled preflight suite: 27 tests passed, including authority races,
  unchanged cadence advancement, and fallback preservation.
- Junction preflight suite: 24 tests passed, including unchanged/empty reads,
  corrected records, invalid proof, and recovery boundaries.
- No model prompt, tool, or reply behavior changed; deterministic scheduler and
  mailbox proof applies instead of a real-model journey.
- Product UX: Ready within this local scope; data freshness and real work are
  preserved. Internal execution-cost cleanup has no public changelog entry.
- Deployment: runtime-only, existing state/wire shapes. Older runtimes retain
  redundant hints; newer runtimes can remove proven covered hints. No schema
  migration, Web/Worker ordering requirement, or rollback floor change.
- Complexity guard passed with no increased debt. The three existing hotspots
  in parsing, claim preparation, and post-checkpoint recording are unchanged;
  unrelated restructuring would not improve this small change.
- Full diff and privacy review passed; only synthetic fixtures and public-safe
  behavior are documented. No task-created Frog entry was needed.
- Local commit only. Production rollout, before/after savings, required PR CI,
  and routed final ReviewGPT remain outside this local completion.

Focused commands:

```sh
pnpm --filter @murphai/assistant-runtime build
pnpm --filter @murphai/assistant-runtime typecheck
pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-system-mailbox-notification.test.ts packages/assistant-runtime/test/hosted-runtime-system-mailbox-empty.test.ts --no-coverage
pnpm exec vitest run --config packages/device-syncd/vitest.config.ts packages/device-syncd/test/junction-reconcile-preflight.test.ts --no-coverage
pnpm exec tsx apps/web/scripts/run-hosted-web-vitest.mts apps/web/test/device-sync-scheduled-reconcile-preflight.test.ts --no-coverage
pnpm complexity:diff
git diff --check
```
Completed: 2026-09-24
