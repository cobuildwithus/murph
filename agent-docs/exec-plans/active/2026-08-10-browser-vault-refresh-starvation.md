# Prevent browser-vault refresh starvation

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Let stale browser-vault replicas converge while low-priority runtime wakes
  continue, so Patterns and Environment finish loading without member action.

## Success criteria

- A focused test proves repeated browser polls reuse one durable request and do
  not wake the runtime again.
- Foreground conversation work still preempts auxiliary replica work.
- The fix adds no persisted state, queue, scheduler, or second refresh owner.
- Focused tests, exact-head CI, and required ReviewGPT gates pass.

## Scope

- In scope: web-authored browser-vault refresh identity and signaling behavior,
  focused regression tests, and matching durable runtime guidance.
- Out of scope: the separate unverified-audience mailbox loop, browser UI,
  replica schema, mailbox ordering, and the Temporal workflow definition.

## Constraints

- Preserve foreground reply priority and workspace checkpoint correctness.
- Keep the browser-vault replica derived and recoverable.
- Use the existing runtime wake, checkpoint, and publish owners.

## Tasks

1. Prove that repeated browser polls create new wakes for unchanged state.
2. Apply the smallest correction at the durable request boundary.
3. Run focused tests and inspect the complete diff.
4. Push a PR, run the required reviews and CI, then verify recovery.

## Decisions

- Keep one browser-vault refresh request per workspace version. The next
  checkpoint creates the next retry identity without a new timer or state.
- Do not signal Temporal again when the same durable request already exists.
  The canonical reconciliation loop still recovers a failed first signal.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-onboarding-privy-phone-transfer-retirement.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
  passed with 62 tests.
- `pnpm --dir apps/web exec eslint src/lib/hosted-orchestration/browser-vault-refresh-control.ts src/lib/hosted-orchestration/signal-runtime.ts test/hosted-orchestration-signal-runtime.test.ts test/hosted-onboarding-privy-phone-transfer-retirement.test.ts`
  passed.
- `pnpm --dir apps/web typecheck:prepared` passed.
