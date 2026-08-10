# Prevent browser-vault refresh starvation

Status: completed
Created: 2026-08-10
Updated: 2026-08-11

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

- In scope: browser-vault refresh identity and signaling, the existing scheduled
  mailbox handoff sweep, runtime wake ordering, focused regression tests, and
  matching durable runtime guidance.
- Out of scope: the separate unverified-audience mailbox loop, browser UI,
  replica schema, general mailbox ordering, and the Temporal workflow definition.

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
  The existing scheduled mailbox handoff sweep recovers a failed first signal.
- Defer only a browser-only post-checkpoint wake until the active browser
  refresh finishes or reaches a terminal result. Foreground work still
  preempts the refresh.
- Final ReviewGPT found two gaps in the first candidate: first-signal recovery
  was not owned, and a new workspace version could create another browser wake
  before publication. The current candidate closes both gaps without new state.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-onboarding-privy-phone-transfer-retirement.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
  passed with 62 tests.
- `pnpm --dir apps/web exec eslint src/lib/hosted-orchestration/browser-vault-refresh-control.ts src/lib/hosted-orchestration/signal-runtime.ts test/hosted-orchestration-signal-runtime.test.ts test/hosted-onboarding-privy-phone-transfer-retirement.test.ts`
  passed.
- `pnpm --dir apps/web typecheck:prepared` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts`
  passed with 270 tests.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --isolate=true --no-coverage apps/web/test/hosted-preference-handoff-sweeper.test.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-device-sync-recovery-sweeper.test.ts`
  passed with 44 tests.
- Scoped web ESLint passed with one pre-existing `_args` warning and no errors.
- `pnpm --dir apps/web typecheck:prepared` and the assistant-runtime package
  typecheck passed.
- The user explicitly declined another full ReviewGPT ZIP after the first
  final review found the two corrected issues. The parent inspected the full
  corrected diff and ran focused proof instead of resending the package.
Completed: 2026-08-11
