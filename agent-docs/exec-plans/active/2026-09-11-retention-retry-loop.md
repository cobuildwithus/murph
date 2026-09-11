# Prove and fix recurring retention maintenance wakeups

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Prevent non-progressing retention maintenance from repeatedly scheduling a container inside its idle window. Preserve actionable expiry and foreground priority.

## Success criteria

- Reproduce unchanged failures and legacy migration blockers with synthetic fixtures before changing production code.
- Preserve real expiry deadlines, bounded-batch continuation, checkpointing, and foreground interruption.
- Persist metadata-only failure stage and blocker diagnostics through the existing runtime-log owner.
- Pass focused tests, package typechecks, parent review, complexity checks, and ReviewGPT.

## Scope

- Existing hosted idle-retention scheduler and diagnostics only.
- No production mutation, vault repair, new retry state, scheduler, provider call, or container sizing changes.

## Constraints

- Keep canonical deletion and migration equivalence checks intact.
- Diagnostics contain closed stage/outcome values, sanitized error codes, and counts only.
- Production observations are private and are not copied into this artifact.

## Risks and mitigations

- Failed cleanup may recover later: retry hourly; normal idle maintenance remains able to recover sooner. Keep earlier discovered expiry deadlines.
- Legacy corruption still requires repair: recheck daily, matching blocked media, and make the blocked stage visible rather than bypassing safety checks.
- Older log consumers may reject the new event code: writes are best-effort and never checkpoint authority; update the Web consumer first for full diagnostic coverage.

## Tasks

1. Trace all five-minute retention scheduling paths and inspect read-only metadata.
2. Run failing clock-advanced regressions and a real legacy-ledger fixture.
3. Correct retry classification and add safe stage diagnostics.
4. Prove successful cleanup, pending work, interruption, deadlines, and diagnostic failure behavior.
5. Complete focused verification and external review, then commit the scoped fix.

## Decisions

- Synthetic baseline: persistent cleanup failure produces 72 attempts in six hours.
- Synthetic baseline: an unmigratable legacy ledger row requests another wake in five minutes without changing its ledger.
- Synthetic baseline: migration with candidates beyond the batch limit and a blocker requests immediate continuation while applying nothing.
- Use one-hour failure retries and daily blocked rechecks; retain the five-minute interruption retry and immediate actionable continuation.
- The live log observation did not identify the underlying workspace-specific cleanup blocker. Local repro proves the scheduling defects, not a repair of private production data.
- Internal operational change; no member-facing changelog entry or model-input changes.

## Verification

- Baseline existing idle-maintenance and protection suites: 43 tests passed.
- Three new regression tests failed against the original code at the expected scheduling assertions.
- Initial fix: idle-maintenance suite, 45 tests passed.
- Final focused assistant runtime suites: 68 tests passed, including earlier deadlines, transient recovery, log failure isolation, immediate useful migration continuation, foreground interruption, and the restored-vault checkpoint/diagnostic boundary.
- Inbox migration and text-retention suites: 23 tests passed. Runtime-log suite: 4 tests passed.
- `pnpm --dir packages/assistant-runtime typecheck` and `pnpm --dir packages/hosted-execution typecheck`: passed.
- `pnpm complexity:diff`: passed; idle-maintenance maximum complexity 44 to 43; other changed-file hotspots unchanged. Larger runtime decomposition is outside this bounded scheduling correction.
- Parent review: canonical deletion unchanged; no new retry state; no provider-input change; diagnostics buffer through the existing info-log queue to preserve foreground preemption.
- Product UX Patch: Ready for candidate review. Outcome: fewer futile maintenance invocations. Reaches: failed cleanup, unmigratable legacy state, actionable batches, and foreground arrivals. Proof: synthetic loop counts, real legacy ledger preservation, restored-vault checkpoint, and existing interruption/protection journeys.
- Remaining: ReviewGPT and applicable remote checks. No deployment or private production-data repair has occurred.
