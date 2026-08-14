# Browser Vault Refresh Convergence

Status: completed
Updated: 2026-08-11

## Outcome

Make Browser Vault refresh control work converge in constant bounded work even
when a workspace contains a legacy run of duplicate refresh-control mailbox
items, and make Environment voice completion explicitly request and await a
newer Browser Vault replica before reporting that the report is updated.

## Evidence

- A production Environment voice wake completed successfully while the private
  Browser Vault replica remained older than the canonical Habitat write.
- The member's system mailbox contained a long legacy run of idempotent Browser
  Vault refresh-control items. The durable cursor advanced one item per
  checkpoint, delaying later work and preventing the derived replica from
  converging promptly.
- Current Environment UI polling stops when voice processing becomes false. It
  performs ordinary replica reads but does not request an explicit refresh or
  require the replica reference to advance beyond the pre-processing baseline.
- Current Web append logic prevents repeated signals for the same deterministic
  refresh request, but legacy rows already stored in the mailbox remain
  individually observable to the runtime.

## Invariants

- Foreground conversation work retains priority over refresh maintenance.
- Postgres mailbox rows remain durable work truth; Temporal remains pointer-only.
- Refresh controls are idempotent intent. Collapsing equivalent pending controls
  must not skip non-refresh system work, advance across a lane gap, or weaken
  checkpoint/cursor correctness.
- Browser Vault publication remains compare-and-swap protected and safe to retry.
- Environment completion remains pending until processing is complete and a
  replica reference newer than the captured baseline is observed. Failures and
  delayed convergence remain recoverable without requiring another recording.
- No new scheduler, queue, persisted state owner, or broad abstraction.

## Work

1. Ask ReviewGPT to implement a scoped patch and return it as an attachment,
   including focused runtime and Web tests.
2. Independently inspect the patch against mailbox ordering, checkpoint,
   foreground-priority, and UI convergence invariants before applying it.
3. Verify a synthetic legacy refresh backlog collapses without crossing other
   work and that Environment waits for a changed replica reference.
4. Run focused typechecks/tests, inspect the final diff, commit and push the
   candidate, then complete the routed ReviewGPT and CI gates.

## Local Result

- Applied the returned patch and kept it on the existing Browser Vault refresh
  and hosted system-mailbox owners.
- Runtime mailbox preparation now collapses only pristine,
  sequence-contiguous legacy Browser Vault refresh controls to their final row
  as one invocation-local refresh intent.
- Environment voice completion now waits for voice processing to finish, then
  requests a runtime-owned Browser Vault refresh and waits for a replica ref
  that differs from the captured baseline before resolving the report.
- The design catalog covers the separate processing, private-report refresh,
  updated, no-clear-facts, and delayed recovery states.

## Verification

- Focused assistant-runtime tests for equivalent refresh-control collapse,
  interleaved non-refresh work, lane gaps, retries, and foreground preemption.
- Focused Web Browser Vault and Environment tests for explicit refresh ownership,
  baseline replica tracking, delayed completion, and retry/reload behavior.
- Relevant package typechecks.
- Exact-head required CI and the routed preliminary and final ReviewGPT gates.

Local proof run:

- `git diff --check`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/environment-voice-refresh.test.tsx apps/web/test/browser-vault-context.test.tsx apps/web/test/training-page.test.tsx`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-browser-vault-refresh-mailbox.test.ts`
- `pnpm test:frontend-design-proof`
- `pnpm --dir apps/web exec eslint 'app/(dashboard)/environment/environment-page-client.tsx'`
- `pnpm test:diff ARCHITECTURE.md 'apps/web/app/(dashboard)/environment/environment-page-client.tsx' apps/web/app/design/components-content.tsx apps/web/app/design/environment-progress-study.tsx apps/web/src/lib/browser-vault/context.tsx apps/web/test/browser-vault-context.test.tsx apps/web/test/environment-voice-refresh.test.tsx apps/web/test/training-page.test.tsx packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts packages/assistant-runtime/test/hosted-runtime-browser-vault-refresh-mailbox.test.ts`

Current remaining gate:

- Close this active plan through `scripts/finish-task` with the final scoped
  commit after final review.

## Deployment

Classify the final Web/runtime compatibility window from the implemented patch.
If both surfaces change, preserve old-Web/new-runtime and new-Web/old-runtime
safety and document the safe deployment order plus live convergence checks.
Completed: 2026-08-11
